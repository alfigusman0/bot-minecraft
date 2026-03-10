/**
 * FARMING SKILL — SiPetani (Professional Edition)
 *
 * Fitur Utama:
 * - Multi-crop farming dengan lifecycle management lengkap
 * - Smart hunt dengan population control (tidak punah)
 * - Advanced breeding system dengan cooldown tracking
 * - Auto-cook dengan manajemen furnace & fuel prioritas
 * - Bone meal optimizer untuk percepat panen
 * - Aquaculture (fishing) sebagai sumber makanan pasif
 * - Animal pen detection & auto-herding
 * - Crop rotation & soil management
 * - Resource tracking terperinci
 * - Configurable mode: auto | farm | hunt | breed | fish | cook
 */

'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem, countItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const { HOME_BASE, LAYOUT } = require('../core/config');

// ─────────────────────────────────────────────
//  CONSTANTS & CONFIG
// ─────────────────────────────────────────────

const FARMING_CONFIG = {
  TICK_INTERVAL_MS: 2500,
  GOTO_TIMEOUT_MS: 12000,
  ATTACK_DELAY_MS: 650,
  MAX_ATTACK_SWINGS: 20,
  SCAN_RADIUS: 48,
  BREED_COOLDOWN_MS: 60_000, // Cooldown per spesies setelah breed
  HUNT_POP_MINIMUM: 4, // Populasi min sebelum boleh diburu
  HUNT_POP_SAFE_BUFFER: 2, // Sisakan minimal ini setelah berburu
  FOOD_CRITICAL: 8,
  FOOD_LOW: 24,
  FOOD_COMFORTABLE: 64,
  DEPOSIT_EVERY_N_TICKS: 20,
  BONE_MEAL_CHANCE: 0.6, // Probabilitas bone meal per tick
  FURNACE_WAIT_MS: 3000,
  FISH_CAST_DURATION_MS: 8000,
  MAX_SEEDS_STACK: 32,
};

// ── Crop Definitions ─────────────────────────

const CROP_TYPES = [
  {
    name: 'wheat',
    seedName: 'wheat_seeds',
    matureAge: 7,
    foodValue: 2,
    priority: 3,
    replant: true,
    boneMealable: true,
  },
  {
    name: 'carrots',
    seedName: 'carrot',
    matureAge: 7,
    foodValue: 3,
    priority: 4,
    replant: true,
    boneMealable: true,
  },
  {
    name: 'potatoes',
    seedName: 'potato',
    matureAge: 7,
    foodValue: 4,
    priority: 4,
    replant: true,
    boneMealable: true,
  },
  {
    name: 'beetroots',
    seedName: 'beetroot_seeds',
    matureAge: 3,
    foodValue: 1,
    priority: 2,
    replant: true,
    boneMealable: true,
  },
  {
    name: 'melon_stem',
    seedName: 'melon_seeds',
    matureAge: 7,
    foodValue: 2,
    priority: 3,
    replant: false,
    boneMealable: true,
    harvestBlock: 'melon',
  },
  {
    name: 'pumpkin_stem',
    seedName: 'pumpkin_seeds',
    matureAge: 7,
    foodValue: 0,
    priority: 1,
    replant: false,
    boneMealable: true,
    harvestBlock: 'pumpkin',
  },
  {
    name: 'sweet_berry_bush',
    seedName: 'sweet_berries',
    matureAge: 3,
    foodValue: 2,
    priority: 2,
    replant: false,
    boneMealable: false,
  },
  {
    name: 'nether_wart',
    seedName: 'nether_wart',
    matureAge: 3,
    foodValue: 0,
    priority: 1,
    replant: true,
    boneMealable: false,
  },
  {
    name: 'sugar_cane',
    seedName: 'sugar_cane',
    matureAge: -1, // Tidak pakai age, cek ketinggian
    foodValue: 0,
    priority: 1,
    replant: false,
    boneMealable: false,
    heightHarvest: true,
  },
  {
    name: 'bamboo',
    seedName: 'bamboo',
    matureAge: -1,
    foodValue: 0,
    priority: 1,
    replant: false,
    boneMealable: false,
    heightHarvest: true,
  },
  {
    name: 'cactus',
    seedName: 'cactus',
    matureAge: -1,
    foodValue: 0,
    priority: 1,
    replant: false,
    boneMealable: false,
    heightHarvest: true,
  },
  {
    name: 'kelp',
    seedName: 'kelp',
    matureAge: -1,
    foodValue: 1,
    priority: 2,
    replant: false,
    boneMealable: false,
    underwater: true,
  },
];

// ── Animal Definitions ───────────────────────

const ANIMAL_CONFIGS = [
  {
    animal: 'cow',
    breedItems: ['wheat'],
    minPop: 2,
    foodDrop: 'beef',
    cookDrop: 'cooked_beef',
    foodValue: 8,
    secondary: 'leather',
    priority: 5,
  },
  {
    animal: 'sheep',
    breedItems: ['wheat'],
    minPop: 2,
    foodDrop: 'mutton',
    cookDrop: 'cooked_mutton',
    foodValue: 6,
    secondary: 'white_wool',
    priority: 4,
  },
  {
    animal: 'pig',
    breedItems: ['carrot', 'potato', 'beetroot'],
    minPop: 2,
    foodDrop: 'porkchop',
    cookDrop: 'cooked_porkchop',
    foodValue: 8,
    secondary: null,
    priority: 5,
  },
  {
    animal: 'chicken',
    breedItems: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'],
    minPop: 3,
    foodDrop: 'chicken',
    cookDrop: 'cooked_chicken',
    foodValue: 6,
    secondary: 'feather',
    priority: 3,
    alsoDrops: 'egg',
  },
  {
    animal: 'rabbit',
    breedItems: ['carrot', 'dandelion', 'golden_carrot'],
    minPop: 2,
    foodDrop: 'rabbit',
    cookDrop: 'cooked_rabbit',
    foodValue: 5,
    secondary: 'rabbit_hide',
    priority: 3,
  },
  {
    animal: 'mooshroom',
    breedItems: ['wheat'],
    minPop: 2,
    foodDrop: 'beef',
    cookDrop: 'cooked_beef',
    foodValue: 8,
    secondary: 'mushroom_stew',
    priority: 4,
  },
  {
    animal: 'goat',
    breedItems: ['wheat'],
    minPop: 2,
    foodDrop: 'mutton',
    cookDrop: 'cooked_mutton',
    foodValue: 6,
    secondary: 'goat_horn',
    priority: 3,
  },
  {
    animal: 'hoglin',
    breedItems: ['crimson_fungus'],
    minPop: 2,
    foodDrop: 'porkchop',
    cookDrop: 'cooked_porkchop',
    foodValue: 8,
    secondary: null,
    priority: 4,
    nether: true,
  },
  {
    animal: 'strider',
    breedItems: ['warped_fungus'],
    minPop: 2,
    foodDrop: null,
    cookDrop: null,
    foodValue: 0,
    secondary: 'string',
    priority: 1,
    nether: true,
  },
  {
    animal: 'bee',
    breedItems: ['flower'],
    minPop: 2,
    foodDrop: null,
    cookDrop: null,
    foodValue: 0,
    secondary: 'honeycomb',
    priority: 2,
  },
  {
    animal: 'turtle',
    breedItems: ['seagrass'],
    minPop: 2,
    foodDrop: null,
    cookDrop: null,
    foodValue: 0,
    secondary: 'scute',
    priority: 1,
  },
];

const FUEL_PRIORITY = [
  'coal',
  'charcoal',
  'blaze_rod',
  'oak_log',
  'spruce_log',
  'birch_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'stick',
];

const RAW_FOODS = [
  'beef',
  'porkchop',
  'chicken',
  'mutton',
  'rabbit',
  'cod',
  'salmon',
  'tropical_fish',
  'pufferfish',
];

const COOKED_FOODS = [
  'cooked_beef',
  'cooked_porkchop',
  'cooked_chicken',
  'cooked_mutton',
  'cooked_rabbit',
  'cooked_cod',
  'cooked_salmon',
  'bread',
  'carrot',
  'baked_potato',
  'apple',
  'melon_slice',
  'sweet_berries',
  'glow_berries',
  'mushroom_stew',
  'rabbit_stew',
  'beetroot_soup',
  'pumpkin_pie',
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

// ─────────────────────────────────────────────
//  UTILITY HELPERS
// ─────────────────────────────────────────────

function countNearby(bot, animalName, radius = FARMING_CONFIG.SCAN_RADIUS) {
  return Object.values(bot.entities).filter(
    e =>
      e?.name?.toLowerCase() === animalName.toLowerCase() &&
      bot.entity.position.distanceTo(e.position) < radius
  ).length;
}

function getNearbyAnimals(bot, animalName, radius = FARMING_CONFIG.SCAN_RADIUS) {
  return Object.values(bot.entities)
    .filter(
      e =>
        e?.name?.toLowerCase() === animalName.toLowerCase() &&
        bot.entity.position.distanceTo(e.position) < radius
    )
    .sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
    );
}

function getInventoryFood(bot) {
  return bot.inventory
    .items()
    .filter(i => COOKED_FOODS.includes(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}

function getInventoryRaw(bot) {
  return bot.inventory.items().filter(i => RAW_FOODS.includes(i.name));
}

function getBestSeed(bot, crop) {
  return bot.inventory.items().find(i => i.name === crop.seedName) ?? null;
}

function getFuel(bot) {
  for (const f of FUEL_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === f);
    if (item) return item;
  }
  return null;
}

async function gotoBlock(bot, block, dist = 2) {
  const p = block.position || block;
  return withUnstuck(
    bot,
    () => bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, dist)),
    FARMING_CONFIG.GOTO_TIMEOUT_MS
  );
}

async function gotoEntity(bot, entity, dist = 2) {
  return withUnstuck(
    bot,
    () =>
      bot.pathfinder.goto(
        new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, dist)
      ),
    FARMING_CONFIG.GOTO_TIMEOUT_MS
  );
}

// ─────────────────────────────────────────────
//  FARMING SUBSYSTEMS
// ─────────────────────────────────────────────

// ── 1. Crop Manager ──────────────────────────

class CropManager {
  constructor(bot, mcData) {
    this.bot = bot;
    this.mcData = mcData;
  }

  /** Cari tanaman matang terdekat (semua jenis) */
  findMatureCrop() {
    let best = null;
    let bestDist = Infinity;

    for (const crop of CROP_TYPES.sort((a, b) => b.priority - a.priority)) {
      if (crop.heightHarvest || crop.underwater) continue;

      // Harvest block terpisah (melon, pumpkin)
      if (crop.harvestBlock) {
        const blockId = this.mcData.blocksByName[crop.harvestBlock]?.id;
        if (!blockId) continue;
        const block = this.bot.findBlock({
          matching: blockId,
          maxDistance: FARMING_CONFIG.SCAN_RADIUS,
        });
        if (block) {
          const d = this.bot.entity.position.distanceTo(block.position);
          if (d < bestDist) {
            best = { block, crop };
            bestDist = d;
          }
        }
        continue;
      }

      const blockId = this.mcData.blocksByName[crop.name]?.id;
      if (!blockId) continue;

      const block = this.bot.findBlock({
        matching: blockId,
        maxDistance: FARMING_CONFIG.SCAN_RADIUS,
        useExtraInfo: b => {
          try {
            return Number(b.getProperties().age) === crop.matureAge;
          } catch (_) {
            return false;
          }
        },
      });

      if (block) {
        const d = this.bot.entity.position.distanceTo(block.position);
        if (d < bestDist) {
          best = { block, crop };
          bestDist = d;
        }
      }
    }

    return best;
  }

  /** Cari tanaman height-harvest (sugar cane, bamboo, cactus) */
  findHeightHarvestable() {
    for (const crop of CROP_TYPES.filter(c => c.heightHarvest)) {
      const blockId = this.mcData.blocksByName[crop.name]?.id;
      if (!blockId) continue;

      // Cari yang ada blok sejenis di atasnya (sudah tumbuh >=2)
      const block = this.bot.findBlock({
        matching: blockId,
        maxDistance: FARMING_CONFIG.SCAN_RADIUS,
        useExtraInfo: b => {
          const above = this.bot.blockAt(b.position.offset(0, 1, 0));
          return above?.name === crop.name;
        },
      });
      if (block) return { block, crop };
    }
    return null;
  }

  /** Panen satu crop dan tanam ulang */
  async harvest(block, crop) {
    try {
      await gotoBlock(this.bot, block);

      const fresh = this.bot.blockAt(block.position);
      if (!fresh) return false;

      // Harvest block terpisah
      if (crop.harvestBlock && fresh.name === crop.harvestBlock) {
        await this.bot.dig(fresh);
        await waitMs(300);
        civ.addResources({ food: crop.foodValue * 3 });
        civ.addLog(`[${this.bot.username}] 🍈 Panen ${crop.harvestBlock}`);
        return true;
      }

      // Age check
      if (crop.matureAge >= 0) {
        try {
          const age = Number(fresh.getProperties().age);
          if (age !== crop.matureAge) return false;
        } catch (_) {
          return false;
        }
      }

      await this.bot.dig(fresh);
      await waitMs(250);

      // Tanam ulang
      if (crop.replant) await this.replant(block.position, crop);

      civ.addResources({ food: crop.foodValue });
      civ.addLog(`[${this.bot.username}] 🌾 Panen ${crop.name} (+${crop.foodValue})`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Panen sugar cane / bamboo: hanya bagian atas (biarkan akar) */
  async harvestHeight(block, crop) {
    try {
      await gotoBlock(this.bot, block, 3);
      const above = this.bot.blockAt(block.position.offset(0, 1, 0));
      if (!above || above.name !== crop.name) return false;
      await this.bot.dig(above);
      await waitMs(200);
      civ.addLog(`[${this.bot.username}] 🎋 Panen ${crop.name}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Tanam seed di farmland kosong */
  async replant(pos, crop) {
    const seed = getBestSeed(this.bot, crop);
    if (!seed) return false;

    try {
      const ground = this.bot.blockAt(pos);
      if (!ground || ground.name !== 'farmland') return false;
      const above = this.bot.blockAt(pos.offset(0, 1, 0));
      if (above && above.name !== 'air') return false;

      await this.bot.equip(seed, 'hand');
      await this.bot.placeBlock(ground, new Vec3(0, 1, 0));
      civ.addLog(`[${this.bot.username}] 🌱 Tanam ulang ${crop.name}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Tanam seed di lahan kosong yang belum diisi */
  async plantEmptyFarmland(crop) {
    const farmlandId = this.mcData.blocksByName['farmland']?.id;
    if (!farmlandId) return false;

    const seed = getBestSeed(this.bot, crop);
    if (!seed) return false;

    const empty = this.bot.findBlock({
      matching: farmlandId,
      maxDistance: FARMING_CONFIG.SCAN_RADIUS,
      useExtraInfo: b => {
        const above = this.bot.blockAt(b.position.offset(0, 1, 0));
        return above?.name === 'air';
      },
    });

    if (!empty) return false;

    try {
      await gotoBlock(this.bot, empty);
      await this.bot.equip(seed, 'hand');
      await this.bot.placeBlock(empty, new Vec3(0, 1, 0));
      civ.addLog(`[${this.bot.username}] 🌱 Tanam ${crop.name}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Gunakan bone meal pada tanaman muda */
  async applyBoneMeal() {
    if (!hasItem(this.bot, 'bone_meal')) return false;
    if (Math.random() > FARMING_CONFIG.BONE_MEAL_CHANCE) return false;

    for (const crop of CROP_TYPES.filter(c => c.boneMealable)) {
      const blockId = this.mcData.blocksByName[crop.name]?.id;
      if (!blockId) continue;

      const young = this.bot.findBlock({
        matching: blockId,
        maxDistance: FARMING_CONFIG.SCAN_RADIUS,
        useExtraInfo: b => {
          try {
            return Number(b.getProperties().age) < crop.matureAge;
          } catch (_) {
            return false;
          }
        },
      });

      if (!young) continue;

      try {
        const boneMeal = this.bot.inventory.items().find(i => i.name === 'bone_meal');
        if (!boneMeal) return false;
        await this.bot.equip(boneMeal, 'hand');
        await gotoBlock(this.bot, young);
        await this.bot.activateBlock(young);
        civ.addLog(`[${this.bot.username}] 🦴 Bone meal → ${crop.name}`);
        return true;
      } catch (_) {}
    }
    return false;
  }

  /** Tillage: bajak tanah menjadi farmland */
  async tillGround() {
    const hoeNames = [
      'netherite_hoe',
      'diamond_hoe',
      'iron_hoe',
      'stone_hoe',
      'wooden_hoe',
      'golden_hoe',
    ];
    const hoe = this.bot.inventory.items().find(i => hoeNames.includes(i.name));
    if (!hoe) return false;

    const dirtId = this.mcData.blocksByName['dirt']?.id;
    const grassId = this.mcData.blocksByName['grass_block']?.id;
    if (!dirtId && !grassId) return false;

    const target = this.bot.findBlock({
      matching: [dirtId, grassId].filter(Boolean),
      maxDistance: 16,
      useExtraInfo: b => {
        const above = this.bot.blockAt(b.position.offset(0, 1, 0));
        return above?.name === 'air';
      },
    });
    if (!target) return false;

    try {
      await this.bot.equip(hoe, 'hand');
      await gotoBlock(this.bot, target);
      await this.bot.activateBlock(target);
      civ.addLog(`[${this.bot.username}] ⛏️ Bajak tanah untuk farmland`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Ambil seeds dari rumput */
  async collectSeedsFromGrass() {
    const grassNames = ['grass', 'short_grass', 'tall_grass', 'fern', 'large_fern'];
    for (const gName of grassNames) {
      const gId = this.mcData.blocksByName[gName]?.id;
      if (!gId) continue;
      const block = this.bot.findBlock({ matching: gId, maxDistance: 32 });
      if (!block) continue;
      try {
        await gotoBlock(this.bot, block);
        await this.bot.dig(block);
        await waitMs(200);
        if (hasItem(this.bot, 'wheat_seeds')) return true;
      } catch (_) {}
    }
    return false;
  }
}

// ── 2. Animal Manager ─────────────────────────

class AnimalManager {
  constructor(bot, mcData) {
    this.bot = bot;
    this.mcData = mcData;
    this.breedCooldowns = new Map(); // animal -> last breed timestamp
    this.huntCooldowns = new Map(); // animal -> last hunt timestamp
  }

  canBreed(animal) {
    const last = this.breedCooldowns.get(animal) ?? 0;
    return Date.now() - last > FARMING_CONFIG.BREED_COOLDOWN_MS;
  }

  markBred(animal) {
    this.breedCooldowns.set(animal, Date.now());
  }

  /** Breeding: aktifkan 2 hewan dengan item breed */
  async breed() {
    const candidates = ANIMAL_CONFIGS.filter(
      c => this.canBreed(c.animal) && countNearby(this.bot, c.animal) >= 2
    ).sort((a, b) => b.priority - a.priority);

    for (const cfg of candidates) {
      // Cari breed item
      let breedItem = null;
      for (const itemName of cfg.breedItems) {
        breedItem = this.bot.inventory.items().find(i => i.name === itemName);
        if (breedItem) break;
      }
      if (!breedItem) continue;

      const animals = getNearbyAnimals(this.bot, cfg.animal).slice(0, 2);
      if (animals.length < 2) continue;

      await this.bot.equip(breedItem, 'hand');
      let bred = 0;
      for (const animal of animals) {
        try {
          await gotoEntity(this.bot, animal);
          await this.bot.activateEntity(animal);
          await waitMs(400);
          bred++;
        } catch (_) {}
      }
      if (bred >= 2) {
        this.markBred(cfg.animal);
        civ.addLog(
          `[${this.bot.username}] 🐄 Breed ${cfg.animal} (pop: ${countNearby(this.bot, cfg.animal)})`
        );
        return true;
      }
    }
    return false;
  }

  /** Hunting: buru hewan dengan mempertimbangkan populasi */
  async hunt() {
    const candidates = ANIMAL_CONFIGS.filter(c => c.foodDrop && c.cookDrop).sort(
      (a, b) => b.priority - a.priority
    );

    for (const cfg of candidates) {
      const pop = countNearby(this.bot, cfg.animal);
      const safeKillLimit = pop - FARMING_CONFIG.HUNT_POP_SAFE_BUFFER;
      if (pop <= FARMING_CONFIG.HUNT_POP_MINIMUM || safeKillLimit <= 0) continue;

      const animals = getNearbyAnimals(this.bot, cfg.animal);
      if (!animals.length) continue;

      const prey = animals[0];
      await this.attackEntity(prey);

      const drops = this.bot.inventory.items().filter(i => i.name === cfg.foodDrop);
      const gained = drops.reduce((s, i) => s + i.count, 0);
      civ.addResources({ food: cfg.foodValue });
      civ.addLog(
        `[${this.bot.username}] 🥩 Berburu ${cfg.animal} | drop: ${gained}x ${cfg.foodDrop}`
      );
      return true;
    }
    return false;
  }

  /** Serang entitas hingga mati */
  async attackEntity(entity) {
    try {
      await equipBest(this.bot, WEAPONS, 'hand');
    } catch (_) {}

    try {
      await gotoEntity(this.bot, entity, 2);
    } catch (_) {}

    let swings = 0;
    while (entity.isValid && swings < FARMING_CONFIG.MAX_ATTACK_SWINGS) {
      try {
        this.bot.attack(entity);
      } catch (_) {
        break;
      }
      await waitMs(FARMING_CONFIG.ATTACK_DELAY_MS);
      swings++;
    }
    await waitMs(500);
  }

  /** Collect drops di sekitar */
  async collectDrops() {
    const drops = Object.values(this.bot.entities).filter(
      e =>
        e.type === 'object' &&
        e.objectType === 'Item' &&
        this.bot.entity.position.distanceTo(e.position) < 8
    );
    for (const drop of drops) {
      try {
        await gotoEntity(this.bot, drop, 1);
        await waitMs(200);
      } catch (_) {}
    }
  }

  /** Shear domba jika sudah bisa */
  async shearSheep() {
    const shears = this.bot.inventory.items().find(i => i.name === 'shears');
    if (!shears) return false;

    const sheep = getNearbyAnimals(this.bot, 'sheep').find(e => {
      try {
        return e.metadata && !e.metadata[16];
      } catch (_) {
        // bit 4 = shorn
        return true;
      }
    });

    if (!sheep) return false;

    try {
      await this.bot.equip(shears, 'hand');
      await gotoEntity(this.bot, sheep);
      await this.bot.activateEntity(sheep);
      civ.addLog(`[${this.bot.username}] ✂️ Gunting domba`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Milking sapi */
  async milkCow() {
    const bucket = this.bot.inventory.items().find(i => i.name === 'bucket');
    if (!bucket) return false;
    if (this.bot.inventory.items().find(i => i.name === 'milk_bucket')) return false; // Sudah ada

    const cow = getNearbyAnimals(this.bot, 'cow')[0] || getNearbyAnimals(this.bot, 'mooshroom')[0];
    if (!cow) return false;

    try {
      await this.bot.equip(bucket, 'hand');
      await gotoEntity(this.bot, cow);
      await this.bot.activateEntity(cow);
      civ.addLog(`[${this.bot.username}] 🥛 Perah sapi`);
      return true;
    } catch (_) {
      return false;
    }
  }
}

// ── 3. Kitchen Manager ───────────────────────

class KitchenManager {
  constructor(bot, mcData) {
    this.bot = bot;
    this.mcData = mcData;
    this.smokerId = mcData.blocksByName['smoker']?.id;
    this.furnaceId = mcData.blocksByName['furnace']?.id;
    this.campfireId = mcData.blocksByName['campfire']?.id;
  }

  /** Masak makanan mentah di furnace/smoker */
  async cook() {
    const rawItems = getInventoryRaw(this.bot);
    if (!rawItems.length) return false;

    // Pilih smoker dulu (2x lebih cepat), fallback ke furnace
    const cookerBlock = this._findCooker();
    if (!cookerBlock) return await this._campfireCook(rawItems[0]);

    try {
      await gotoBlock(this.bot, cookerBlock);
      const window = await this.bot.openFurnace(cookerBlock);

      const raw = rawItems[0];
      await window.putInput(raw.type, null, raw.count);

      const fuel = getFuel(this.bot);
      if (fuel) {
        const fuelAmount = Math.min(fuel.count, Math.ceil(raw.count / 8) + 1);
        await window.putFuel(fuel.type, null, fuelAmount);
      }

      await waitMs(FARMING_CONFIG.FURNACE_WAIT_MS);

      // Ambil output
      try {
        await window.takeOutput();
      } catch (_) {}
      window.close();

      civ.addLog(`[${this.bot.username}] 🔥 Masak ${raw.name} ×${raw.count}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Masak di campfire jika tidak ada furnace */
  async _campfireCook(rawItem) {
    if (!this.campfireId) return false;
    const campfire = this.bot.findBlock({ matching: this.campfireId, maxDistance: 32 });
    if (!campfire) return false;

    try {
      await gotoBlock(this.bot, campfire);
      await this.bot.equip(rawItem, 'hand');
      await this.bot.activateBlock(campfire);
      await waitMs(2000);
      civ.addLog(`[${this.bot.username}] 🏕️ Masak di campfire: ${rawItem.name}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  _findCooker() {
    if (this.smokerId) {
      const smoker = this.bot.findBlock({ matching: this.smokerId, maxDistance: 32 });
      if (smoker) return smoker;
    }
    if (this.furnaceId) {
      return this.bot.findBlock({ matching: this.furnaceId, maxDistance: 32 });
    }
    return null;
  }

  /** Makan makanan jika lapar */
  async eat() {
    const foodItem = this.bot.inventory.items().find(i => COOKED_FOODS.includes(i.name));
    if (!foodItem) return false;
    if (this.bot.food >= 18) return false; // Tidak lapar

    try {
      await this.bot.equip(foodItem, 'hand');
      await this.bot.consume();
      civ.addLog(`[${this.bot.username}] 🍖 Makan ${foodItem.name}`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Buat bread dari wheat */
  async bakeBread() {
    const wheat = this.bot.inventory.items().find(i => i.name === 'wheat');
    if (!wheat || wheat.count < 3) return false;

    const craftingTable = this._findCraftingTable();
    if (!craftingTable) return false;

    try {
      await gotoBlock(this.bot, craftingTable, 2);
      const recipe = this.bot.recipesFor(
        this.mcData.itemsByName['bread']?.id,
        null,
        1,
        craftingTable
      )[0];
      if (!recipe) return false;
      await this.bot.craft(recipe, 1, craftingTable);
      civ.addLog(`[${this.bot.username}] 🍞 Buat bread`);
      return true;
    } catch (_) {
      return false;
    }
  }

  _findCraftingTable() {
    const id = this.mcData.blocksByName['crafting_table']?.id;
    return id ? this.bot.findBlock({ matching: id, maxDistance: 32 }) : null;
  }
}

// ── 4. Aquaculture Manager (Fishing) ─────────

class AquacultureManager {
  constructor(bot) {
    this.bot = bot;
    this.fishing = false;
  }

  hasFishingRod() {
    return !!this.bot.inventory.items().find(i => i.name === 'fishing_rod');
  }

  async fish() {
    if (!this.hasFishingRod()) return false;

    const water = this.bot.findBlock({
      matching: [this.bot.registry?.blocksByName?.['water']?.id].filter(Boolean),
      maxDistance: 16,
    });
    if (!water) return false;

    try {
      const rod = this.bot.inventory.items().find(i => i.name === 'fishing_rod');
      await this.bot.equip(rod, 'hand');
      await gotoBlock(this.bot, water, 3);

      this.fishing = true;
      this.bot.activateItem(); // cast

      await new Promise(resolve => {
        const onCollect = () => {
          cleanup();
          resolve();
        };
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, FARMING_CONFIG.FISH_CAST_DURATION_MS);
        const cleanup = () => {
          clearTimeout(timeout);
          this.bot.removeListener('playerCollect', onCollect);
        };
        this.bot.once('playerCollect', onCollect);
      });

      this.bot.deactivateItem(); // reel in
      this.fishing = false;
      civ.addLog(`[${this.bot.username}] 🎣 Memancing`);
      return true;
    } catch (_) {
      this.fishing = false;
      return false;
    }
  }
}

// ── 5. Storage & Seed Supply ─────────────────

class SupplyManager {
  constructor(bot, mcData, storageFactory) {
    this.bot = bot;
    this.mcData = mcData;
    this._storage = null;
    this._storageFactory = storageFactory;
    this.fetchCache = new Map();
  }

  get storage() {
    if (!this._storage) this._storage = this._storageFactory(this.bot, this.mcData);
    return this._storage;
  }

  async fetchSeeds() {
    for (const crop of CROP_TYPES) {
      if (hasItem(this.bot, crop.seedName, 4)) return true;
      const last = this.fetchCache.get(crop.seedName) ?? 0;
      if (Date.now() - last < 8000) continue;
      this.fetchCache.set(crop.seedName, Date.now());
      try {
        if (await this.storage.fetchFromStorage(crop.seedName, FARMING_CONFIG.MAX_SEEDS_STACK))
          return true;
      } catch (_) {}
    }
    return false;
  }

  async fetchBreedItems() {
    for (const cfg of ANIMAL_CONFIGS) {
      for (const itemName of cfg.breedItems) {
        if (hasItem(this.bot, itemName, 4)) return true;
        try {
          if (await this.storage.fetchFromStorage(itemName, 8)) return true;
        } catch (_) {}
      }
    }
    return false;
  }

  async depositExcess() {
    try {
      await this.storage.checkAndDeposit();
    } catch (_) {}
  }
}

// ─────────────────────────────────────────────
//  MAIN FARMING SKILL
// ─────────────────────────────────────────────

module.exports = function farmingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let tickCount = 0;

  const crops = new CropManager(bot, mcData);
  const animals = new AnimalManager(bot, mcData);
  const kitchen = new KitchenManager(bot, mcData);
  const fishing = new AquacultureManager(bot);
  const supply = new SupplyManager(bot, mcData, createStorage);

  // Mode: 'auto' | 'farm' | 'hunt' | 'breed' | 'fish' | 'cook'
  let mode = 'auto';

  // Stats
  const stats = {
    harvested: 0,
    hunted: 0,
    bred: 0,
    cooked: 0,
    planted: 0,
  };

  // ── Viability ─────────────────────────────

  function isViable() {
    const food = civ.getState().resources.food;
    if (food < FARMING_CONFIG.FOOD_COMFORTABLE) return true;
    // Cek ada tanaman / hewan
    return CROP_TYPES.some(c => {
      const id = mcData.blocksByName[c.name]?.id;
      return id && bot.findBlock({ matching: id, maxDistance: FARMING_CONFIG.SCAN_RADIUS });
    });
  }

  // ── Main Run ──────────────────────────────

  async function run() {
    if (active) return;
    active = true;
    tickCount++;

    try {
      // Deposit periodic
      if (tickCount % FARMING_CONFIG.DEPOSIT_EVERY_N_TICKS === 0) {
        await supply.depositExcess();
      }

      const foodState = civ.getState().resources.food;
      const invFood = getInventoryFood(bot);
      const invRaw = getInventoryRaw(bot);
      const botHunger = bot.food ?? 20;

      // ── 0. Makan jika lapar ────────────────
      if (botHunger < 15) {
        await kitchen.eat();
      }

      // ── 1. Masak raw food jika ada ─────────
      if (invRaw.length > 0) {
        const cooked = await kitchen.cook();
        if (cooked) {
          stats.cooked++;
          active = false;
          return;
        }
      }

      // ── 2. Buat bread jika ada gandum ──────
      if (mode === 'auto' || mode === 'cook') {
        await kitchen.bakeBread();
      }

      // ── 3. FOOD KRITIS → berburu langsung ─
      if (foodState < FARMING_CONFIG.FOOD_CRITICAL || (invFood === 0 && botHunger < 10)) {
        const hunted = await animals.hunt();
        if (hunted) {
          stats.hunted++;
          await animals.collectDrops();
          await kitchen.cook();
          active = false;
          return;
        }
        // Fallback: fishing
        if (fishing.hasFishingRod()) {
          await fishing.fish();
          active = false;
          return;
        }
      }

      // ── 4. Panen tanaman matang ────────────
      if (mode === 'auto' || mode === 'farm') {
        const mature = crops.findMatureCrop();
        if (mature) {
          const ok = await crops.harvest(mature.block, mature.crop);
          if (ok) {
            stats.harvested++;
            active = false;
            return;
          }
        }

        // Height-harvest (sugar cane, bamboo)
        const hh = crops.findHeightHarvestable();
        if (hh) {
          await crops.harvestHeight(hh.block, hh.crop);
          active = false;
          return;
        }
      }

      // ── 5. Bone meal pada tanaman muda ─────
      if (mode === 'auto' || mode === 'farm') {
        const boned = await crops.applyBoneMeal();
        if (boned) {
          active = false;
          return;
        }
      }

      // ── 6. Food menipis → berburu ──────────
      if (foodState < FARMING_CONFIG.FOOD_LOW && (mode === 'auto' || mode === 'hunt')) {
        const hunted = await animals.hunt();
        if (hunted) {
          stats.hunted++;
          await animals.collectDrops();
          active = false;
          return;
        }
      }

      // ── 7. Breed hewan ─────────────────────
      if (mode === 'auto' || mode === 'breed') {
        // Fetch breed items dulu jika tidak ada
        await supply.fetchBreedItems();
        const bred = await animals.breed();
        if (bred) {
          stats.bred++;
          active = false;
          return;
        }
      }

      // ── 8. Shear domba ─────────────────────
      if (mode === 'auto') {
        await animals.shearSheep();
      }

      // ── 9. Milking ─────────────────────────
      if (mode === 'auto') {
        await animals.milkCow();
      }

      // ── 10. Fishing pasif ──────────────────
      if ((mode === 'auto' || mode === 'fish') && fishing.hasFishingRod()) {
        if (foodState < FARMING_CONFIG.FOOD_LOW) {
          await fishing.fish();
          active = false;
          return;
        }
      }

      // ── 11. Tanam di lahan kosong ──────────
      if (mode === 'auto' || mode === 'farm') {
        await supply.fetchSeeds();
        for (const crop of CROP_TYPES.sort((a, b) => b.priority - a.priority)) {
          if (!hasItem(bot, crop.seedName)) continue;
          const planted = await crops.plantEmptyFarmland(crop);
          if (planted) {
            stats.planted++;
            active = false;
            return;
          }
        }
        // Bajak tanah jika tidak ada farmland
        await crops.tillGround();
        // Ambil seeds dari rumput jika tidak ada
        await crops.collectSeedsFromGrass();
      }
    } catch (err) {
      console.error(`[${bot.username}] [farming ERROR] ${err.message}`);
    }

    active = false;
  }

  // ── Public API ────────────────────────────

  return {
    name: 'farming',
    label: '🌾 Farming',
    isViable,

    /** Set mode operasi */
    setMode(m) {
      const valid = ['auto', 'farm', 'hunt', 'breed', 'fish', 'cook'];
      if (!valid.includes(m)) return false;
      mode = m;
      civ.addLog(`[${bot.username}] 🌾 Farming mode: ${m}`);
      return true;
    },

    getMode() {
      return mode;
    },

    getStats() {
      return {
        ...stats,
        mode,
        invFood: getInventoryFood(bot),
        invRaw: getInventoryRaw(bot).length,
        foodState: civ.getState().resources.food,
        botHunger: bot.food,
      };
    },

    /** Manual trigger untuk masing-masing aksi */
    async forceHarvest() {
      return (
        crops.findMatureCrop() && (await crops.harvest(...Object.values(crops.findMatureCrop())))
      );
    },
    async forceHunt() {
      return animals.hunt();
    },
    async forceBreed() {
      return animals.breed();
    },
    async forceCook() {
      return kitchen.cook();
    },
    async forceFish() {
      return fishing.fish();
    },

    start() {
      civ.addLog(`[${bot.username}] 🌾 Farming dimulai (mode: ${mode})`);
      interval = setInterval(run, FARMING_CONFIG.TICK_INTERVAL_MS);
    },

    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      civ.addLog(`[${bot.username}] 🛑 Farming dihentikan | Stats: ${JSON.stringify(stats)}`);
    },

    // Expose subsystems untuk penggunaan lanjut
    crops,
    animals,
    kitchen,
    fishing,
    supply,
    FARMING_CONFIG,
  };
};
