/**
 * COMBAT SKILL — Professional Edition
 *
 * Fitur:
 * - Detect & prioritize target berdasarkan bahaya (creeper > zombie > skeleton dll)
 * - Auto-equip armor terbaik sebelum bertarung
 * - Strafe & kite: jaga jarak dari creeper, mendekat ke skeleton
 * - Shield blocking: aktifkan shield saat ada proyektil
 * - Heal: makan makanan jika HP rendah
 * - Retreat: lari ke base jika HP kritis dan tidak ada obat
 * - Clear mob di sekitar HOME_BASE secara proaktif
 * - Broadcast ancaman ke civilization state
 * - Anti-creeper: lari jika creeper sedang charge
 */

'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const { HOME_BASE } = require('../core/config');

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

const HOSTILE_MOBS = [
  { name: 'creeper', danger: 10, ranged: false, explosiveCharge: true, minEngageDist: 5 },
  { name: 'skeleton', danger: 8, ranged: true, explosiveCharge: false, minEngageDist: 3 },
  { name: 'stray', danger: 8, ranged: true, explosiveCharge: false, minEngageDist: 3 },
  { name: 'wither_skeleton', danger: 9, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'blaze', danger: 8, ranged: true, explosiveCharge: false, minEngageDist: 4 },
  { name: 'pillager', danger: 7, ranged: true, explosiveCharge: false, minEngageDist: 4 },
  { name: 'witch', danger: 7, ranged: true, explosiveCharge: false, minEngageDist: 4 },
  { name: 'phantom', danger: 7, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'enderman', danger: 6, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'zombie', danger: 5, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'husk', danger: 5, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'drowned', danger: 5, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'spider', danger: 4, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'cave_spider', danger: 4, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'vindicator', danger: 6, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'ravager', danger: 9, ranged: false, explosiveCharge: false, minEngageDist: 3 },
  { name: 'vex', danger: 5, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'silverfish', danger: 2, ranged: false, explosiveCharge: false, minEngageDist: 1 },
  { name: 'magma_cube', danger: 4, ranged: false, explosiveCharge: false, minEngageDist: 2 },
  { name: 'slime', danger: 2, ranged: false, explosiveCharge: false, minEngageDist: 2 },
];

const HOSTILE_NAMES = new Set(HOSTILE_MOBS.map(m => m.name));

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
  'stone_axe',
];

const ARMOR_SLOTS = {
  head: [
    'netherite_helmet',
    'diamond_helmet',
    'iron_helmet',
    'golden_helmet',
    'chainmail_helmet',
    'leather_helmet',
  ],
  torso: [
    'netherite_chestplate',
    'diamond_chestplate',
    'iron_chestplate',
    'golden_chestplate',
    'chainmail_chestplate',
    'leather_chestplate',
  ],
  legs: [
    'netherite_leggings',
    'diamond_leggings',
    'iron_leggings',
    'golden_leggings',
    'chainmail_leggings',
    'leather_leggings',
  ],
  feet: [
    'netherite_boots',
    'diamond_boots',
    'iron_boots',
    'golden_boots',
    'chainmail_boots',
    'leather_boots',
  ],
};

const HEALING_FOODS = [
  'golden_apple',
  'enchanted_golden_apple',
  'cooked_beef',
  'cooked_porkchop',
  'cooked_mutton',
  'cooked_chicken',
  'cooked_rabbit',
  'cooked_salmon',
  'bread',
  'baked_potato',
  'pumpkin_pie',
  'carrot',
  'apple',
  'melon_slice',
];

const CONFIG = {
  TICK_MS: 600,
  SCAN_RADIUS: 24,
  HOME_PATROL_RADIUS: 20,
  ATTACK_DELAY_MS: 550,
  MAX_SWINGS: 30,
  GOTO_TIMEOUT: 8000,
  HP_CRITICAL: 5,
  HP_LOW: 10,
  HP_EAT_THRESHOLD: 14,
  CREEPER_FLEE_DIST: 7,
  RETREAT_DIST: 32,
};

// ─────────────────────────────────────────────
//  MAIN SKILL
// ─────────────────────────────────────────────

module.exports = function combatSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;
  let retreating = false;

  const stats = {
    kills: 0,
    deaths: 0,
    retreats: 0,
  };

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  // ── Deteksi mob hostile ──────────────────────────────────────
  function getHostiles(radius = CONFIG.SCAN_RADIUS) {
    return Object.values(bot.entities)
      .filter(e => {
        if (!e?.name || e.type !== 'mob') return false;
        return (
          HOSTILE_NAMES.has(e.name.toLowerCase()) &&
          bot.entity.position.distanceTo(e.position) < radius
        );
      })
      .sort((a, b) => {
        const configA = HOSTILE_MOBS.find(m => m.name === a.name.toLowerCase());
        const configB = HOSTILE_MOBS.find(m => m.name === b.name.toLowerCase());
        const dangerA = configA?.danger ?? 1;
        const dangerB = configB?.danger ?? 1;
        const distA = bot.entity.position.distanceTo(a.position);
        const distB = bot.entity.position.distanceTo(b.position);
        // Score = danger * (1 / dist) — lebih dekat & lebih berbahaya = priority lebih tinggi
        return dangerB / distB - dangerA / distA;
      });
  }

  function isViable() {
    return getHostiles().length > 0;
  }

  // ── Equip armor terbaik ───────────────────────────────────────
  async function equipArmor() {
    for (const [slot, list] of Object.entries(ARMOR_SLOTS)) {
      await equipBest(bot, list, slot).catch(() => {});
    }
  }

  // ── Equip senjata terbaik ────────────────────────────────────
  async function equipWeapon() {
    const weapon = await equipBest(bot, WEAPONS, 'hand');
    if (!weapon) {
      // Tidak ada senjata → coba fetch dari storage
      for (const w of WEAPONS) {
        const ok = await getStorage()
          .fetchFromStorage(w, 1)
          .catch(() => false);
        if (ok) {
          await equipBest(bot, WEAPONS, 'hand').catch(() => {});
          break;
        }
      }
    }
  }

  // ── Shield blocking ──────────────────────────────────────────
  function activateShield() {
    const shield = bot.inventory.items().find(i => i.name === 'shield');
    if (!shield) return;
    try {
      bot.equip(shield, 'off-hand');
      bot.activateItem(false); // off-hand use
    } catch (_) {}
  }

  // ── Makan untuk heal ─────────────────────────────────────────
  async function eatToHeal() {
    if (bot.food >= CONFIG.HP_EAT_THRESHOLD && bot.health >= CONFIG.HP_LOW) return false;

    const food = bot.inventory.items().find(i => HEALING_FOODS.includes(i.name));
    if (!food) {
      // Coba fetch dari storage
      for (const f of HEALING_FOODS) {
        const ok = await getStorage()
          .fetchFromStorage(f, 4)
          .catch(() => false);
        if (ok) break;
      }
      return false;
    }

    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      civ.addLog(`[${bot.username}] 🍖 Makan ${food.name} (HP: ${bot.health.toFixed(1)})`);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── Lari dari creeper yang mau meledak ──────────────────────
  async function fleeCreeper(creeper) {
    const dist = bot.entity.position.distanceTo(creeper.position);
    if (dist > CONFIG.CREEPER_FLEE_DIST) return;

    console.log(`[${bot.username}] 💨 LARI dari creeper!`);
    const fleePos = bot.entity.position.plus(
      bot.entity.position.minus(creeper.position).normalize().scale(10)
    );
    try {
      bot.pathfinder.setGoal(new goals.GoalNear(fleePos.x, fleePos.y, fleePos.z, 2), true);
      await waitMs(1500);
    } catch (_) {}
  }

  // ── Retreat ke base jika HP kritis ──────────────────────────
  async function retreatToBase() {
    if (retreating) return;
    retreating = true;
    stats.retreats++;

    console.log(`[${bot.username}] 🚨 HP kritis (${bot.health.toFixed(1)}) — mundur ke base!`);
    civ.addLog(`[${bot.username}] 🚨 Mundur ke base (HP: ${bot.health.toFixed(1)})`);

    try {
      await withUnstuck(
        bot,
        () => bot.pathfinder.goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 5)),
        CONFIG.GOTO_TIMEOUT * 3
      );
      // Heal di base
      await eatToHeal();
      await waitMs(2000);
    } catch (_) {
    } finally {
      retreating = false;
    }
  }

  // ── Serang satu target ────────────────────────────────────────
  async function attackTarget(entity, mobConfig) {
    const isCreeper = mobConfig?.explosiveCharge;
    const isRanged = mobConfig?.ranged;
    const minDist = mobConfig?.minEngageDist ?? 2;

    // Lari dari creeper yang terlalu dekat
    if (isCreeper) {
      await fleeCreeper(entity);
    }

    // Untuk mob ranged (skeleton): jaga jarak + strafe
    let engageDist = isRanged ? 4 : minDist;

    try {
      await withUnstuck(
        bot,
        () =>
          bot.pathfinder.goto(
            new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, engageDist)
          ),
        CONFIG.GOTO_TIMEOUT
      );
    } catch (_) {}

    if (!entity.isValid) return false;

    // Aktifkan shield untuk ranged mob
    if (isRanged) activateShield();

    let swings = 0;
    let killed = false;

    while (entity.isValid && swings < CONFIG.MAX_SWINGS) {
      // Cek HP sebelum setiap swing
      if (bot.health <= CONFIG.HP_CRITICAL) {
        console.log(`[${bot.username}] HP kritis saat combat!`);
        break;
      }

      // Jaga jarak dari creeper saat menyerang
      if (isCreeper) {
        const dist = bot.entity.position.distanceTo(entity.position);
        if (dist < CONFIG.CREEPER_FLEE_DIST) {
          await fleeCreeper(entity);
          continue;
        }
      }

      try {
        bot.attack(entity);
      } catch (_) {
        break;
      }
      await waitMs(CONFIG.ATTACK_DELAY_MS);
      swings++;

      if (!entity.isValid) {
        killed = true;
        break;
      }
    }

    if (killed) {
      stats.kills++;
      civ.addLog(`[${bot.username}] ⚔️ Kill ${entity.name} (total: ${stats.kills})`);
    }

    return killed;
  }

  // ── Patrol sekitar home base untuk clear mob ─────────────────
  async function patrolHomeBase() {
    const hostiles = getHostiles(CONFIG.HOME_PATROL_RADIUS);
    if (!hostiles.length) return false;

    for (const mob of hostiles.slice(0, 3)) {
      const mobConfig = HOSTILE_MOBS.find(m => m.name === mob.name.toLowerCase());
      await attackTarget(mob, mobConfig);
      if (bot.health <= CONFIG.HP_CRITICAL) break;
    }
    return true;
  }

  // ── MAIN RUN ─────────────────────────────────────────────────
  async function run() {
    if (active || retreating) return;
    active = true;

    try {
      const hostiles = getHostiles();

      // Tidak ada mob → clear threat flag & stop
      if (!hostiles.length) {
        civ.updateState(s => {
          s.threats.hostileMobs = false;
        });
        active = false;
        return;
      }

      // Tandai ada ancaman
      civ.updateState(s => {
        s.threats.hostileMobs = true;
        s.threats.lastThreatAt = new Date().toISOString();
      });

      // HP kritis → mundur
      if (bot.health <= CONFIG.HP_CRITICAL) {
        active = false;
        await retreatToBase();
        return;
      }

      // HP rendah → makan dulu
      if (bot.health <= CONFIG.HP_LOW) {
        await eatToHeal();
        if (bot.health <= CONFIG.HP_CRITICAL) {
          active = false;
          await retreatToBase();
          return;
        }
      }

      // Equip armor & senjata
      await equipArmor();
      await equipWeapon();

      // Serang target teratas
      const target = hostiles[0];
      const mobConfig = HOSTILE_MOBS.find(m => m.name === target.name.toLowerCase());

      await attackTarget(target, mobConfig);

      // Heal setelah pertarungan
      await eatToHeal();

      // Cek mob tersisa
      const remaining = getHostiles().length;
      if (remaining === 0) {
        civ.updateState(s => {
          s.threats.hostileMobs = false;
        });
        civ.addLog(`[${bot.username}] ✅ Area aman — semua mob dikalahkan`);
      }
    } catch (err) {
      console.error(`[${bot.username}] [combat ERROR] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'combat',
    label: '⚔️ Combat',
    isViable,

    getStats() {
      return { ...stats };
    },

    // Trigger patrol manual dari luar
    async patrolBase() {
      return patrolHomeBase();
    },

    start() {
      civ.addLog(`[${bot.username}] ⚔️ Combat dimulai`);
      interval = setInterval(run, CONFIG.TICK_MS);
    },

    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      retreating = false;
      civ.updateState(s => {
        s.threats.hostileMobs = false;
      });
      civ.addLog(`[${bot.username}] 🛑 Combat dihentikan | Kills: ${stats.kills}`);
    },
  };
};
