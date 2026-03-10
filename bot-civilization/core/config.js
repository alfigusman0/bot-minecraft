/**
 * CONFIG — Konfigurasi global peradaban
 * Ganti HOME_BASE untuk pindah titik pusat peradaban
 */

const { Vec3 } = require('vec3');

// ── TITIK PUSAT PERADABAN ────────────────────────────────────
// Semua bot spawn, respawn, dan tidur di sekitar titik ini
const HOME_BASE = new Vec3(1677, 71, 367);

// Radius aman untuk kembali ke base sebelum malam (blok)
// Bot akan pulang jika jarak > ini saat waktu mendekati malam
const HOME_RETURN_RADIUS = 150;

// Jarak dari HOME_BASE untuk mencari target kerja (logging, mining, dll)
const WORK_RADIUS = 80;

// Waktu malam dimulai (ticks). 11500 = bot mulai pulang, 12500 = gelap total
const NIGHT_WARN_TICK = 11000; // Bot mulai bergerak pulang
const NIGHT_START_TICK = 12541; // Malam resmi dimulai
const DAY_START_TICK = 0; // Pagi

// ── LAYOUT BANGUNAN DI SEKITAR HOME_BASE ────────────────────
// Semua offset relatif dari HOME_BASE
const LAYOUT = {
  // Rumah utama (shelter semua bot) — di depan base
  mainHouse: HOME_BASE.offset(2, 0, 2),

  // Area tidur di dalam rumah (bed zone)
  bedZone: HOME_BASE.offset(3, 1, 3),

  // Area farm — sebelah kanan base
  farmZone: HOME_BASE.offset(10, 0, 0),

  // Area storage (chest) — di dalam/dekat rumah
  storageZone: HOME_BASE.offset(2, 0, -2),

  // Area livestock (kandang hewan) — belakang base
  livestockZone: HOME_BASE.offset(-5, 0, 5),

  // Area mining entry point
  mineEntry: HOME_BASE.offset(0, -5, 10),
};

// ── BLUEPRINT BANGUNAN ───────────────────────────────────────

/**
 * Rumah 7x7x4 dengan atap, pintu, dan jendela
 * Cukup untuk 5 bot + storage + crafting area
 */
function blueprintMainHouse(origin) {
  const blocks = [];
  const o = origin.floored();

  for (let x = 0; x < 7; x++) {
    for (let z = 0; z < 7; z++) {
      for (let y = 0; y < 4; y++) {
        const isWall = x === 0 || x === 6 || z === 0 || z === 6;
        const isFloor = y === 0;
        const isRoof = y === 3;
        const isDoor = x === 3 && z === 0 && (y === 1 || y === 2);
        const isWindow =
          y === 2 &&
          ((x === 2 && (z === 0 || z === 6)) ||
            (x === 4 && (z === 0 || z === 6)) ||
            (z === 2 && (x === 0 || x === 6)) ||
            (z === 4 && (x === 0 || x === 6)));

        if (isDoor || isWindow) continue; // Kosongkan untuk pintu & jendela
        if (isFloor || isRoof || isWall) {
          blocks.push({
            pos: new Vec3(o.x + x, o.y + y, o.z + z),
            material: isFloor ? 'cobblestone' : isRoof ? 'oak_planks' : 'cobblestone',
          });
        }
      }
    }
  }
  return blocks;
}

/**
 * Tembok keliling 15x15x3 mengelilingi HOME_BASE
 */
function blueprintPerimeterWall(origin) {
  const blocks = [];
  const o = origin.offset(-4, 0, -4).floored();
  const SIZE = 15;

  for (let x = 0; x < SIZE; x++) {
    for (let h = 0; h < 3; h++) {
      blocks.push({ pos: new Vec3(o.x + x, o.y + h, o.z), material: 'cobblestone' });
      blocks.push({ pos: new Vec3(o.x + x, o.y + h, o.z + SIZE - 1), material: 'cobblestone' });
    }
  }
  for (let z = 1; z < SIZE - 1; z++) {
    for (let h = 0; h < 3; h++) {
      blocks.push({ pos: new Vec3(o.x, o.y + h, o.z + z), material: 'cobblestone' });
      blocks.push({ pos: new Vec3(o.x + SIZE - 1, o.y + h, o.z + z), material: 'cobblestone' });
    }
  }
  return blocks;
}

/**
 * Area farm: 8 baris lahan dengan irrigasi tengah
 */
function blueprintFarm(origin) {
  const blocks = [];
  const o = origin.floored();

  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 9; z++) {
      if (x === 4) {
        // Parit irigasi
        blocks.push({
          pos: new Vec3(o.x + x, o.y, o.z + z),
          material: 'water_bucket',
          type: 'water',
        });
      } else {
        // Lahan farmland
        blocks.push({ pos: new Vec3(o.x + x, o.y, o.z + z), material: 'farmland', type: 'till' });
      }
    }
  }
  return blocks;
}

module.exports = {
  HOME_BASE,
  HOME_RETURN_RADIUS,
  WORK_RADIUS,
  NIGHT_WARN_TICK,
  NIGHT_START_TICK,
  DAY_START_TICK,
  LAYOUT,
  blueprintMainHouse,
  blueprintPerimeterWall,
  blueprintFarm,
};
