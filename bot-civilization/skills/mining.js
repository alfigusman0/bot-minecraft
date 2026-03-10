/**
 * MINING SKILL — SiPenambang
 *
 * Strategi tambang aman:
 * 1. Buat shaft vertikal dengan TANGGA (staircase 2-blok zigzag) agar bisa naik-turun
 * 2. Pasang torch setiap 8 blok turun agar tidak gelap
 * 3. Tambang ore di sekitar setiap level
 * 4. Jika inventory penuh → naik ke surface, deposit, kembali
 * 5. Jika waktu mendekati malam → naik ke surface sebelum gelap
 * 6. Selalu bisa kembali ke atas lewat tangga yang sudah dibuat
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem, countItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const { HOME_BASE, NIGHT_WARN_TICK } = require('../core/config');

const ORE_PRIORITY = [
  { name: 'ancient_debris', resource: 'ancient_debris', value: 10 },
  { name: 'diamond_ore', resource: 'diamond', value: 8 },
  { name: 'deepslate_diamond_ore', resource: 'diamond', value: 8 },
  { name: 'gold_ore', resource: 'gold', value: 5 },
  { name: 'deepslate_gold_ore', resource: 'gold', value: 5 },
  { name: 'iron_ore', resource: 'iron', value: 3 },
  { name: 'deepslate_iron_ore', resource: 'iron', value: 3 },
  { name: 'coal_ore', resource: 'coal', value: 2 },
  { name: 'deepslate_coal_ore', resource: 'coal', value: 2 },
  { name: 'cobblestone', resource: 'cobblestone', value: 1 },
  { name: 'stone', resource: 'stone', value: 1 },
];

const PICKAXES = [
  'netherite_pickaxe',
  'diamond_pickaxe',
  'iron_pickaxe',
  'stone_pickaxe',
  'wooden_pickaxe',
];
const TORCH_INTERVAL = 8; // Pasang torch setiap N blok turun
const TARGET_DEPTH = 12; // Y target untuk ore besi/diamond (Y=12 paling optimal 1.18+)
const SURFACE_Y_MARGIN = 5; // Anggap "di surface" jika Y >= surfaceY - margin

module.exports = function miningSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;

  // State shaft
  let shaftEntry = null; // Vec3 posisi mulai turun (surface)
  let shaftX = null; // X tetap untuk shaft vertikal
  let shaftZ = null; // Z tetap untuk shaft vertikal
  let surfaceY = null; // Y surface saat mulai tambang
  let descending = false;
  let ascending = false;

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  function isViable() {
    return true;
  }

  function timeOfDay() {
    return bot.time?.timeOfDay ?? 0;
  }
  function isApproachingNight() {
    const t = timeOfDay();
    return t >= NIGHT_WARN_TICK && t <= 23500;
  }

  function currentY() {
    return bot.entity ? Math.floor(bot.entity.position.y) : 64;
  }

  function isUnderground() {
    if (!surfaceY) return false;
    return currentY() < surfaceY - SURFACE_Y_MARGIN;
  }

  // ── Pastikan ada pickaxe ─────────────────────────────────────
  async function ensurePickaxe() {
    if (PICKAXES.some(p => bot.inventory.items().find(i => i.name === p))) return true;
    for (const pick of PICKAXES) {
      if (await getStorage().fetchFromStorage(pick, 1)) return true;
    }
    return false;
  }

  // ── Pasang torch ─────────────────────────────────────────────
  async function placeTorch() {
    const torch = bot.inventory.items().find(i => i.name === 'torch');
    if (!torch) return;
    await bot.equip(torch, 'hand');
    // Coba tempel ke dinding di sekitar bot
    const pos = bot.entity.position.floored();
    const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
    for (const d of dirs) {
      const wall = bot.blockAt(pos.plus(d));
      if (wall && wall.name !== 'air') {
        try {
          await bot.placeBlock(wall, d.scaled(-1));
          return;
        } catch (_) {}
      }
    }
    // Fallback: tempel ke lantai
    const floor = bot.blockAt(pos.offset(0, -1, 0));
    if (floor && floor.name !== 'air') {
      try {
        await bot.placeBlock(floor, new Vec3(0, 1, 0));
      } catch (_) {}
    }
  }

  // ── Tambang satu blok dengan safety check ───────────────────
  async function digSafe(block) {
    if (!block || block.name === 'air') return false;
    // Jangan tambang blok yang bisa menyebabkan jatuh bebas jauh
    const above = bot.blockAt(block.position.offset(0, 1, 0));
    const above2 = bot.blockAt(block.position.offset(0, 2, 0));
    // Jika ada lava/air di atas → skip
    if (
      ['lava', 'flowing_lava', 'water', 'flowing_water'].includes(above?.name) ||
      ['lava', 'flowing_lava', 'water', 'flowing_water'].includes(above2?.name)
    ) {
      console.log(`[${bot.username}] ⚠️ Skip — ada fluida di atas ${block.position}`);
      return false;
    }
    try {
      await bot.dig(block);
      await waitMs(200);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] Gagal dig: ${err.message}`);
      return false;
    }
  }

  // ── NAIK ke surface lewat staircase ──────────────────────────
  // Strategi: pathfinder dibiarkan cari jalan sendiri ke shaftEntry
  // karena kita sudah buat tangga 2-blok saat turun
  async function ascendToSurface() {
    if (!shaftEntry) {
      // Tidak tahu entry point → naik lurus ke Y surface pakai staircase manual
      await climbUp();
      return;
    }

    ascending = true;
    console.log(
      `[${bot.username}] ⬆️ Naik ke surface (${shaftEntry.x},${shaftEntry.y},${shaftEntry.z})...`
    );
    civ.addLog(`[${bot.username}] ⬆️ Naik ke surface`);

    try {
      await withUnstuck(
        bot,
        () => bot.pathfinder.goto(new goals.GoalNear(shaftEntry.x, shaftEntry.y, shaftEntry.z, 3)),
        60000 // Tambah timeout lebih panjang untuk naik dari jauh
      );
      console.log(`[${bot.username}] ✅ Sudah di surface`);
    } catch (err) {
      console.log(`[${bot.username}] Gagal lewat shaft, coba naik manual...`);
      await climbUp();
    } finally {
      ascending = false;
    }
  }

  // ── Naik manual jika shaft hilang/tidak bisa diakses ────────
  async function climbUp() {
    const targetY = surfaceY || currentY() + 30;
    let stuckCount = 0;
    let lastY = currentY();

    console.log(`[${bot.username}] 🪜 Naik manual ke Y=${targetY}`);

    while (currentY() < targetY - 2) {
      const pos = bot.entity.position.floored();
      const above = bot.blockAt(pos.offset(0, 1, 0));
      const above2 = bot.blockAt(pos.offset(0, 2, 0));
      const below = bot.blockAt(pos.offset(0, -1, 0));

      // Jika ada blok di atas → tambang dulu
      if (above && above.name !== 'air') {
        await bot
          .equip(
            bot.inventory.items().find(i => PICKAXES.includes(i.name)) || bot.inventory.items()[0],
            'hand'
          )
          .catch(() => {});
        await digSafe(above);
      }
      if (above2 && above2.name !== 'air') {
        await digSafe(above2);
      }

      // Pasang blok di bawah untuk naik (pillar up)
      const cobble = bot.inventory
        .items()
        .find(i => ['cobblestone', 'dirt', 'stone', 'gravel'].includes(i.name));
      if (cobble && below && below.name === 'air') {
        // Kita di udara, perlu pijakan
        await bot.equip(cobble, 'hand');
        await bot.placeBlock(bot.blockAt(pos.offset(0, -2, 0)), new Vec3(0, 1, 0)).catch(() => {});
      }

      // Lompat ke atas
      bot.setControlState('jump', true);
      await waitMs(400);
      bot.setControlState('jump', false);
      await waitMs(300);

      // Deteksi stuck
      if (currentY() <= lastY) {
        stuckCount++;
        if (stuckCount > 5) {
          console.log(`[${bot.username}] Stuck saat naik, paksa jump+forward`);
          bot.setControlState('forward', true);
          bot.setControlState('jump', true);
          await waitMs(800);
          bot.setControlState('forward', false);
          bot.setControlState('jump', false);
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
      }
      lastY = currentY();
    }

    // Reset control states
    ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(s => {
      try {
        bot.setControlState(s, false);
      } catch (_) {}
    });
    console.log(`[${bot.username}] ✅ Naik selesai Y=${currentY()}`);
  }

  // ── Buat satu step tangga spiral turun (2 blok tinggi) ──────
  // Pattern: tambang 2 blok ke bawah sambil jalan satu langkah ke depan
  // Hasilnya adalah tangga yang bisa dinaiki/dituruninya kembali
  async function digStairStep(direction) {
    const pos = bot.entity.position.floored();
    const front = pos.plus(direction);

    // Tambang 2 blok di depan (head + feet level)
    const b1 = bot.blockAt(front);
    const b2 = bot.blockAt(front.offset(0, 1, 0));
    const b3 = bot.blockAt(front.offset(0, -1, 0)); // satu bawah depan

    if (b2 && b2.name !== 'air') await digSafe(b2);
    if (b1 && b1.name !== 'air') await digSafe(b1);

    // Pindah ke depan
    await withUnstuck(
      bot,
      () => bot.pathfinder.goto(new goals.GoalNear(front.x, front.y, front.z, 0)),
      5000
    );

    // Tambang 1 blok di bawah untuk tangga ke bawah
    const newPos = bot.entity.position.floored();
    const stepDown = bot.blockAt(newPos.offset(0, -1, 0));
    if (stepDown && stepDown.name !== 'air') {
      await digSafe(stepDown);
    }
    // Tambang 1 lagi untuk kedalaman 2
    const stepDown2 = bot.blockAt(newPos.offset(0, -2, 0));
    if (stepDown2 && stepDown2.name !== 'air') {
      await digSafe(stepDown2);
    }

    // Turun
    await withUnstuck(
      bot,
      () => bot.pathfinder.goto(new goals.GoalNear(newPos.x, newPos.y - 1, newPos.z, 0)),
      5000
    );
  }

  // ── TURUN dengan staircase ────────────────────────────────────
  // Membuat tangga spiral 4-arah agar ada jalan naik kembali
  async function descendWithStaircase(targetDepth) {
    if (!shaftEntry) {
      shaftEntry = bot.entity.position.floored();
      shaftX = shaftEntry.x;
      shaftZ = shaftEntry.z;
      surfaceY = shaftEntry.y;
    }

    descending = true;
    console.log(`[${bot.username}] ⬇️ Turun ke Y=${targetDepth} dengan tangga...`);

    const directions = [
      new Vec3(1, 0, 0), // +X
      new Vec3(0, 0, 1), // +Z
      new Vec3(-1, 0, 0), // -X
      new Vec3(0, 0, -1), // -Z
    ];

    let dirIdx = 0;
    let stepsSinceT = 0; // langkah sejak torch terakhir
    let stepsInDir = 0;
    const stepsPerDir = 2; // 2 langkah per arah sebelum putar

    await equipBest(bot, PICKAXES, 'hand');

    while (currentY() > targetDepth) {
      // Cek kondisi stop
      if (isApproachingNight()) {
        console.log(`[${bot.username}] 🌙 Mendekati malam, hentikan turun`);
        break;
      }
      if (getStorage().isInventoryFull()) {
        console.log(`[${bot.username}] 🎒 Inventory penuh, naik dulu`);
        break;
      }

      const dir = directions[dirIdx % 4];
      await digStairStep(dir);
      stepsInDir++;
      stepsSinceT++;

      // Pasang torch setiap TORCH_INTERVAL langkah
      if (stepsSinceT >= TORCH_INTERVAL) {
        await placeTorch();
        stepsSinceT = 0;
      }

      // Ganti arah setiap stepsPerDir langkah → spiral
      if (stepsInDir >= stepsPerDir) {
        dirIdx++;
        stepsInDir = 0;
      }

      await waitMs(100);
    }

    descending = false;
    console.log(`[${bot.username}] ⬇️ Selesai turun, Y=${currentY()}`);
  }

  // ── Tambang ore di sekitar posisi saat ini ───────────────────
  async function mineNearbyOres(radius = 16) {
    await equipBest(bot, PICKAXES, 'hand');
    let mined = 0;

    for (const ore of ORE_PRIORITY) {
      const id = mcData.blocksByName[ore.name]?.id;
      if (!id) continue;

      const found =
        bot.findBlock({
          matching: id,
          maxDistance: radius,
          // Preferensikan ore di level yang sama atau dekat
          useExtraInfo: b => Math.abs(b.position.y - currentY()) <= 4,
        }) || bot.findBlock({ matching: id, maxDistance: radius });

      if (!found) continue;

      // Pergi ke ore
      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(found.position.x, found.position.y, found.position.z, 2)
            ),
          15000
        );
      } catch (_) {
        continue;
      }

      const block = bot.blockAt(found.position);
      if (!block || block.name === 'air') continue;

      const ok = await digSafe(block);
      if (ok) {
        mined++;
        civ.addResources({ [ore.resource]: 1 });
        civ.addLog(`[${bot.username}] ⛏️ Tambang ${ore.name} (Y=${currentY()})`);

        // Langsung tambang ore yang bersebelahan (vein mining)
        for (const adj of [
          new Vec3(1, 0, 0),
          new Vec3(-1, 0, 0),
          new Vec3(0, 1, 0),
          new Vec3(0, -1, 0),
          new Vec3(0, 0, 1),
          new Vec3(0, 0, -1),
        ]) {
          const adjBlock = bot.blockAt(found.position.plus(adj));
          if (adjBlock?.name === block.name) {
            await digSafe(adjBlock);
            civ.addResources({ [ore.resource]: 1 });
            mined++;
          }
        }
      }

      if (mined >= 8) break; // Batasi per run agar tidak terlalu lama di bawah
    }

    return mined;
  }

  // ── MAIN RUN ─────────────────────────────────────────────────
  async function run() {
    if (active || descending || ascending) return;
    active = true;

    try {
      // Mendekati malam & sedang di bawah tanah → naik dulu
      if (isApproachingNight() && isUnderground()) {
        console.log(`[${bot.username}] 🌙 Malam mendekat & underground → naik!`);
        civ.addLog(`[${bot.username}] 🌙 Naik sebelum malam`);
        await ascendToSurface();
        active = false;
        return;
      }

      // Deposit jika penuh (di surface)
      if (!isUnderground()) {
        await getStorage().checkAndDeposit();
      }

      if (!(await ensurePickaxe())) {
        console.log(`[${bot.username}] Tidak ada pickaxe!`);
        active = false;
        return;
      }

      await equipBest(bot, PICKAXES, 'hand');

      // ── Cari ore terdekat di radius kecil dulu (horizontal) ──
      const nearOre = (() => {
        for (const ore of ORE_PRIORITY) {
          const id = mcData.blocksByName[ore.name]?.id;
          if (!id) continue;
          // Cari ore yang TIDAK mengharuskan turun jauh (max 5 blok ke bawah)
          const found = bot.findBlock({
            matching: id,
            maxDistance: 20,
            useExtraInfo: b => b.position.y >= currentY() - 5,
          });
          if (found) return { block: found, meta: ore };
        }
        return null;
      })();

      if (nearOre) {
        // Ada ore dekat di level yang sama → langsung tambang
        try {
          await withUnstuck(
            bot,
            () =>
              bot.pathfinder.goto(
                new goals.GoalNear(
                  nearOre.block.position.x,
                  nearOre.block.position.y,
                  nearOre.block.position.z,
                  2
                )
              ),
            12000
          );
          const block = bot.blockAt(nearOre.block.position);
          if (block && block.name !== 'air') {
            await digSafe(block);
            civ.addResources({ [nearOre.meta.resource]: 1 });
            civ.addLog(`[${bot.username}] ⛏️ Tambang ${nearOre.meta.name}`);
          }
        } catch (_) {}
      } else {
        // Tidak ada ore di dekat → buat shaft ke bawah
        if (!isUnderground()) {
          // Simpan posisi entry shaft
          shaftEntry = bot.entity.position.floored();
          shaftX = shaftEntry.x;
          shaftZ = shaftEntry.z;
          surfaceY = shaftEntry.y;

          console.log(`[${bot.username}] ⛏️ Mulai shaft dari Y=${surfaceY} ke Y=${TARGET_DEPTH}`);
          civ.addLog(`[${bot.username}] ⛏️ Buat shaft ke Y=${TARGET_DEPTH}`);

          await descendWithStaircase(TARGET_DEPTH);

          // Tambang ore di kedalaman ini
          await mineNearbyOres(24);

          // Naik kembali setelah selesai / full / mau malam
          console.log(`[${bot.username}] ⬆️ Selesai di Y=${currentY()}, naik...`);
          await ascendToSurface();

          // Deposit setelah naik
          await getStorage().checkAndDeposit();
        } else {
          // Sudah di bawah tanah, tambang sekitar dulu sebelum naik
          const mined = await mineNearbyOres(20);
          if (mined === 0) {
            // Tidak ada ore → naik
            console.log(`[${bot.username}] Tidak ada ore, naik...`);
            await ascendToSurface();
          }
        }
      }
    } catch (err) {
      console.log(`[${bot.username}] [mining] ${err.message}`);
      // Safety: jika error saat di bawah tanah → paksa naik
      if (isUnderground()) {
        console.log(`[${bot.username}] Error saat underground, coba naik manual...`);
        try {
          await climbUp();
        } catch (_) {}
      }
    }

    active = false;
  }

  return {
    name: 'mining',
    label: '⛏️ Mining',
    isViable,
    isUnderground() {
      return isUnderground();
    },
    ascendNow() {
      return ascendToSurface();
    },
    start() {
      civ.addLog(`[${bot.username}] ⛏️ Mulai mining`);
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      descending = false;
      // Safety: pastikan naik jika masih di bawah saat skill dihentikan
      if (isUnderground() && !ascending) {
        console.log(`[${bot.username}] Mining dihentikan saat underground, naik...`);
        ascendToSurface().catch(() => climbUp().catch(() => {}));
      }
    },
  };
};
