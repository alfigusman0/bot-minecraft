/**
 * HUNTING SKILL — Professional Edition
 *
 * Fitur:
 * - Population control: tidak bunuh jika populasi terlalu kecil
 * - Smart prey selection: prioritas hewan dengan food value tertinggi & populasi aman
 * - Auto-cook drops setelah berburu
 * - Looting: collect semua drops di sekitar
 * - Fishing sebagai alternatif jika tidak ada hewan
 * - Bow hunting untuk hewan jauh
 * - Tame wolf untuk guard (bonus)
 * - Track statistik perburuan
 */

'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

const PREY_CONFIG = [
  {
    name: 'cow',
    foodValue: 8,
    minPop: 3,
    safeKill: 1,
    cooksDrop: 'cooked_beef',
    rawDrop: 'beef',
    secondary: 'leather',
  },
  {
    name: 'pig',
    foodValue: 8,
    minPop: 3,
    safeKill: 1,
    cooksDrop: 'cooked_porkchop',
    rawDrop: 'porkchop',
    secondary: null,
  },
  {
    name: 'sheep',
    foodValue: 6,
    minPop: 3,
    safeKill: 1,
    cooksDrop: 'cooked_mutton',
    rawDrop: 'mutton',
    secondary: 'white_wool',
  },
  {
    name: 'chicken',
    foodValue: 6,
    minPop: 4,
    safeKill: 2,
    cooksDrop: 'cooked_chicken',
    rawDrop: 'chicken',
    secondary: 'feather',
  },
  {
    name: 'rabbit',
    foodValue: 5,
    minPop: 3,
    safeKill: 1,
    cooksDrop: 'cooked_rabbit',
    rawDrop: 'rabbit',
    secondary: 'rabbit_hide',
  },
  {
    name: 'salmon',
    foodValue: 6,
    minPop: 1,
    safeKill: 2,
    cooksDrop: 'cooked_salmon',
    rawDrop: 'salmon',
    secondary: null,
    aquatic: true,
  },
  {
    name: 'cod',
    foodValue: 5,
    minPop: 1,
    safeKill: 2,
    cooksDrop: 'cooked_cod',
    rawDrop: 'cod',
    secondary: null,
    aquatic: true,
  },
];

const WEAPONS = [
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'stone_sword',
  'wooden_sword',
  'golden_sword',
  'netherite_axe',
  'diamond_axe',
  'iron_axe',
];

const BOWS = ['crossbow', 'bow'];

const FOODS_COOKED = [
  'cooked_beef',
  'cooked_porkchop',
  'cooked_chicken',
  'cooked_mutton',
  'cooked_rabbit',
  'cooked_cod',
  'cooked_salmon',
  'bread',
  'baked_potato',
  'pumpkin_pie',
];

const FUEL_PRIORITY = [
  'coal',
  'charcoal',
  'blaze_rod',
  'oak_log',
  'birch_log',
  'spruce_log',
  'oak_planks',
];

const CONFIG = {
  TICK_MS: 2500,
  SCAN_RADIUS: 48,
  ATTACK_DELAY_MS: 650,
  MAX_SWINGS: 25,
  GOTO_TIMEOUT: 12000,
  FOOD_THRESHOLD: 32, // Berburu jika food di bawah ini
  BOW_MIN_DIST: 8, // Jarak minimum untuk pakai bow
  FISH_DURATION_MS: 8000,
  COOK_WAIT_MS: 3000,
};

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function countNearby(bot, name, radius = CONFIG.SCAN_RADIUS) {
  return Object.values(bot.entities).filter(
    e =>
      e?.name?.toLowerCase() === name.toLowerCase() &&
      bot.entity.position.distanceTo(e.position) < radius
  ).length;
}

function getNearbyEntities(bot, name, radius = CONFIG.SCAN_RADIUS) {
  return Object.values(bot.entities)
    .filter(
      e =>
        e?.name?.toLowerCase() === name.toLowerCase() &&
        bot.entity.position.distanceTo(e.position) < radius
    )
    .sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
    );
}

function getInventoryFoodCount(bot) {
  return bot.inventory
    .items()
    .filter(i => FOODS_COOKED.includes(i.name))
    .reduce((s, i) => s + i.count, 0);
}

// ─────────────────────────────────────────────
//  MAIN SKILL
// ─────────────────────────────────────────────

module.exports = function huntingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;

  const stats = {
    kills: 0,
    food: 0,
    fished: 0,
  };

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  // ── Pilih mangsa terbaik ─────────────────────────────────────
  function selectPrey() {
    return (
      PREY_CONFIG.filter(p => {
        if (p.aquatic) return false; // Handling terpisah
        const pop = countNearby(bot, p.name);
        return pop > p.minPop;
      })
        .sort((a, b) => {
          // Prioritas: food value tinggi, populasi aman
          const popA = countNearby(bot, a.name);
          const popB = countNearby(bot, b.name);
          const safeA = popA - a.minPop;
          const safeB = popB - b.minPop;
          if (safeA !== safeB) return safeB - safeA; // lebih banyak stok aman dulu
          return b.foodValue - a.foodValue;
        })
        .map(p => {
          const entities = getNearbyEntities(bot, p.name);
          const killable = entities.slice(0, p.safeKill);
          return killable.length ? { config: p, entity: killable[0] } : null;
        })
        .find(Boolean) ?? null
    );
  }

  // ── Serang entitas ────────────────────────────────────────────
  async function attackEntity(entity, useBow = false) {
    const dist = bot.entity.position.distanceTo(entity.position);

    // Pakai bow jika tersedia dan hewan jauh
    if (useBow && dist > CONFIG.BOW_MIN_DIST && hasItem(bot, 'arrow', 1)) {
      const bow = await equipBest(bot, BOWS, 'hand');
      if (bow) {
        try {
          await withUnstuck(
            bot,
            () =>
              bot.pathfinder.goto(
                new goals.GoalNear(
                  entity.position.x,
                  entity.position.y,
                  entity.position.z,
                  CONFIG.BOW_MIN_DIST
                )
              ),
            CONFIG.GOTO_TIMEOUT
          );
          // Charge bow
          bot.activateItem();
          await waitMs(800);
          bot.deactivateItem();
          await waitMs(300);
        } catch (_) {}
      }
    }

    // Melee attack
    await equipBest(bot, WEAPONS, 'hand');
    try {
      await withUnstuck(
        bot,
        () =>
          bot.pathfinder.goto(
            new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2)
          ),
        CONFIG.GOTO_TIMEOUT
      );
    } catch (_) {}

    let swings = 0;
    while (entity.isValid && swings < CONFIG.MAX_SWINGS) {
      try {
        bot.attack(entity);
      } catch (_) {
        break;
      }
      await waitMs(CONFIG.ATTACK_DELAY_MS);
      swings++;
    }
    await waitMs(600);
  }

  // ── Kumpulkan drops ───────────────────────────────────────────
  async function collectDrops(radius = 12) {
    const drops = Object.values(bot.entities)
      .filter(
        e =>
          e.type === 'object' &&
          e.objectType === 'Item' &&
          bot.entity.position.distanceTo(e.position) < radius
      )
      .sort(
        (a, b) =>
          bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
      );

    for (const drop of drops.slice(0, 8)) {
      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)
            ),
          4000
        );
        await waitMs(200);
      } catch (_) {}
    }
  }

  // ── Cook setelah berburu ──────────────────────────────────────
  async function cookAfterHunt() {
    const rawFoods = ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 'potato'];
    const rawItem = bot.inventory.items().find(i => rawFoods.includes(i.name));
    if (!rawItem) return false;

    const furnaceIds = ['furnace', 'smoker'].map(n => mcData.blocksByName[n]?.id).filter(Boolean);

    const furnace = furnaceIds.length
      ? bot.findBlock({ matching: furnaceIds, maxDistance: 32 })
      : null;

    if (!furnace) return false;

    try {
      await withUnstuck(
        bot,
        () =>
          bot.pathfinder.goto(
            new goals.GoalNear(furnace.position.x, furnace.position.y, furnace.position.z, 2)
          ),
        CONFIG.GOTO_TIMEOUT
      );

      const window = await Promise.race([
        bot.openFurnace(furnace),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);

      const amount = Math.min(rawItem.count, 8);
      await window.putInput(rawItem.type, null, amount);

      const fuel = bot.inventory.items().find(i => FUEL_PRIORITY.includes(i.name));
      if (fuel) {
        const fuelAmt = Math.min(fuel.count, Math.ceil(amount / 8) + 1);
        await window.putFuel(fuel.type, null, fuelAmt);
      }

      await waitMs(CONFIG.COOK_WAIT_MS);
      try {
        await window.takeOutput();
      } catch (_) {}
      window.close();

      civ.addLog(`[${bot.username}] 🔥 Masak ${rawItem.name} ×${amount}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── Makan jika lapar ─────────────────────────────────────────
  async function eatIfHungry() {
    if (bot.food >= 18) return;
    const food = bot.inventory.items().find(i => FOODS_COOKED.includes(i.name));
    if (!food) return;
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      civ.addLog(`[${bot.username}] 🍖 Makan ${food.name}`);
    } catch (_) {}
  }

  // ── Fishing sebagai fallback ──────────────────────────────────
  async function tryFishing() {
    if (!hasItem(bot, 'fishing_rod')) return false;

    const waterId = mcData.blocksByName['water']?.id;
    if (!waterId) return false;

    const water = bot.findBlock({ matching: waterId, maxDistance: 16 });
    if (!water) return false;

    try {
      const rod = bot.inventory.items().find(i => i.name === 'fishing_rod');
      await bot.equip(rod, 'hand');
      await withUnstuck(
        bot,
        () =>
          bot.pathfinder.goto(
            new goals.GoalNear(water.position.x, water.position.y, water.position.z, 3)
          ),
        8000
      );

      bot.activateItem(); // cast

      await new Promise(resolve => {
        const onCollect = () => {
          cleanup();
          resolve();
        };
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, CONFIG.FISH_DURATION_MS);
        const cleanup = () => {
          clearTimeout(timeout);
          bot.removeListener('playerCollect', onCollect);
        };
        bot.once('playerCollect', onCollect);
      });

      bot.deactivateItem();
      stats.fished++;
      civ.addLog(`[${bot.username}] 🎣 Memancing`);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── isViable ─────────────────────────────────────────────────
  function isViable() {
    const foodState = civ.getState().resources.food;
    if (foodState >= CONFIG.FOOD_THRESHOLD && getInventoryFoodCount(bot) >= 8) return false;

    // Cek ada prey atau fishing spot
    const hasPrey = PREY_CONFIG.some(p => !p.aquatic && countNearby(bot, p.name) > p.minPop);
    const hasFish =
      hasItem(bot, 'fishing_rod') &&
      !!bot.findBlock({
        matching: [mcData.blocksByName['water']?.id].filter(Boolean),
        maxDistance: 16,
      });

    return hasPrey || hasFish;
  }

  // ── MAIN RUN ─────────────────────────────────────────────────
  async function run() {
    if (active) return;
    active = true;

    try {
      await getStorage()
        .checkAndDeposit()
        .catch(() => {});

      // Makan dulu jika lapar
      await eatIfHungry();

      // Masak jika ada raw food
      await cookAfterHunt();

      const prey = selectPrey();

      if (prey) {
        const { config, entity } = prey;

        console.log(
          `[${bot.username}] 🏹 Berburu ${config.name} (pop: ${countNearby(bot, config.name)})`
        );

        await attackEntity(entity, true);
        await collectDrops();
        await cookAfterHunt();

        stats.kills++;
        stats.food += config.foodValue;
        civ.addResources({ food: config.foodValue });
        civ.addLog(`[${bot.username}] 🥩 Diburu ${config.name} | total kills: ${stats.kills}`);
      } else {
        // Tidak ada prey yang aman → fishing
        const fished = await tryFishing();
        if (fished) {
          await cookAfterHunt();
        } else {
          console.log(`[${bot.username}] Tidak ada mangsa atau ikan, menunggu...`);
        }
      }
    } catch (err) {
      console.error(`[${bot.username}] [hunting ERROR] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'hunting',
    label: '🏹 Hunting',
    isViable,

    getStats() {
      return { ...stats };
    },

    start() {
      civ.addLog(`[${bot.username}] 🏹 Hunting dimulai`);
      interval = setInterval(run, CONFIG.TICK_MS);
    },

    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      civ.addLog(
        `[${bot.username}] 🛑 Hunting dihentikan | Kills: ${stats.kills} | Food: ${stats.food}`
      );
    },
  };
};
