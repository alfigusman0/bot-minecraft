/**
 * BUILDING SKILL — SiBuilder (Professional Edition)
 *
 * Fitur Utama:
 * - Multi-phase building dengan blueprint dinamis
 * - Pathfinding cerdas dengan unstuck & retry logic
 * - Material management otomatis (inventory + storage)
 * - Block validation & integrity checking
 * - Build queue priority system
 * - Scaffolding otomatis untuk blok tinggi
 * - Error recovery & rollback support
 * - Progress tracking terperinci
 * - Support custom blueprint (bisa bangun APA SAJA)
 */

'use strict';

const { goals, Movements } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const {
  HOME_BASE,
  LAYOUT,
  blueprintMainHouse,
  blueprintPerimeterWall,
  blueprintFarm,
} = require('../core/config');

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

const MATERIALS_PRIORITY = [
  'cobblestone',
  'stone',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'smooth_stone',
  'stone_bricks',
  'mossy_stone_bricks',
  'cracked_stone_bricks',
  'bricks',
  'mud_bricks',
  'sandstone',
  'red_sandstone',
  'nether_bricks',
  'quartz_block',
  'purpur_block',
  'end_stone_bricks',
  'granite',
  'diorite',
  'andesite',
  'deepslate',
  'deepslate_bricks',
  'blackstone',
  'basalt',
  'dirt',
];

const NON_SOLID_BLOCKS = new Set([
  'air',
  'water',
  'lava',
  'cave_air',
  'void_air',
  'short_grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dead_bush',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
  'snow',
  'vine',
  'kelp',
  'seagrass',
  'bubble_column',
]);

const BED_NAMES = new Set([
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
]);

const DOOR_NAMES = new Set([
  'oak_door',
  'spruce_door',
  'birch_door',
  'jungle_door',
  'acacia_door',
  'dark_oak_door',
  'iron_door',
]);

const SPECIAL_BLOCKS = new Set([
  'crafting_table',
  'furnace',
  'chest',
  'barrel',
  'hopper',
  'dispenser',
  'dropper',
  'observer',
  'piston',
  'sticky_piston',
  'torch',
  'wall_torch',
  'lantern',
  'sea_lantern',
  'glowstone',
  'redstone_lamp',
  'jack_o_lantern',
  'end_rod',
  'ladder',
  'vine',
  'scaffolding',
  'glass',
  'glass_pane',
  'stained_glass',
  'stained_glass_pane',
  'iron_bars',
  ...DOOR_NAMES,
]);

const FACE_DIRS = [
  new Vec3(0, -1, 0),
  new Vec3(0, 1, 0),
  new Vec3(-1, 0, 0),
  new Vec3(1, 0, 0),
  new Vec3(0, 0, -1),
  new Vec3(0, 0, 1),
];

const BUILD_CONFIG = {
  BLOCKS_PER_TICK: 12, // Blok yang dipasang per interval
  TICK_INTERVAL_MS: 2500, // Interval antar tick (ms)
  PLACE_DELAY_MS: 120, // Delay antar penempatan blok
  GOTO_TIMEOUT_MS: 15000, // Timeout navigasi
  BASE_PROXIMITY: 30, // Jarak sebelum kembali ke base
  SCAFFOLD_HEIGHT_THRESHOLD: 3, // Tinggi min untuk scaffolding
  MAX_RETRIES: 3, // Retry per blok
  FETCH_BATCH: 64, // Jumlah material per fetch
  DEPOSIT_EVERY_N: 80, // Deposit inventory setiap N blok
};

// ─────────────────────────────────────────────
//  UTILITY HELPERS
// ─────────────────────────────────────────────

/**
 * Cek apakah posisi sudah terisi blok valid (bukan air/cairan)
 */
function isBlockPlaced(bot, pos) {
  const block = bot.blockAt(pos);
  return block && !NON_SOLID_BLOCKS.has(block.name) && !BED_NAMES.has(block.name);
}

/**
 * Hitung Manhattan distance antar dua Vec3
 */
function manhattanDist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

/**
 * Sort blueprint blocks: bawah ke atas, luar ke dalam (build order optimal)
 */
function sortBlueprintBlocks(blocks) {
  return [...blocks].sort((a, b) => {
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    return manhattanDist(a.pos, HOME_BASE) - manhattanDist(b.pos, HOME_BASE);
  });
}

/**
 * Kelompokkan blok blueprint berdasarkan layer Y untuk build bottom-up
 */
function groupByLayer(blocks) {
  const layers = new Map();
  for (const block of blocks) {
    const y = block.pos.y;
    if (!layers.has(y)) layers.set(y, []);
    layers.get(y).push(block);
  }
  return new Map([...layers.entries()].sort((a, b) => a[0] - b[0]));
}

// ─────────────────────────────────────────────
//  SCAFFOLD SYSTEM
// ─────────────────────────────────────────────

/**
 * Buat scaffolding sementara untuk mencapai blok di ketinggian
 */
async function buildScaffold(bot, targetPos, materialItem) {
  const scaffoldPos = new Vec3(targetPos.x, bot.entity.position.y, targetPos.z);
  const heightDiff = targetPos.y - Math.floor(bot.entity.position.y);
  if (heightDiff <= BUILD_CONFIG.SCAFFOLD_HEIGHT_THRESHOLD) return;

  const scaffoldItems = bot.inventory
    .items()
    .filter(i => i.name === 'scaffolding' || i.name === 'dirt' || i.name === materialItem?.name);
  if (!scaffoldItems.length) return;

  await bot.equip(scaffoldItems[0], 'hand');
  for (let y = 0; y < heightDiff; y++) {
    const sp = scaffoldPos.offset(0, y, 0);
    if (!isBlockPlaced(bot, sp)) {
      try {
        const below = bot.blockAt(sp.offset(0, -1, 0));
        if (below && !NON_SOLID_BLOCKS.has(below.name)) {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(100);
        }
      } catch (_) {}
    }
  }
}

/**
 * Hapus scaffolding setelah selesai
 */
async function removeScaffold(bot, targetPos) {
  const scaffoldPos = new Vec3(targetPos.x, bot.entity.position.y, targetPos.z);
  const heightDiff = targetPos.y - Math.floor(bot.entity.position.y);
  for (let y = heightDiff; y >= 0; y--) {
    const sp = scaffoldPos.offset(0, y, 0);
    const block = bot.blockAt(sp);
    if (block && (block.name === 'scaffolding' || block.name === 'dirt')) {
      try {
        await bot.dig(block);
        await waitMs(80);
      } catch (_) {}
    }
  }
}

// ─────────────────────────────────────────────
//  BLUEPRINT ENGINE
// ─────────────────────────────────────────────

/**
 * Blueprint generator generik — bisa membuat STRUKTUR APA SAJA
 * @param {Object} spec - Spesifikasi bangunan
 * @param {string} spec.type - 'box', 'wall', 'floor', 'dome', 'pyramid', 'cylinder', 'custom'
 * @param {Vec3} spec.origin - Posisi awal
 * @param {Object} spec.dimensions - { w, h, d } atau { radius, height }
 * @param {string} spec.material - Material utama
 * @param {string} [spec.fillMaterial] - Material isi (jika hollow=false)
 * @param {boolean} [spec.hollow] - Hanya dinding luar
 * @param {boolean} [spec.withRoof] - Tambah atap
 * @param {boolean} [spec.withFloor] - Tambah lantai
 * @param {boolean} [spec.withDoor] - Tambah pintu
 * @param {Array}  [spec.windows] - [{x,y,z}] posisi jendela relatif
 * @param {Array}  [spec.blocks] - [{pos,material}] untuk type='custom'
 */
function generateBlueprint(spec) {
  const blocks = [];
  const { type, origin, dimensions, material, fillMaterial, hollow = true } = spec;

  const add = (x, y, z, mat) =>
    blocks.push({
      pos: new Vec3(origin.x + x, origin.y + y, origin.z + z),
      material: mat || material,
    });

  switch (type) {
    case 'box':
    case 'house': {
      const { w = 7, h = 4, d = 7 } = dimensions;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          for (let z = 0; z < d; z++) {
            const isWall = x === 0 || x === w - 1 || z === 0 || z === d - 1;
            const isFloor = y === 0 && spec.withFloor !== false;
            const isRoof = y === h - 1 && spec.withRoof !== false;
            if (isWall || isFloor || isRoof) {
              add(x, y, z);
            } else if (!hollow && fillMaterial) {
              add(x, y, z, fillMaterial);
            }
          }
        }
      }
      // Pintu di tengah sisi depan
      if (spec.withDoor !== false) {
        const doorX = Math.floor(w / 2);
        blocks.push({
          pos: new Vec3(origin.x + doorX, origin.y + 1, origin.z),
          material: 'air',
          isDoor: true,
        });
        blocks.push({
          pos: new Vec3(origin.x + doorX, origin.y + 2, origin.z),
          material: 'air',
          isDoor: true,
        });
      }
      break;
    }

    case 'wall': {
      const { w = 15, h = 3, d = 15 } = dimensions;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          add(x, y, 0);
          add(x, y, d - 1);
        }
        for (let z = 1; z < d - 1; z++) {
          add(0, y, z);
          add(w - 1, y, z);
        }
      }
      break;
    }

    case 'floor':
    case 'platform': {
      const { w = 10, d = 10 } = dimensions;
      for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
          add(x, 0, z);
        }
      }
      break;
    }

    case 'cylinder': {
      const { radius = 5, height = 4 } = dimensions;
      for (let y = 0; y < height; y++) {
        for (let x = -radius; x <= radius; x++) {
          for (let z = -radius; z <= radius; z++) {
            const dist = Math.sqrt(x * x + z * z);
            const isShell = dist >= radius - 1 && dist <= radius;
            if (isShell || (!hollow && dist <= radius)) {
              add(x, y, z);
            }
          }
        }
      }
      break;
    }

    case 'dome': {
      const { radius = 6 } = dimensions;
      for (let y = 0; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
          for (let z = -radius; z <= radius; z++) {
            const dist = Math.sqrt(x * x + y * y + z * z);
            if (dist >= radius - 0.5 && dist <= radius + 0.5) {
              add(x, y, z);
            }
          }
        }
      }
      break;
    }

    case 'pyramid': {
      const { base = 11 } = dimensions;
      for (let y = 0; y < Math.ceil(base / 2); y++) {
        const halfSize = Math.floor((base - 1) / 2) - y;
        for (let x = -halfSize; x <= halfSize; x++) {
          for (let z = -halfSize; z <= halfSize; z++) {
            const isEdge =
              Math.abs(x) === halfSize || Math.abs(z) === halfSize || y === Math.ceil(base / 2) - 1;
            if (isEdge || !hollow) add(x, y, z);
          }
        }
      }
      break;
    }

    case 'tower': {
      const { radius = 3, height = 12 } = dimensions;
      // Cylinder + battlements
      for (let y = 0; y < height; y++) {
        for (let x = -radius; x <= radius; x++) {
          for (let z = -radius; z <= radius; z++) {
            const dist = Math.sqrt(x * x + z * z);
            if (dist >= radius - 1 && dist <= radius) add(x, y, z);
          }
        }
      }
      // Merlons (battlements) di atas
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          const dist = Math.sqrt(x * x + z * z);
          if (dist >= radius - 1 && dist <= radius) {
            if ((x + z) % 2 === 0) add(x, height, z);
          }
        }
      }
      break;
    }

    case 'bridge': {
      const { length = 20, width = 3 } = dimensions;
      for (let x = 0; x < length; x++) {
        for (let z = 0; z < width; z++) {
          add(x, 0, z); // lantai
        }
        // Railing kiri kanan
        add(x, 1, 0);
        add(x, 1, width - 1);
      }
      break;
    }

    case 'farm': {
      const { w = 9, d = 9 } = dimensions;
      for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
          // Saluran air tiap 4 blok
          if (x % 4 === 0 || z % 4 === 0) {
            add(x, 0, z, 'water');
          } else {
            add(x, 0, z, 'farmland');
          }
        }
      }
      break;
    }

    case 'staircase': {
      const { length = 10, direction = 'x' } = dimensions;
      for (let i = 0; i < length; i++) {
        if (direction === 'x') add(i, i, 0);
        else add(0, i, i);
      }
      break;
    }

    case 'custom': {
      if (spec.blocks && Array.isArray(spec.blocks)) {
        return spec.blocks.map(b => ({
          pos: b.pos instanceof Vec3 ? b.pos : new Vec3(b.pos.x, b.pos.y, b.pos.z),
          material: b.material || material,
        }));
      }
      break;
    }

    default:
      console.warn(`[Blueprint] Unknown type: ${type}`);
  }

  // Hapus duplikat
  const seen = new Set();
  return blocks.filter(b => {
    const key = `${b.pos.x},${b.pos.y},${b.pos.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────
//  BUILD QUEUE MANAGER
// ─────────────────────────────────────────────

class BuildQueue {
  constructor() {
    this.queue = []; // [{name, blocks, priority}]
    this.current = null;
    this.blockIndex = 0;
    this.failed = []; // Blok yang gagal dipasang
  }

  enqueue(name, blocks, priority = 0) {
    const sorted = sortBlueprintBlocks(blocks);
    this.queue.push({ name, blocks: sorted, priority });
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  get currentBlocks() {
    return this.current?.blocks ?? [];
  }

  get currentName() {
    return this.current?.name ?? null;
  }

  get isDone() {
    return !this.current && this.queue.length === 0;
  }

  get progress() {
    if (!this.current) return 0;
    return Math.round((this.blockIndex / this.current.blocks.length) * 100);
  }

  get remaining() {
    return this.current ? this.current.blocks.length - this.blockIndex : 0;
  }

  advance() {
    if (!this.current) {
      if (this.queue.length === 0) return false;
      this.current = this.queue.shift();
      this.blockIndex = 0;
    }
    return true;
  }

  nextBlock() {
    if (!this.current) return null;
    if (this.blockIndex >= this.current.blocks.length) {
      this.current = null;
      this.blockIndex = 0;
      return null;
    }
    return this.current.blocks[this.blockIndex++];
  }

  peek(n = 8) {
    if (!this.current) return [];
    return this.current.blocks.slice(this.blockIndex, this.blockIndex + n);
  }

  reset() {
    this.current = null;
    this.blockIndex = 0;
    this.failed = [];
    this.queue = [];
  }

  retryFailed() {
    if (this.failed.length === 0) return;
    console.log(`[BuildQueue] Retry ${this.failed.length} blok gagal`);
    this.enqueue('retry_failed', this.failed, 10);
    this.failed = [];
  }
}

// ─────────────────────────────────────────────
//  MATERIAL MANAGER
// ─────────────────────────────────────────────

class MaterialManager {
  constructor(bot, mcData, storageFactory) {
    this.bot = bot;
    this.mcData = mcData;
    this._storage = null;
    this._storageFactory = storageFactory;
    this.fetchCache = new Map(); // name -> last fetch time
  }

  get storage() {
    if (!this._storage) this._storage = this._storageFactory(this.bot, this.mcData);
    return this._storage;
  }

  /** Cek jumlah item di inventory */
  countItem(name) {
    return this.bot.inventory
      .items()
      .filter(i => i.name === name)
      .reduce((sum, i) => sum + i.count, 0);
  }

  /** Ambil item terbaik dari inventory sesuai prioritas */
  getBestMaterial(preferredName) {
    const inv = this.bot.inventory.items();
    const preferred = inv.find(i => i.name === preferredName);
    if (preferred && preferred.count > 0) return preferred;
    return inv.find(i => MATERIALS_PRIORITY.includes(i.name)) ?? null;
  }

  /** Pastikan material tersedia, fetch dari storage jika perlu */
  async ensureMaterial(name, amount = 16) {
    if (this.countItem(name) >= amount) return true;

    // Rate limit fetch agar tidak spam storage
    const lastFetch = this.fetchCache.get(name) ?? 0;
    if (Date.now() - lastFetch < 5000) return this.countItem(name) > 0;

    this.fetchCache.set(name, Date.now());
    try {
      return await this.storage.fetchFromStorage(name, BUILD_CONFIG.FETCH_BATCH);
    } catch (_) {
      return this.countItem(name) > 0;
    }
  }

  /** Pastikan ADA material apapun */
  async ensureAnyMaterial() {
    const has = this.bot.inventory.items().some(i => MATERIALS_PRIORITY.includes(i.name));
    if (has) return true;

    for (const mat of MATERIALS_PRIORITY) {
      try {
        if (await this.storage.fetchFromStorage(mat, BUILD_CONFIG.FETCH_BATCH)) return true;
      } catch (_) {}
    }
    return false;
  }

  /** Ringkasan material di inventory */
  inventorySummary() {
    return (
      this.bot.inventory
        .items()
        .filter(i => MATERIALS_PRIORITY.includes(i.name))
        .map(i => `${i.name}×${i.count}`)
        .join(', ') || '(kosong)'
    );
  }
}

// ─────────────────────────────────────────────
//  BLOCK PLACER
// ─────────────────────────────────────────────

class BlockPlacer {
  constructor(bot, mcData) {
    this.bot = bot;
    this.mcData = mcData;
  }

  /**
   * Coba pasang satu blok di pos dengan material tertentu.
   * Otomatis cari reference block terbaik dari 6 arah.
   * Retry hingga MAX_RETRIES kali.
   */
  async place(pos, materialItem, retries = BUILD_CONFIG.MAX_RETRIES) {
    if (!pos || !materialItem) return false;

    // Sudah ada blok disana?
    if (isBlockPlaced(this.bot, pos)) return true;

    await this.bot.equip(materialItem, 'hand');

    for (let attempt = 0; attempt < retries; attempt++) {
      // Navigasi ke dekat blok
      try {
        await withUnstuck(
          this.bot,
          () => this.bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)),
          BUILD_CONFIG.GOTO_TIMEOUT_MS
        );
      } catch (_) {
        // Coba GoalBlock sebagai fallback
        try {
          await this.bot.pathfinder.goto(new goals.GoalBlock(pos.x, pos.y, pos.z));
        } catch (_2) {}
      }

      // Coba dari setiap arah
      for (const dir of FACE_DIRS) {
        const refPos = pos.plus(dir);
        const refBlock = this.bot.blockAt(refPos);
        if (!refBlock || NON_SOLID_BLOCKS.has(refBlock.name) || BED_NAMES.has(refBlock.name))
          continue;

        try {
          const faceDir = dir.scaled(-1);
          await this.bot.placeBlock(refBlock, faceDir);
          await waitMs(BUILD_CONFIG.PLACE_DELAY_MS);
          if (isBlockPlaced(this.bot, pos)) return true;
        } catch (_) {
          continue;
        }
      }

      if (attempt < retries - 1) await waitMs(300 * (attempt + 1));
    }
    return false;
  }

  /**
   * Hapus blok di pos (misalnya untuk pintu/jendela)
   */
  async remove(pos) {
    const block = this.bot.blockAt(pos);
    if (!block || NON_SOLID_BLOCKS.has(block.name)) return true;
    try {
      await this.bot.dig(block);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Validasi seberapa banyak blok blueprint sudah terpasang
   */
  validateBlueprint(blocks) {
    let placed = 0;
    for (const { pos } of blocks) {
      if (isBlockPlaced(this.bot, pos)) placed++;
    }
    return { placed, total: blocks.length, percent: Math.round((placed / blocks.length) * 100) };
  }
}

// ─────────────────────────────────────────────
//  MAIN BUILDING SKILL
// ─────────────────────────────────────────────

module.exports = function buildingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let depositCounter = 0;

  const queue = new BuildQueue();
  const materials = new MaterialManager(bot, mcData, createStorage);
  const placer = new BlockPlacer(bot, mcData);

  // Statistik
  const stats = {
    totalPlaced: 0,
    totalFailed: 0,
    startTime: null,
  };

  // ─── Phase Detection ─────────────────────────

  function detectCurrentPhase() {
    const state = civ.getState();
    if (!state.structures.house) return 'house';
    if (!state.structures.wall) return 'wall';
    if (!state.structures.farm) return 'farm';
    return 'done';
  }

  function markPhaseComplete(phase) {
    const updates = { house: 'house', wall: 'wall', farm: 'farm' };
    if (updates[phase]) {
      civ.updateState(s => {
        s.structures[updates[phase]] = true;
      });
    }
    console.log(`[${bot.username}] ✅ Fase '${phase}' selesai!`);
    civ.addLog(`[${bot.username}] ✅ ${phase} selesai!`);
  }

  // ─── Blueprint Loader ─────────────────────────

  function loadDefaultBlueprints() {
    const phase = detectCurrentPhase();
    if (phase === 'done') return false;

    let blocks;
    let name;

    if (phase === 'house') {
      blocks = blueprintMainHouse(LAYOUT.mainHouse);
      name = 'house';
    } else if (phase === 'wall') {
      blocks = blueprintPerimeterWall(HOME_BASE);
      name = 'wall';
    } else if (phase === 'farm') {
      blocks = blueprintFarm(LAYOUT.farmZone);
      name = 'farm';
    }

    queue.enqueue(name, blocks, 5);
    console.log(`[${bot.username}] 📐 Blueprint '${name}' dimuat: ${blocks.length} blok`);
    civ.addLog(`[${bot.username}] 📐 Mulai bangun ${name}`);
    return true;
  }

  /**
   * PUBLIC API: Antrekan blueprint kustom (bangun APA SAJA)
   * @param {string} name - Nama struktur
   * @param {Object} spec - Spesifikasi blueprint (lihat generateBlueprint)
   * @param {number} priority - Prioritas (lebih tinggi = lebih dulu)
   */
  function enqueueBuild(name, spec, priority = 0) {
    const blocks = generateBlueprint(spec);
    if (!blocks.length) {
      console.warn(`[${bot.username}] Blueprint '${name}' kosong!`);
      return 0;
    }
    queue.enqueue(name, blocks, priority);
    console.log(
      `[${bot.username}] 📋 Antri build '${name}': ${blocks.length} blok (priority=${priority})`
    );
    civ.addLog(`[${bot.username}] 📋 Antri: ${name} (${blocks.length} blok)`);
    return blocks.length;
  }

  // ─── Viability ───────────────────────────────

  function isViable() {
    if (detectCurrentPhase() === 'done' && queue.isDone) return false;
    return bot.inventory.items().some(i => MATERIALS_PRIORITY.includes(i.name));
  }

  // ─── Core Run Loop ───────────────────────────

  async function run() {
    if (active) return;
    active = true;

    try {
      // Deposit secara berkala
      depositCounter++;
      if (
        depositCounter % Math.ceil(BUILD_CONFIG.DEPOSIT_EVERY_N / BUILD_CONFIG.BLOCKS_PER_TICK) ===
        0
      ) {
        await materials.storage.checkAndDeposit().catch(() => {});
      }

      // Isi queue jika kosong
      if (queue.isDone) {
        const loaded = loadDefaultBlueprints();
        if (!loaded) {
          civ.addLog(`[${bot.username}] 🏛️ Semua bangunan selesai!`);
          active = false;
          return;
        }
      }

      // Pastikan ada material
      if (!(await materials.ensureAnyMaterial())) {
        console.log(`[${bot.username}] ⚠️ Tidak ada material. Menunggu...`);
        active = false;
        return;
      }

      // Advance queue
      queue.advance();

      // Kembali ke base jika terlalu jauh
      const distToBase = bot.entity.position.distanceTo(HOME_BASE);
      if (distToBase > BUILD_CONFIG.BASE_PROXIMITY) {
        try {
          await withUnstuck(
            bot,
            () => bot.pathfinder.goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 5)),
            BUILD_CONFIG.GOTO_TIMEOUT_MS
          );
        } catch (_) {}
      }

      // Pasang blok satu-satu
      const batch = queue.peek(BUILD_CONFIG.BLOCKS_PER_TICK);
      let batchPlaced = 0;
      let batchFailed = 0;

      for (let i = 0; i < batch.length; i++) {
        const entry = queue.nextBlock();
        if (!entry) break;

        const { pos, material, isDoor } = entry;

        // Blok tanda pintu/jendela: skip atau hapus
        if (isDoor) {
          await placer.remove(pos).catch(() => {});
          continue;
        }

        // Sudah terpasang?
        if (isBlockPlaced(bot, pos)) {
          batchPlaced++;
          continue;
        }

        // Ambil material
        let item = materials.getBestMaterial(material);
        if (!item) {
          await materials.ensureMaterial(material, 16);
          item = materials.getBestMaterial(material);
        }
        if (!item) {
          queue.failed.push(entry);
          batchFailed++;
          continue;
        }

        // Scaffolding jika perlu
        const heightAboveBot = pos.y - Math.floor(bot.entity.position.y);
        if (heightAboveBot > BUILD_CONFIG.SCAFFOLD_HEIGHT_THRESHOLD) {
          await buildScaffold(bot, pos, item).catch(() => {});
        }

        const ok = await placer.place(pos, item);
        if (ok) {
          batchPlaced++;
          stats.totalPlaced++;
        } else {
          queue.failed.push(entry);
          batchFailed++;
          stats.totalFailed++;
        }

        await waitMs(BUILD_CONFIG.PLACE_DELAY_MS);
      }

      // Log progres
      if (queue.current && queue.blockIndex % 20 === 0) {
        const pct = queue.progress;
        civ.addLog(
          `[${bot.username}] 🏗️ ${queue.currentName} ${pct}% | ✅${batchPlaced} ❌${batchFailed}`
        );
      }

      // Fase selesai?
      if (queue.current && queue.blockIndex >= queue.currentBlocks.length) {
        const finishedName = queue.currentName;
        // Retry blok gagal sekali
        if (queue.failed.length > 0) {
          console.log(
            `[${bot.username}] 🔁 Retry ${queue.failed.length} blok gagal di '${finishedName}'`
          );
          queue.retryFailed();
        } else {
          // Validasi
          const validation = placer.validateBlueprint(queue.currentBlocks);
          console.log(
            `[${bot.username}] 🔍 Validasi '${finishedName}': ${validation.placed}/${validation.total} (${validation.percent}%)`
          );
          markPhaseComplete(finishedName);
          queue.current = null;
          queue.blockIndex = 0;

          // Elapsed time
          if (stats.startTime) {
            const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
            civ.addLog(
              `[${bot.username}] ⏱️ ${finishedName} selesai dalam ${elapsed}s | Total blok: ${stats.totalPlaced}`
            );
          }
        }
      }
    } catch (err) {
      console.error(`[${bot.username}] [building ERROR] ${err.message}`);
    }

    active = false;
  }

  // ─── Public API ──────────────────────────────

  return {
    name: 'building',
    label: '🧱 Building',
    isViable,

    /** Dapatkan fase saat ini */
    getPhase() {
      return detectCurrentPhase();
    },

    /** Info progres build saat ini */
    getProgress() {
      return {
        phase: queue.currentName,
        progress: queue.progress,
        remaining: queue.remaining,
        totalPlaced: stats.totalPlaced,
        totalFailed: stats.totalFailed,
        queueLength: queue.queue.length,
      };
    },

    /**
     * PUBLIC: Bangun struktur kustom APA SAJA
     * Contoh:
     *   skill.build('menara', { type:'tower', origin: pos, dimensions:{radius:4,height:15}, material:'stone_bricks' })
     *   skill.build('rumah', { type:'house', origin: pos, dimensions:{w:9,h:5,d:9}, material:'oak_planks', withDoor:true })
     *   skill.build('piramida', { type:'pyramid', origin: pos, dimensions:{base:13}, material:'sandstone' })
     *   skill.build('kubah', { type:'dome', origin: pos, dimensions:{radius:8}, material:'quartz_block' })
     *   skill.build('jembatan', { type:'bridge', origin: pos, dimensions:{length:25,width:4}, material:'stone_bricks' })
     *   skill.build('platform', { type:'platform', origin: pos, dimensions:{w:20,d:20}, material:'cobblestone' })
     *   skill.build('custom', { type:'custom', blocks:[{pos,material},...] })
     */
    build(name, spec, priority = 0) {
      return enqueueBuild(name, spec, priority);
    },

    /** Bersihkan queue dan reset semua state */
    clearQueue() {
      queue.reset();
      stats.totalPlaced = 0;
      stats.totalFailed = 0;
      stats.startTime = null;
      console.log(`[${bot.username}] 🗑️ Build queue direset`);
    },

    start() {
      stats.startTime = Date.now();
      const phase = detectCurrentPhase();
      civ.addLog(`[${bot.username}] 🧱 Building dimulai — fase: ${phase}`);
      if (queue.isDone) loadDefaultBlueprints();
      interval = setInterval(run, BUILD_CONFIG.TICK_INTERVAL_MS);
    },

    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      civ.addLog(`[${bot.username}] 🛑 Building dihentikan | Blok terpasang: ${stats.totalPlaced}`);
    },

    // Expose generator untuk penggunaan eksternal
    generateBlueprint,
    BUILD_CONFIG,
  };
};
