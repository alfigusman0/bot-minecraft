/**
 * BUILDING SKILL — SiBuilder
 *
 * Urutan pembangunan:
 * 1. Rumah utama 7x7x4 di HOME_BASE (shelter + tempat tidur semua bot)
 * 2. Tembok perimeter 15x15x3 mengelilingi base
 * 3. Area farm (tillage + irrigasi)
 * 4. Perluasan / perbaikan
 *
 * Selalu ambil material dari storage jika inventory kurang.
 */

const { goals } = require('mineflayer-pathfinder');
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

const MATERIALS_PRIORITY = [
  'cobblestone',
  'stone',
  'oak_planks',
  'spruce_planks',
  'smooth_stone',
  'stone_bricks',
  'bricks',
  'dirt',
];

// Fase pembangunan
const BUILD_PHASES = ['house', 'wall', 'farm', 'done'];

module.exports = function buildingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;

  // Blueprint saat ini
  let currentPhase = null;
  let blueprintBlocks = []; // [{pos, material}]
  let blockIndex = 0;

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  // ── Tentukan fase berikutnya ──────────────────────────────
  function detectCurrentPhase() {
    const state = civ.getState();
    if (!state.structures.house) return 'house';
    if (!state.structures.wall) return 'wall';
    if (!state.structures.farm) return 'farm';
    return 'done';
  }

  function loadBlueprint(phase) {
    currentPhase = phase;
    blockIndex = 0;

    if (phase === 'house') {
      blueprintBlocks = blueprintMainHouse(LAYOUT.mainHouse);
      console.log(`[${bot.username}] 🏠 Blueprint RUMAH: ${blueprintBlocks.length} blok`);
      civ.addLog(`[${bot.username}] 🏠 Mulai bangun rumah di base`);
    } else if (phase === 'wall') {
      blueprintBlocks = blueprintPerimeterWall(HOME_BASE);
      console.log(`[${bot.username}] 🧱 Blueprint TEMBOK: ${blueprintBlocks.length} blok`);
      civ.addLog(`[${bot.username}] 🧱 Mulai bangun tembok perimeter`);
    } else if (phase === 'farm') {
      blueprintBlocks = blueprintFarm(LAYOUT.farmZone);
      console.log(`[${bot.username}] 🌾 Blueprint FARM: ${blueprintBlocks.length} blok`);
      civ.addLog(`[${bot.username}] 🌾 Mulai bangun area farm`);
    } else {
      blueprintBlocks = [];
    }
  }

  function isViable() {
    const phase = detectCurrentPhase();
    if (phase === 'done') return false;
    return bot.inventory.items().some(i => MATERIALS_PRIORITY.includes(i.name));
  }

  // ── Ambil material dari storage jika tidak punya ──────────
  async function ensureMaterial(materialName) {
    const has = bot.inventory.items().find(i => i.name === materialName);
    if (has && has.count >= 4) return true;
    // Coba ambil dari storage
    return await getStorage().fetchFromStorage(materialName, 32);
  }

  async function ensureAnyMaterial() {
    if (bot.inventory.items().some(i => MATERIALS_PRIORITY.includes(i.name))) return true;
    for (const mat of MATERIALS_PRIORITY) {
      if (await getStorage().fetchFromStorage(mat, 32)) return true;
    }
    return false;
  }

  // ── Letakkan satu blok ────────────────────────────────────
  async function placeBlock(pos, materialName) {
    // Cek sudah ada blok di sini
    const existing = bot.blockAt(pos);
    if (
      existing &&
      existing.name !== 'air' &&
      existing.name !== 'water' &&
      existing.name !== 'lava'
    ) {
      return true; // Sudah ada blok, skip
    }

    // Pastikan punya material
    let item = bot.inventory.items().find(i => i.name === materialName);
    if (!item) {
      await ensureMaterial(materialName);
      item = bot.inventory.items().find(i => i.name === materialName);
    }
    // Fallback ke material apapun yang ada
    if (!item) item = bot.inventory.items().find(i => MATERIALS_PRIORITY.includes(i.name));
    if (!item) return false;

    await bot.equip(item, 'hand');

    // Pergi ke dekat blok
    await withUnstuck(
      bot,
      () => bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)),
      12000
    );

    // Cari reference block (blok di bawah/samping yang bisa dijadikan sandaran)
    const dirs = [
      new Vec3(0, -1, 0),
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(0, 1, 0),
    ];

    for (const dir of dirs) {
      const refPos = pos.plus(dir);
      const refBlock = bot.blockAt(refPos);
      if (refBlock && refBlock.name !== 'air' && !BED_NAMES.includes(refBlock.name)) {
        try {
          const faceDir = dir.scaled(-1); // arah face dari ref ke target
          await bot.placeBlock(refBlock, faceDir);
          await waitMs(200);
          return true;
        } catch (_) {
          continue;
        }
      }
    }
    return false;
  }

  const BED_NAMES = [
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
  ];

  // ── Main run ─────────────────────────────────────────────
  async function run() {
    if (active) return;
    active = true;

    try {
      await getStorage().checkAndDeposit();

      // Tentukan fase
      const phase = detectCurrentPhase();
      if (phase === 'done') {
        civ.addLog(`[${bot.username}] 🏛️ Semua bangunan selesai!`);
        active = false;
        return;
      }

      // Load blueprint jika belum atau fase berubah
      if (currentPhase !== phase || !blueprintBlocks.length) {
        loadBlueprint(phase);
      }

      if (!(await ensureAnyMaterial())) {
        console.log(`[${bot.username}] Tidak ada material untuk bangun`);
        active = false;
        return;
      }

      // Pergi ke area HOME_BASE dulu jika jauh
      const distToBase = bot.entity.position.distanceTo(HOME_BASE);
      if (distToBase > 30) {
        await withUnstuck(
          bot,
          () => bot.pathfinder.goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 5)),
          20000
        );
      }

      // Pasang blok satu per satu (max 8 per run)
      let placed = 0;
      while (blockIndex < blueprintBlocks.length && placed < 8) {
        const { pos, material } = blueprintBlocks[blockIndex];
        blockIndex++;

        const ok = await placeBlock(pos, material);
        if (ok) placed++;
        await waitMs(150);
      }

      // Cek apakah fase selesai
      if (blockIndex >= blueprintBlocks.length) {
        console.log(`[${bot.username}] ✅ Fase ${phase} selesai!`);
        civ.addLog(`[${bot.username}] ✅ ${phase} selesai!`);

        if (phase === 'house')
          civ.updateState(s => {
            s.structures.house = true;
          });
        if (phase === 'wall')
          civ.updateState(s => {
            s.structures.wall = true;
          });
        if (phase === 'farm')
          civ.updateState(s => {
            s.structures.farm = true;
          });

        blueprintBlocks = [];
        blockIndex = 0;
        currentPhase = null;
      } else {
        const progress = Math.round((blockIndex / blueprintBlocks.length) * 100);
        if (blockIndex % 20 === 0) {
          civ.addLog(`[${bot.username}] 🏗️ ${phase} ${progress}%`);
        }
      }
    } catch (err) {
      console.log(`[${bot.username}] [building] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'building',
    label: '🧱 Building',
    isViable,
    getPhase() {
      return detectCurrentPhase();
    },
    start() {
      const phase = detectCurrentPhase();
      civ.addLog(`[${bot.username}] 🧱 Mulai building — fase: ${phase}`);
      loadBlueprint(phase);
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
