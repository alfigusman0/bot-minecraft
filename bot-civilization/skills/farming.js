/**
 * FARMING SKILL — SiPetani
 *
 * Prioritas (berurutan):
 * 1. Jika food < 8 → langsung berburu (cepat dapat makanan)
 * 2. Jika ada tanaman mature → panen + tanam ulang
 * 3. Jika hewan >= 4 sepasang → breed (ternak)
 * 4. Jika hewan >= 2 → biarkan, cari sumber makanan lain
 * 5. Gunakan bone meal untuk percepat tanaman
 * 6. Jika tidak ada tanaman → cari seeds dari storage / dunia
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem, countItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const { HOME_BASE, LAYOUT } = require('../core/config');

const CROP_TYPES = [
  { name: 'wheat', seedName: 'wheat_seeds', matureAge: 7, foodValue: 2 },
  { name: 'carrots', seedName: 'carrot', matureAge: 7, foodValue: 3 },
  { name: 'potatoes', seedName: 'potato', matureAge: 7, foodValue: 3 },
  { name: 'beetroots', seedName: 'beetroot_seeds', matureAge: 3, foodValue: 1 },
];

// Pasangan breed: item yang diperlukan & hewan yang dibreed
const BREED_CONFIGS = [
  { animal: 'cow', breedItem: 'wheat', minPop: 2, foodDrop: 'beef', cookDrop: 'cooked_beef' },
  { animal: 'sheep', breedItem: 'wheat', minPop: 2, foodDrop: 'mutton', cookDrop: 'cooked_mutton' },
  {
    animal: 'pig',
    breedItem: 'carrot',
    minPop: 2,
    foodDrop: 'porkchop',
    cookDrop: 'cooked_porkchop',
  },
  {
    animal: 'chicken',
    breedItem: 'seeds',
    minPop: 2,
    foodDrop: 'chicken',
    cookDrop: 'cooked_chicken',
  },
];

const SWORDS = ['iron_sword', 'stone_sword', 'wooden_sword'];
const FOODS = [
  'cooked_beef',
  'cooked_porkchop',
  'cooked_chicken',
  'cooked_mutton',
  'bread',
  'carrot',
  'potato',
];
const MIN_HUNT_POP = 3; // Jangan bunuh jika populasi <= ini

module.exports = function farmingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;
  let mode = 'auto'; // 'auto' | 'farm' | 'hunt' | 'breed'

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  // ── Deteksi apakah ada tanaman / lahan ──────────────────
  function hasCrops() {
    for (const crop of CROP_TYPES) {
      const id = mcData.blocksByName[crop.name]?.id;
      if (id && bot.findBlock({ matching: id, maxDistance: 48 })) return true;
    }
    return false;
  }

  function isViable() {
    const food = civ.getState().resources.food;
    if (food < 32) return true; // Selalu aktif jika food kurang
    return hasCrops(); // Tetap farming meski food cukup
  }

  // ── PANEN & TANAM ULANG ────────────────────────────────
  async function doFarming() {
    for (const crop of CROP_TYPES) {
      const cropId = mcData.blocksByName[crop.name]?.id;
      if (!cropId) continue;

      // Cari tanaman matang
      const mature = bot.findBlock({
        matching: cropId,
        maxDistance: 48,
        useExtraInfo: b => b.getProperties().age === crop.matureAge,
      });

      if (mature) {
        await withUnstuck(bot, () =>
          bot.pathfinder.goto(
            new goals.GoalNear(mature.position.x, mature.position.y, mature.position.z, 2)
          )
        );
        const fresh = bot.blockAt(mature.position);
        if (!fresh || fresh.getProperties().age !== crop.matureAge) continue;

        await bot.dig(fresh);
        await waitMs(500);

        // Tanam ulang dari seed yang baru didapat atau stok
        const seed = bot.inventory.items().find(i => i.name === crop.seedName);
        if (seed) {
          await bot.equip(seed, 'hand');
          const ground = bot.blockAt(mature.position);
          if (ground?.name === 'farmland') {
            await bot.placeBlock(ground, new Vec3(0, 1, 0)).catch(() => {});
          }
        }

        const gained = crop.foodValue;
        civ.addResources({ food: gained, wheat: crop.name === 'wheat' ? 1 : 0 });
        civ.addLog(`[${bot.username}] 🌾 Panen ${crop.name} (+${gained} food)`);
        return true;
      }

      // Tanaman muda → bone meal
      if (hasItem(bot, 'bone_meal')) {
        const young = bot.findBlock({
          matching: cropId,
          maxDistance: 48,
          useExtraInfo: b => b.getProperties().age < crop.matureAge,
        });
        if (young) {
          await bot.equip(
            bot.inventory.items().find(i => i.name === 'bone_meal'),
            'hand'
          );
          await withUnstuck(bot, () =>
            bot.pathfinder.goto(
              new goals.GoalNear(young.position.x, young.position.y, young.position.z, 2)
            )
          );
          await bot.activateBlock(young);
          return true;
        }
      }
    }
    return false;
  }

  // ── ENSURE SEEDS (cari di storage / drop) ─────────────
  async function ensureSeeds() {
    for (const crop of CROP_TYPES) {
      if (hasItem(bot, crop.seedName, 4)) return true;
    }
    for (const crop of CROP_TYPES) {
      if (await getStorage().fetchFromStorage(crop.seedName, 16)) return true;
    }
    // Cari wheat_seeds dari rumput
    const grassId = mcData.blocksByName['grass']?.id || mcData.blocksByName['short_grass']?.id;
    if (grassId) {
      const grass = bot.findBlock({ matching: grassId, maxDistance: 32 });
      if (grass) {
        await withUnstuck(bot, () =>
          bot.pathfinder.goto(
            new goals.GoalNear(grass.position.x, grass.position.y, grass.position.z, 2)
          )
        );
        await bot.dig(grass);
        await waitMs(300);
        return hasItem(bot, 'wheat_seeds');
      }
    }
    return false;
  }

  // ── BERBURU (cepat dapat makanan) ─────────────────────
  async function doHunt() {
    const prey = Object.values(bot.entities).find(e => {
      if (!e?.name) return false;
      const name = e.name.toLowerCase();
      const cfg = BREED_CONFIGS.find(c => c.animal === name);
      if (!cfg) return false;
      const pop = countNearby(name);
      return pop > MIN_HUNT_POP && bot.entity.position.distanceTo(e.position) < 40;
    });

    if (!prey) return false;

    await equipBest(bot, SWORDS, 'hand');
    await withUnstuck(bot, () =>
      bot.pathfinder.goto(new goals.GoalNear(prey.position.x, prey.position.y, prey.position.z, 2))
    );
    let a = 0;
    while (prey.isValid && a < 15) {
      bot.attack(prey);
      await waitMs(700);
      a++;
    }
    await waitMs(800);

    civ.addResources({ food: 4 });
    civ.addLog(`[${bot.username}] 🥩 Berburu ${prey.name}`);
    return true;
  }

  // ── TERNAK (breed hewan agar populasi tumbuh) ─────────
  function countNearby(name) {
    return Object.values(bot.entities).filter(
      e => e?.name?.toLowerCase() === name && bot.entity.position.distanceTo(e.position) < 32
    ).length;
  }

  async function doBreed() {
    for (const cfg of BREED_CONFIGS) {
      const pop = countNearby(cfg.animal);
      if (pop < 2) continue; // Tidak ada pasangan

      // Pastikan punya breed item
      const breedItem = bot.inventory
        .items()
        .find(i => i.name === cfg.breedItem || i.name === 'wheat_seeds');
      if (!breedItem && !(await getStorage().fetchFromStorage(cfg.breedItem, 4))) continue;

      // Cari 2 hewan untuk breed
      const animals = Object.values(bot.entities)
        .filter(
          e =>
            e?.name?.toLowerCase() === cfg.animal && bot.entity.position.distanceTo(e.position) < 32
        )
        .slice(0, 2);

      if (animals.length < 2) continue;

      const item = bot.inventory
        .items()
        .find(i => i.name === cfg.breedItem || i.name === 'wheat_seeds');
      if (!item) continue;

      await bot.equip(item, 'hand');
      for (const animal of animals) {
        await withUnstuck(bot, () =>
          bot.pathfinder.goto(
            new goals.GoalNear(animal.position.x, animal.position.y, animal.position.z, 2)
          )
        );
        await bot.activateEntity(animal).catch(() => {});
        await waitMs(500);
      }

      civ.addLog(`[${bot.username}] 🐄 Breed ${cfg.animal}`);
      return true;
    }
    return false;
  }

  // ── MASAK makanan mentah ──────────────────────────────
  async function cookFood() {
    const rawFoods = ['beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon'];
    const raw = bot.inventory.items().find(i => rawFoods.includes(i.name));
    if (!raw) return false;

    const furnaceId = mcData.blocksByName['furnace']?.id;
    const furnace = furnaceId ? bot.findBlock({ matching: furnaceId, maxDistance: 32 }) : null;
    if (!furnace) return false;

    try {
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(furnace.position.x, furnace.position.y, furnace.position.z, 2)
        )
      );
      const furnaceWindow = await bot.openFurnace(furnace);
      await furnaceWindow.putInput(raw.type, null, raw.count);
      const fuel = bot.inventory
        .items()
        .find(i => ['coal', 'charcoal', 'oak_log', 'oak_planks'].includes(i.name));
      if (fuel) await furnaceWindow.putFuel(fuel.type, null, Math.min(fuel.count, 8));
      await waitMs(1000);
      await furnaceWindow.close();
      civ.addLog(`[${bot.username}] 🔥 Masak ${raw.name}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── MAIN RUN ──────────────────────────────────────────
  async function run() {
    if (active) return;
    active = true;

    try {
      await getStorage().checkAndDeposit();

      const state = civ.getState();
      const food = state.resources.food;

      // 1. Masak makanan mentah jika ada
      await cookFood();

      // 2. Food kritis → berburu langsung
      if (food < 8) {
        const hunted = await doHunt();
        if (!hunted) await ensureSeeds(); // Kalau tidak ada hewan, cari seeds
        active = false;
        return;
      }

      // 3. Panen tanaman jika ada
      const farmed = await doFarming();
      if (farmed) {
        active = false;
        return;
      }

      // 4. Food menipis → berburu
      if (food < 24) {
        const hunted = await doHunt();
        if (hunted) {
          active = false;
          return;
        }
      }

      // 5. Breed hewan (populasi cukup)
      const bred = await doBreed();
      if (bred) {
        active = false;
        return;
      }

      // 6. Tidak ada crop → pastikan punya seeds, jika ada tanam
      const hasSeeds = await ensureSeeds();
      if (hasSeeds) {
        // Cari lahan farmland kosong untuk tanam
        const farmlandId = mcData.blocksByName['farmland']?.id;
        if (farmlandId) {
          const empty = bot.findBlock({
            matching: farmlandId,
            maxDistance: 48,
            useExtraInfo: b => bot.blockAt(b.position.offset(0, 1, 0))?.name === 'air',
          });
          if (empty) {
            for (const crop of CROP_TYPES) {
              const seed = bot.inventory.items().find(i => i.name === crop.seedName);
              if (!seed) continue;
              await bot.equip(seed, 'hand');
              await withUnstuck(bot, () =>
                bot.pathfinder.goto(
                  new goals.GoalNear(empty.position.x, empty.position.y, empty.position.z, 2)
                )
              );
              await bot.placeBlock(empty, new Vec3(0, 1, 0)).catch(() => {});
              civ.addLog(`[${bot.username}] 🌱 Tanam ${crop.name}`);
              break;
            }
          }
        }
      }

      // 7. Bone meal jika ada → percepat tanaman
      if (hasItem(bot, 'bone_meal')) await doFarming();
    } catch (err) {
      console.log(`[${bot.username}] [farming] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'farming',
    label: '🌾 Farming',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] 🌾 Mulai farming (farm+hunt+breed)`);
      interval = setInterval(run, 2500);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
