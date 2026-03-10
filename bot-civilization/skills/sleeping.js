/**
 * SLEEPING SKILL — fix "the bed is occupied" loop
 *
 * Root cause sebelumnya:
 * - Klaim bed via civilization.json (file) → terlalu lambat, 5 bot baca/tulis
 *   hampir bersamaan, klaim belum ter-flush sebelum bot lain baca
 * - Semua bot retry ke bed yang SAMA karena findFreeBed() tetap return bed itu
 *
 * Fix:
 * 1. Cek entity sleeping di bed secara LANGSUNG dari world state (bukan file)
 * 2. Setiap bot punya DELAY berbeda sebelum tidur berdasarkan nama bot
 *    → tidak semua cari bed di detik yang persis sama
 * 3. Setelah berhasil tidur, set flag lokal isSleeping = true → tidak retry lagi
 * 4. findFreeBed() exclude bed yang ada sleeping entity di atasnya
 * 5. Jika semua bed penuh → buat bed baru lalu tidur di situ
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');
const { HOME_BASE, HOME_RETURN_RADIUS, NIGHT_WARN_TICK, LAYOUT } = require('../core/config');

const BED_TYPES = [
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
const WOOL_COLORS = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
];

// Stagger delay per bot agar tidak cari bed bersamaan (ms)
const BOT_SLEEP_DELAY = {
  SiPetani: 0,
  SiPenebang: 1500,
  SiPenambang: 3000,
  SiPenjaga: 4500,
  SiBuilder: 6000,
};

function posKey(pos) {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

module.exports = function sleepingSkill(bot, mcData) {
  let active = false;
  let isSleeping = false;
  let checkTimer = null;
  let returningHome = false;
  let storage = null;
  let myBedKey = null; // posKey bed yang sedang saya pakai

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  const staggerDelay = BOT_SLEEP_DELAY[bot.username] ?? 0;

  function timeOfDay() {
    return bot.time?.timeOfDay ?? 0;
  }
  function isApproachingNight() {
    const t = timeOfDay();
    return t >= NIGHT_WARN_TICK && t <= 23500;
  }
  function isNight() {
    const t = timeOfDay();
    return t >= 12541 && t <= 23500;
  }
  function distToHome() {
    return bot.entity ? bot.entity.position.distanceTo(HOME_BASE) : 999;
  }
  function isNearHome() {
    return distToHome() <= 16;
  }
  function isViable() {
    return isApproachingNight() && !isSleeping;
  }

  // ── Cek apakah bed sedang ditiduri entity (REALTIME dari world) ─
  function isBedOccupiedByEntity(bedPos) {
    // Cek semua sleeping players / entities di sekitar bed
    for (const entity of Object.values(bot.entities)) {
      if (!entity || entity === bot.entity) continue;
      if (!entity.position) continue;
      // Player yang sedang tidur biasanya posisinya tepat di atas bed
      const dx = Math.abs(entity.position.x - bedPos.x);
      const dy = Math.abs(entity.position.y - (bedPos.y + 0.5));
      const dz = Math.abs(entity.position.z - bedPos.z);
      if (dx < 1 && dy < 1 && dz < 1) return true;
    }
    return false;
  }

  // ── Cek apakah bed ini diklaim bot lain via civ state ──────────
  function isBedClaimedByOther(key) {
    if (key === myBedKey) return false; // klaim sendiri
    const state = civ.getState();
    return Object.entries(state.bots).some(([name, info]) => {
      if (name === bot.username) return false;
      return info.bedPos === key;
    });
  }

  // ── Cari bed yang benar-benar bebas ──────────────────────────
  function findFreeBed(searchRadius = 48) {
    const ids = BED_TYPES.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (!ids.length) return null;

    const candidates = [];
    const seen = new Set();

    // Kumpulkan semua bed dalam radius
    for (let i = 0; i < 30; i++) {
      const found = bot.findBlock({
        matching: ids,
        maxDistance: searchRadius,
        useExtraInfo: b => !seen.has(posKey(b.position)),
      });
      if (!found) break;
      const key = posKey(found.position);
      seen.add(key);
      candidates.push(found);
    }

    if (!candidates.length) return null;

    // Filter: buang bed yang occupied entity ATAU diklaim bot lain
    const free = candidates.filter(b => {
      const key = posKey(b.position);
      if (isBedOccupiedByEntity(b.position)) return false;
      if (isBedClaimedByOther(key)) return false;
      return true;
    });

    if (!free.length) return null;

    // Pilih yang paling dekat HOME_BASE
    free.sort((a, b) => a.position.distanceTo(HOME_BASE) - b.position.distanceTo(HOME_BASE));
    return free[0];
  }

  // ── Klaim & release bed ───────────────────────────────────────
  function claimBed(bedBlock) {
    myBedKey = posKey(bedBlock.position);
    civ.updateBotStatus(bot.username, { bedPos: myBedKey, status: 'going_to_sleep' });
    console.log(`[${bot.username}] 🛏️ Klaim bed di ${myBedKey}`);
  }

  function releaseBed() {
    myBedKey = null;
    civ.updateBotStatus(bot.username, { bedPos: null });
  }

  // ── Pulang ke home base ───────────────────────────────────────
  async function returnHome() {
    if (isNearHome() || returningHome) return;
    const dist = distToHome();
    if (dist > HOME_RETURN_RADIUS) {
      console.log(`[${bot.username}] 🌙 Terlalu jauh (${dist.toFixed(0)} blok) untuk pulang`);
      return;
    }
    returningHome = true;
    console.log(`[${bot.username}] 🏠 Pulang ke base...`);
    civ.addLog(`[${bot.username}] 🏠 Pulang sebelum malam`);
    try {
      await withUnstuck(
        bot,
        () => bot.pathfinder.goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 5)),
        25000
      );
    } catch (err) {
      console.log(`[${bot.username}] Gagal pulang: ${err.message}`);
    } finally {
      returningHome = false;
    }
  }

  // ── Craft helpers ─────────────────────────────────────────────
  async function ensurePlanks() {
    if (hasItem(bot, 'oak_planks', 3)) return true;
    for (const log of ['oak_log', 'birch_log', 'spruce_log', 'acacia_log', 'dark_oak_log']) {
      if (!hasItem(bot, log)) continue;
      const plankName = log.replace('_log', '_planks');
      const id = mcData.itemsByName[plankName]?.id;
      if (!id) continue;
      const r = await bot.recipesFor(id, null, 1, null);
      if (r?.length) {
        await bot.craft(r[0], 4, null);
        await waitMs(300);
        return true;
      }
    }
    return await getStorage().fetchFromStorage('oak_planks', 8);
  }

  async function shearOrKillSheep() {
    const sheep = Object.values(bot.entities).find(
      e => e?.name?.toLowerCase() === 'sheep' && bot.entity.position.distanceTo(e.position) < 40
    );
    if (!sheep) return false;
    const shears = bot.inventory.items().find(i => i.name === 'shears');
    if (shears) {
      await bot.equip(shears, 'hand');
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2)
        )
      );
      await bot.activateEntity(sheep).catch(() => {});
    } else {
      await equipBest(bot, ['iron_sword', 'stone_sword', 'wooden_sword'], 'hand');
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2)
        )
      );
      let a = 0;
      while (sheep.isValid && a < 10) {
        bot.attack(sheep);
        await waitMs(700);
        a++;
      }
    }
    await waitMs(800);
    return true;
  }

  async function craftBed() {
    if (bot.inventory.items().find(i => BED_TYPES.includes(i.name))) return true;
    for (const color of WOOL_COLORS) {
      if (await getStorage().fetchFromStorage(`${color}_bed`, 1)) return true;
    }

    let wool = WOOL_COLORS.map(c => `${c}_wool`)
      .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
      .find(Boolean);

    if (!wool) {
      for (const c of WOOL_COLORS) {
        if (await getStorage().fetchFromStorage(`${c}_wool`, 3)) break;
      }
      wool = WOOL_COLORS.map(c => `${c}_wool`)
        .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
        .find(Boolean);
      if (!wool) {
        await shearOrKillSheep();
        wool = WOOL_COLORS.map(c => `${c}_wool`)
          .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
          .find(Boolean);
        if (!wool) return false;
      }
    }

    if (!(await ensurePlanks())) return false;

    const tableId = mcData.blocksByName['crafting_table']?.id;
    let table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;
    if (!table) {
      const t = bot.inventory.items().find(i => i.name === 'crafting_table');
      if (t) {
        await bot.equip(t, 'hand');
        const below = bot.blockAt(bot.entity.position.floored().offset(1, -1, 0));
        if (below?.name !== 'air') {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(500);
          table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 8 }) : null;
        }
      }
    }

    wool = WOOL_COLORS.map(c => `${c}_wool`)
      .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
      .find(Boolean);
    if (!wool) return false;

    const bedName = wool.name.replace('_wool', '_bed');
    const bedId = mcData.itemsByName[bedName]?.id;
    if (!bedId) return false;
    try {
      const recipes = await bot.recipesFor(bedId, null, 1, table);
      if (!recipes?.length) return false;
      if (table) {
        await withUnstuck(bot, () =>
          bot.pathfinder.goto(
            new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
          )
        );
      }
      await bot.craft(recipes[0], 1, table);
      civ.addLog(`[${bot.username}] 🛏️ Craft ${bedName}`);
      await waitMs(400);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] Gagal craft bed: ${err.message}`);
      return false;
    }
  }

  async function placeBedNearHome() {
    const bedItem = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
    if (!bedItem) return null;
    await bot.equip(bedItem, 'hand');

    const bedZone = LAYOUT.bedZone;
    const spots = [];
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) spots.push(bedZone.offset(x, 0, z));
    spots.sort((a, b) => a.distanceTo(bedZone) - b.distanceTo(bedZone));

    for (const target of spots) {
      const at = bot.blockAt(target);
      const below = bot.blockAt(target.offset(0, -1, 0));
      const above = bot.blockAt(target.offset(0, 1, 0));
      const head = bot.blockAt(target.offset(1, 0, 0));
      if (
        at?.name === 'air' &&
        above?.name === 'air' &&
        head?.name === 'air' &&
        below?.name !== 'air'
      ) {
        try {
          await withUnstuck(bot, () =>
            bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2))
          );
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(600);
          const placed = findFreeBed(8);
          if (placed) {
            civ.addLog(`[${bot.username}] 🛏️ Pasang bed baru di base`);
            return placed;
          }
        } catch (_) {
          continue;
        }
      }
    }
    return null;
  }

  // ── TIDUR dengan logika baru ───────────────────────────────
  async function trySleep() {
    // Stagger: tiap bot nunggu waktu berbeda agar tidak semua cari bed di detik sama
    if (staggerDelay > 0) {
      console.log(`[${bot.username}] ⏳ Stagger ${staggerDelay}ms sebelum cari bed...`);
      await waitMs(staggerDelay);
    }

    // Cari bed bebas (cek entity + civ state)
    let bed = findFreeBed();

    if (!bed) {
      console.log(`[${bot.username}] Semua bed penuh/occupied → craft & pasang baru`);
      // Semua bed sudah terisi → buat bed baru khusus bot ini
      const crafted = await craftBed();
      if (!crafted) {
        console.log(`[${bot.username}] Tidak bisa craft bed, skip tidur malam ini`);
        return false;
      }
      bed = await placeBedNearHome();
      if (!bed) {
        console.log(`[${bot.username}] Tidak bisa pasang bed`);
        return false;
      }
    }

    // Klaim bed ini di civ state
    claimBed(bed);
    await waitMs(300); // beri waktu tulis ke disk

    // Pergi ke bed
    try {
      await withUnstuck(
        bot,
        () =>
          bot.pathfinder.goto(
            new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)
          ),
        15000
      );
    } catch (err) {
      console.log(`[${bot.username}] Gagal pergi ke bed: ${err.message}`);
      releaseBed();
      return false;
    }

    // Verifikasi bed masih ada & bebas
    const freshBed = bot.blockAt(bed.position);
    if (!freshBed || !BED_TYPES.includes(freshBed.name)) {
      console.log(`[${bot.username}] Bed hilang setelah pathfind`);
      releaseBed();
      return false;
    }

    // Cek sekali lagi apakah ada entity di bed ini
    if (isBedOccupiedByEntity(bed.position)) {
      console.log(`[${bot.username}] Bed ${posKey(bed.position)} ada entitas, cari lain...`);
      releaseBed();
      // Cari bed lain langsung (rekursif 1x saja)
      const alt = findFreeBed();
      if (!alt) return false;
      claimBed(alt);
      await waitMs(200);
      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(alt.position.x, alt.position.y, alt.position.z, 2)
            ),
          12000
        );
        const altFresh = bot.blockAt(alt.position);
        if (!altFresh || !BED_TYPES.includes(altFresh.name)) {
          releaseBed();
          return false;
        }
        isSleeping = true;
        console.log(`[${bot.username}] 😴 Tidur di ${posKey(alt.position)}`);
        civ.addLog(`[${bot.username}] 😴 Tidur`);
        await bot.sleep(altFresh);
        return true;
      } catch (err) {
        isSleeping = false;
        releaseBed();
        console.log(`[${bot.username}] Gagal tidur alt bed: ${err.message}`);
        return false;
      }
    }

    // Tidur!
    try {
      isSleeping = true;
      console.log(`[${bot.username}] 😴 Tidur di ${posKey(bed.position)}`);
      civ.addLog(`[${bot.username}] 😴 Tidur`);
      civ.updateBotStatus(bot.username, { bedPos: myBedKey, status: 'sleeping' });
      await bot.sleep(freshBed);
      return true;
    } catch (err) {
      isSleeping = false;
      releaseBed();
      console.log(`[${bot.username}] Gagal tidur: ${err.message}`);
      return false;
    }
  }

  // ── Main loop ─────────────────────────────────────────────────
  async function run() {
    if (active || isSleeping) return;

    const t = timeOfDay();

    // Fase 1: Mendekati malam → pulang
    if (t >= NIGHT_WARN_TICK && t < 12541 && !isNearHome()) {
      active = true;
      await returnHome();
      active = false;
      return;
    }

    if (!isNight()) return;
    active = true;

    try {
      if (!isNearHome()) {
        await returnHome();
        if (!isNearHome()) {
          active = false;
          return;
        }
      }

      await trySleep();
    } catch (err) {
      console.log(`[${bot.username}] [sleeping] ${err.message}`);
      isSleeping = false;
      releaseBed();
    }

    active = false;
  }

  function onWake() {
    isSleeping = false;
    releaseBed();
    console.log(`[${bot.username}] ☀️ Bangun!`);
    civ.updateBotStatus(bot.username, { status: 'working' });
    civ.addLog(`[${bot.username}] ☀️ Bangun`);
  }

  return {
    name: 'sleeping',
    label: '😴 Sleeping',
    isViable,
    start() {
      bot.on('wake', onWake);
      checkTimer = setInterval(run, 3000);
    },
    stop() {
      if (checkTimer) clearInterval(checkTimer);
      checkTimer = null;
      active = false;
      bot.removeListener('wake', onWake);
      if (isSleeping) {
        bot.wake().catch(() => {});
        isSleeping = false;
      }
      releaseBed();
    },
  };
};
