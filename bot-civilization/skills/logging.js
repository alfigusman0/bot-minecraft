/**
 * LOGGING SKILL — SiPenebang (Professional Edition)
 *
 * Fitur:
 * - Tebang seluruh pohon sekaligus (tree harvester, bukan hanya 1 log)
 * - Tanam bibit kembali setelah tebang (auto-replant sapling)
 * - Koleksi daun untuk memperoleh bibit alami
 * - Deteksi pohon buatan vs alam (lindungi struktur)
 * - Multi wood type: semua kayu termasuk mangrove, cherry
 * - Strip log untuk menambah kayu per pohon
 * - Sapling cache: simpan bibit, prioritas ganti kayu langka
 * - Pathfinding cerdas + unstuck
 */

'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const { HOME_BASE, WORK_RADIUS } = require('../core/config');

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

const WOOD_MAP = {
  oak_log: { sapling: 'oak_sapling', planks: 'oak_planks', leaves: 'oak_leaves' },
  birch_log: { sapling: 'birch_sapling', planks: 'birch_planks', leaves: 'birch_leaves' },
  spruce_log: { sapling: 'spruce_sapling', planks: 'spruce_planks', leaves: 'spruce_leaves' },
  jungle_log: { sapling: 'jungle_sapling', planks: 'jungle_planks', leaves: 'jungle_leaves' },
  acacia_log: { sapling: 'acacia_sapling', planks: 'acacia_planks', leaves: 'acacia_leaves' },
  dark_oak_log: {
    sapling: 'dark_oak_sapling',
    planks: 'dark_oak_planks',
    leaves: 'dark_oak_leaves',
  },
  mangrove_log: {
    sapling: 'mangrove_propagule',
    planks: 'mangrove_planks',
    leaves: 'mangrove_leaves',
  },
  cherry_log: { sapling: 'cherry_sapling', planks: 'cherry_planks', leaves: 'cherry_leaves' },
};

const WOOD_TYPES = Object.keys(WOOD_MAP);
const SAPLING_TYPES = Object.values(WOOD_MAP).map(w => w.sapling);
const LEAF_TYPES = Object.values(WOOD_MAP).map(w => w.leaves);

const AXES = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe', 'golden_axe'];

// Blok yang menandakan ini pohon buatan / dekat struktur — jangan ditebang
const STRUCTURE_BLOCKS = new Set([
  'oak_door',
  'birch_door',
  'spruce_door',
  'jungle_door',
  'acacia_door',
  'dark_oak_door',
  'iron_door',
  'glass',
  'glass_pane',
  'bookshelf',
  'crafting_table',
  'furnace',
  'smoker',
  'blast_furnace',
  'chest',
  'barrel',
  'torch',
  'wall_torch',
  'lantern',
  'sea_lantern',
  'cobblestone_wall',
  'stone_bricks',
  'mossy_cobblestone',
  'cobblestone',
  'planks',
  'bed',
  'white_bed',
  'orange_bed',
  'magenta_bed',
  'light_blue_bed',
  'yellow_bed',
  'lime_bed',
  'pink_bed',
  'gray_bed',
  'light_gray_bed',
  'cyan_bed',
  'purple_bed',
  'blue_bed',
  'brown_bed',
  'green_bed',
  'red_bed',
  'black_bed',
  'flower_pot',
  'composter',
  'beehive',
  'bee_nest',
]);

const CONFIG = {
  TICK_MS: 3000,
  SCAN_RADIUS: 40,
  MAX_TREE_HEIGHT: 32,
  REPLANT_DELAY: 400,
  MIN_SAPLINGS: 8, // Simpan minimal ini sebelum tanam ulang
  TREE_VEIN_LIMIT: 64, // Max log per pohon untuk mencegah infinite loop
  DEPOSIT_EVERY: 5, // Deposit setiap N pohon ditebang
  LEAVES_BONUS_CHANCE: 0.4, // Peluang pukul daun untuk sapling
};

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function isNearStructure(bot, mcData, pos) {
  // Cek entity villager/trader
  const nearVillager = Object.values(bot.entities).some(e => {
    if (!e?.name) return false;
    return (
      ['villager', 'wandering_trader'].includes(e.name.toLowerCase()) &&
      pos.distanceTo(e.position) < 10
    );
  });
  if (nearVillager) return true;

  // Cek blok struktur dalam radius 4
  const structIds = [...STRUCTURE_BLOCKS].map(b => mcData.blocksByName[b]?.id).filter(Boolean);

  if (!structIds.length) return false;

  return !!bot.findBlock({
    matching: structIds,
    maxDistance: 4,
    useExtraInfo: b => b.position.distanceTo(pos) <= 4,
  });
}

function getWoodInfo(blockName) {
  const base = blockName.replace('_wood', '_log'); // stripped wood → log
  return WOOD_MAP[blockName] || WOOD_MAP[base] || null;
}

// ─────────────────────────────────────────────
//  TREE SCANNER — Flood fill dari satu log
// ─────────────────────────────────────────────

/**
 * Temukan semua log yang terhubung dalam satu pohon (flood fill 3D)
 * @returns {Array<Block>} semua blok log dalam pohon
 */
function scanTree(bot, rootBlock) {
  const rootName = rootBlock.name;
  const visited = new Set();
  const queue = [rootBlock.position.clone()];
  const result = [];

  while (queue.length && result.length < CONFIG.TREE_VEIN_LIMIT) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const block = bot.blockAt(pos);
    if (!block || block.name !== rootName) continue;

    result.push(block);

    // Ekspansi ke 6 tetangga + diagonal atas (untuk pohon akasia yang miring)
    const dirs = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 1, 0),
      new Vec3(0, -1, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(1, 1, 0),
      new Vec3(-1, 1, 0),
      new Vec3(0, 1, 1),
      new Vec3(0, 1, -1),
    ];
    for (const d of dirs) {
      const next = pos.plus(d);
      const nKey = `${next.x},${next.y},${next.z}`;
      if (!visited.has(nKey) && Math.abs(next.y - rootBlock.position.y) <= CONFIG.MAX_TREE_HEIGHT) {
        queue.push(next);
      }
    }
  }

  // Urutkan dari atas ke bawah (tebang atas dulu agar tidak keburu daun)
  return result.sort((a, b) => b.position.y - a.position.y);
}

/**
 * Temukan semua daun terhubung untuk memperoleh sapling
 */
function scanLeaves(bot, rootPos, leafType) {
  const visited = new Set();
  const queue = [rootPos.clone()];
  const result = [];
  const limit = 48;

  while (queue.length && result.length < limit) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const block = bot.blockAt(pos);
    if (!block || block.name !== leafType) continue;

    result.push(block);

    for (const d of [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 1, 0),
      new Vec3(0, -1, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
    ]) {
      const next = pos.plus(d);
      if (!visited.has(`${next.x},${next.y},${next.z}`)) queue.push(next);
    }
  }

  return result;
}

// ─────────────────────────────────────────────
//  MAIN SKILL
// ─────────────────────────────────────────────

module.exports = function loggingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;
  let treesChopped = 0;

  // Track posisi bonggol pohon untuk replant
  const replantQueue = []; // [{pos, sapling}]

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  // ── isViable ─────────────────────────────────────────────────
  function isViable() {
    const ids = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    return !!bot.findBlock({
      matching: ids,
      maxDistance: CONFIG.SCAN_RADIUS,
      useExtraInfo: b => !isNearStructure(bot, mcData, b.position),
    });
  }

  // ── Cari pohon terdekat ──────────────────────────────────────
  function findTree() {
    const ids = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    if (!ids.length) return null;

    // Cari log paling bawah (akar pohon) agar flood fill optimal
    const candidates = [];
    const seen = new Set();

    for (let i = 0; i < 20; i++) {
      const block = bot.findBlock({
        matching: ids,
        maxDistance: CONFIG.SCAN_RADIUS,
        useExtraInfo: b => {
          const key = `${b.position.x},${b.position.y},${b.position.z}`;
          if (seen.has(key)) return false;
          if (isNearStructure(bot, mcData, b.position)) return false;
          return true;
        },
      });
      if (!block) break;
      seen.add(`${block.position.x},${block.position.y},${block.position.z}`);
      candidates.push(block);
    }

    if (!candidates.length) return null;

    // Pilih yang paling dekat dan paling bawah (akar)
    return candidates.sort((a, b) => {
      const distA = bot.entity.position.distanceTo(a.position);
      const distB = bot.entity.position.distanceTo(b.position);
      if (Math.abs(distA - distB) > 8) return distA - distB;
      return a.position.y - b.position.y; // lebih rendah = lebih baik (akar)
    })[0];
  }

  // ── Tebang seluruh pohon ─────────────────────────────────────
  async function chopTree(rootBlock) {
    const woodInfo = getWoodInfo(rootBlock.name);
    const logBlocks = scanTree(bot, rootBlock);

    if (!logBlocks.length) return 0;

    console.log(
      `[${bot.username}] 🌳 Pohon ditemukan: ${logBlocks.length} log (${rootBlock.name})`
    );
    civ.addLog(`[${bot.username}] 🌳 Mulai tebang ${rootBlock.name} (${logBlocks.length} log)`);

    // Simpan posisi akar untuk replant
    const rootPos = logBlocks[logBlocks.length - 1].position.clone(); // log terbawah

    await equipBest(bot, AXES, 'hand');
    let chopped = 0;

    for (const logBlock of logBlocks) {
      // Verifikasi masih ada
      const fresh = bot.blockAt(logBlock.position);
      if (!fresh || !WOOD_TYPES.includes(fresh.name)) continue;

      // Cek struktur di dekat log ini
      if (isNearStructure(bot, mcData, logBlock.position)) {
        console.log(`[${bot.username}] ⚠️ Skip log dekat struktur`);
        continue;
      }

      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(logBlock.position.x, logBlock.position.y, logBlock.position.z, 3)
            ),
          10000
        );
        await bot.dig(fresh);
        await waitMs(180);
        chopped++;
      } catch (err) {
        console.log(`[${bot.username}] Skip log: ${err.message}`);
      }
    }

    // Pecah beberapa daun untuk mendapat sapling (probabilistik)
    if (woodInfo && Math.random() < CONFIG.LEAVES_BONUS_CHANCE) {
      await collectSaplingsFromLeaves(rootPos, woodInfo);
    }

    // Antri replant
    if (woodInfo && chopped > 0) {
      replantQueue.push({ pos: rootPos, sapling: woodInfo.sapling });
    }

    civ.addResources({ wood: chopped });
    civ.addLog(`[${bot.username}] 🪓 Tebang ${chopped} log`);
    return chopped;
  }

  // ── Kumpulkan sapling dari daun ──────────────────────────────
  async function collectSaplingsFromLeaves(nearPos, woodInfo) {
    if (!woodInfo?.leaves) return;
    const leafId = mcData.blocksByName[woodInfo.leaves]?.id;
    if (!leafId) return;

    const leafBlock = bot.findBlock({ matching: leafId, maxDistance: 12 });
    if (!leafBlock) return;

    const leaves = scanLeaves(bot, leafBlock.position, woodInfo.leaves);
    const toBreak = leaves.slice(0, 6); // Pecah maksimal 6 daun

    for (const leaf of toBreak) {
      const fresh = bot.blockAt(leaf.position);
      if (!fresh || fresh.name !== woodInfo.leaves) continue;
      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(leaf.position.x, leaf.position.y, leaf.position.z, 3)
            ),
          5000
        );
        await bot.dig(fresh);
        await waitMs(120);
      } catch (_) {}
    }
  }

  // ── Replant sapling ──────────────────────────────────────────
  async function processReplantQueue() {
    while (replantQueue.length > 0) {
      const { pos, sapling } = replantQueue.shift();
      await replantTree(pos, sapling);
      await waitMs(CONFIG.REPLANT_DELAY);
    }
  }

  async function replantTree(pos, saplingName) {
    // Cek apakah sudah ada sesuatu di posisi itu
    const atPos = bot.blockAt(pos);
    if (atPos && atPos.name !== 'air' && !SAPLING_TYPES.includes(atPos.name)) {
      // Mungkin sudah ada blok, cari posisi kosong di dekat
      return await replantNearby(pos, saplingName);
    }

    // Pastikan punya bibit
    let saplingItem = bot.inventory.items().find(i => i.name === saplingName);
    if (!saplingItem) {
      // Coba fetch dari storage
      await getStorage()
        .fetchFromStorage(saplingName, 4)
        .catch(() => {});
      saplingItem = bot.inventory.items().find(i => i.name === saplingName);
    }
    if (!saplingItem) {
      // Coba gunakan bibit lain jika tidak ada
      saplingItem = bot.inventory.items().find(i => SAPLING_TYPES.includes(i.name));
    }
    if (!saplingItem) {
      console.log(`[${bot.username}] ⚠️ Tidak ada bibit ${saplingName} untuk replant`);
      return false;
    }

    // Ground check
    const ground = bot.blockAt(pos.offset(0, -1, 0));
    if (!ground || ['air', 'water', 'lava'].includes(ground.name)) {
      return await replantNearby(pos, saplingName);
    }

    try {
      await withUnstuck(
        bot,
        () => bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)),
        8000
      );
      await bot.equip(saplingItem, 'hand');
      const freshGround = bot.blockAt(pos.offset(0, -1, 0));
      if (!freshGround || freshGround.name === 'air') return false;
      await bot.placeBlock(freshGround, new Vec3(0, 1, 0));
      await waitMs(300);
      console.log(`[${bot.username}] 🌱 Tanam ${saplingName} di (${pos.x},${pos.y},${pos.z})`);
      civ.addLog(`[${bot.username}] 🌱 Replant ${saplingName}`);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] Gagal replant: ${err.message}`);
      return false;
    }
  }

  /**
   * Cari spot kosong di dekat pos untuk menanam
   */
  async function replantNearby(centerPos, saplingName) {
    const saplingItem =
      bot.inventory.items().find(i => i.name === saplingName) ||
      bot.inventory.items().find(i => SAPLING_TYPES.includes(i.name));
    if (!saplingItem) return false;

    const offsets = [];
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        offsets.push(new Vec3(x, 0, z));
      }
    }
    offsets.sort((a, b) => a.length() - b.length());

    for (const off of offsets) {
      const target = centerPos.plus(off);
      const atTarget = bot.blockAt(target);
      const ground = bot.blockAt(target.offset(0, -1, 0));

      if (
        atTarget?.name === 'air' &&
        ground &&
        !['air', 'water', 'lava'].includes(ground.name) &&
        ['dirt', 'grass_block', 'farmland', 'podzol', 'rooted_dirt', 'mud'].includes(ground.name)
      ) {
        try {
          await withUnstuck(
            bot,
            () => bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2)),
            6000
          );
          await bot.equip(saplingItem, 'hand');
          const freshGround = bot.blockAt(target.offset(0, -1, 0));
          if (!freshGround) continue;
          await bot.placeBlock(freshGround, new Vec3(0, 1, 0));
          await waitMs(250);
          civ.addLog(`[${bot.username}] 🌱 Replant ${saplingName} (nearby)`);
          return true;
        } catch (_) {
          continue;
        }
      }
    }
    return false;
  }

  // ── Bone meal bibit yang sudah ditanam ───────────────────────
  async function boneMealSaplings() {
    if (!hasItem(bot, 'bone_meal', 1)) return;

    const saplingIds = SAPLING_TYPES.map(s => mcData.blocksByName[s]?.id).filter(Boolean);

    if (!saplingIds.length) return;

    const sapling = bot.findBlock({ matching: saplingIds, maxDistance: 16 });
    if (!sapling) return;

    const bm = bot.inventory.items().find(i => i.name === 'bone_meal');
    if (!bm) return;

    try {
      await bot.equip(bm, 'hand');
      await withUnstuck(
        bot,
        () =>
          bot.pathfinder.goto(
            new goals.GoalNear(sapling.position.x, sapling.position.y, sapling.position.z, 2)
          ),
        5000
      );
      await bot.activateBlock(sapling);
      console.log(`[${bot.username}] 🦴 Bone meal → ${sapling.name}`);
    } catch (_) {}
  }

  // ── Collect drops ────────────────────────────────────────────
  async function collectDrops() {
    const drops = Object.values(bot.entities).filter(
      e =>
        e.type === 'object' &&
        e.objectType === 'Item' &&
        bot.entity.position.distanceTo(e.position) < 10
    );
    for (const drop of drops.slice(0, 5)) {
      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)
            ),
          3000
        );
        await waitMs(150);
      } catch (_) {}
    }
  }

  // ── Craft planks / sticks jika ada log ───────────────────────
  async function craftBasics() {
    for (const [logType, info] of Object.entries(WOOD_MAP)) {
      const logItem = bot.inventory.items().find(i => i.name === logType && i.count >= 1);
      if (!logItem) continue;

      const plankId = mcData.itemsByName[info.planks]?.id;
      if (!plankId) continue;

      const existing = bot.inventory.items().find(i => i.name === info.planks);
      if (existing && existing.count >= 32) continue;

      try {
        const recipes = await bot.recipesFor(plankId, null, 1, null);
        if (recipes?.length) {
          await bot.craft(recipes[0], Math.min(logItem.count, 4), null);
          await waitMs(300);
        }
      } catch (_) {}
      break;
    }
  }

  // ── MAIN RUN ─────────────────────────────────────────────────
  async function run() {
    if (active) return;
    active = true;

    try {
      // Deposit jika penuh
      if (getStorage().isInventoryFull?.()) {
        await getStorage().checkAndDeposit();
      }

      // Proses antrian replant
      if (replantQueue.length > 0) {
        await processReplantQueue();
        active = false;
        return;
      }

      // Bone meal bibit
      if (Math.random() < 0.3) await boneMealSaplings();

      // Cari pohon
      const treeBlock = findTree();
      if (!treeBlock) {
        console.log(`[${bot.username}] Tidak ada pohon dalam radius`);
        active = false;
        return;
      }

      // Tebang pohon
      const chopped = await chopTree(treeBlock);

      if (chopped > 0) {
        treesChopped++;
        await collectDrops();
        await waitMs(500);

        // Proses replant langsung setelah tebang
        await processReplantQueue();

        // Craft planks dari log yang baru didapat
        await craftBasics();

        // Deposit berkala
        if (treesChopped % CONFIG.DEPOSIT_EVERY === 0) {
          await getStorage().checkAndDeposit();
        }
      }
    } catch (err) {
      console.error(`[${bot.username}] [logging ERROR] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'logging',
    label: '🪓 Logging',
    isViable,

    getStats() {
      return {
        treesChopped,
        replantPending: replantQueue.length,
      };
    },

    start() {
      civ.addLog(`[${bot.username}] 🪓 Logging dimulai (full-tree + replant)`);
      interval = setInterval(run, CONFIG.TICK_MS);
    },

    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      civ.addLog(`[${bot.username}] 🛑 Logging dihentikan | Pohon: ${treesChopped}`);
    },
  };
};
