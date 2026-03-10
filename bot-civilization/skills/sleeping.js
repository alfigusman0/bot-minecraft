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

// ── Helper: key unik untuk posisi bed ───────────────────────
function posKey(pos) {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

module.exports = function sleepingSkill(bot, mcData) {
  let active = false;
  let isSleeping = false;
  let checkTimer = null;
  let returningHome = false;
  let storage = null;

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

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

  // ── Baca semua bed yang sudah diklaim dari civ state ─────────
  function getClaimedBeds(excludeSelf = true) {
    const state = civ.getState();
    return Object.entries(state.bots)
      .filter(([name, info]) => {
        if (excludeSelf && name === bot.username) return false;
        return !!info.bedPos;
      })
      .map(([, info]) => info.bedPos); // array of "x,y,z" strings
  }

  // ── Klaim bed di civ state (SEBELUM pathfinding) ─────────────
  function claimBed(bedBlock) {
    const key = posKey(bedBlock.position);
    civ.updateBotStatus(bot.username, { bedPos: key, status: 'going_to_sleep' });
    console.log(`[${bot.username}] 🛏️ Klaim bed di ${key}`);
  }

  function releaseBed() {
    civ.updateBotStatus(bot.username, { bedPos: null });
    console.log(`[${bot.username}] 🛏️ Release bed`);
  }

  // ── Cari bed yang BELUM diklaim siapapun ─────────────────────
  function findFreeBed(searchRadius = 48) {
    const ids = BED_TYPES.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (!ids.length) return null;

    const claimed = getClaimedBeds(true); // semua klaim selain diri sendiri

    // Cari semua bed dalam radius, filter yang belum diklaim
    let best = null;
    let bestDist = Infinity;

    // bot.findBlock hanya return 1, jadi kita cari berulang dengan exclude
    // Cara: cari bed terdekat yang tidak ada di claimed list
    const checked = new Set();

    for (let attempt = 0; attempt < 20; attempt++) {
      const found = bot.findBlock({
        matching: ids,
        maxDistance: searchRadius,
        useExtraInfo: b => {
          const key = posKey(b.position);
          if (checked.has(key)) return false;
          if (claimed.includes(key)) return false;
          return true;
        },
      });

      if (!found) break;

      const key = posKey(found.position);
      checked.add(key);

      const dist = found.position.distanceTo(HOME_BASE);
      if (dist < bestDist) {
        bestDist = dist;
        best = found;
      }

      // Sudah cukup dekat dengan base, tidak perlu cari lebih jauh
      if (dist < 10) break;
    }

    return best;
  }

  // ── Kembali ke home base ──────────────────────────────────────
  async function returnHome() {
    if (isNearHome() || returningHome) return;
    const dist = distToHome();
    if (dist > HOME_RETURN_RADIUS) {
      console.log(`[${bot.username}] 🌙 Terlalu jauh (${dist.toFixed(0)} blok), skip pulang`);
      return;
    }
    returningHome = true;
    console.log(`[${bot.username}] 🏠 Pulang ke base (${dist.toFixed(0)} blok)...`);
    civ.addLog(`[${bot.username}] 🏠 Pulang sebelum malam`);
    civ.updateBotStatus(bot.username, { status: 'returning_home' });
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
    // Sudah punya bed?
    if (bot.inventory.items().find(i => BED_TYPES.includes(i.name))) return true;
    // Cek storage
    for (const color of WOOL_COLORS) {
      if (await getStorage().fetchFromStorage(`${color}_bed`, 1)) return true;
    }

    // Kumpulkan wool
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
        if (below && below.name !== 'air') {
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
    const attempts = [];
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) attempts.push(bedZone.offset(x, 0, z));
    attempts.sort((a, b) => a.distanceTo(bedZone) - b.distanceTo(bedZone));

    for (const target of attempts) {
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
            civ.addLog(`[${bot.username}] 🛏️ Pasang bed di base`);
            return placed;
          }
        } catch (_) {
          continue;
        }
      }
    }
    return null;
  }

  // ── TIDUR — FIX UTAMA ────────────────────────────────────────
  // 1. Klaim bed di civ state DULU sebelum pathfinding
  // 2. Jika "occupied" → release klaim, cari bed lain, retry
  // 3. Maksimal 5 kali retry dengan bed berbeda
  async function trySleep(maxRetries = 5) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const bed = findFreeBed();
      if (!bed) {
        console.log(`[${bot.username}] Tidak ada bed bebas (attempt ${attempt + 1})`);
        await waitMs(2000);
        continue;
      }

      // ① KLAIM lebih dulu — bot lain tidak akan pilih bed ini
      claimBed(bed);
      await waitMs(200); // beri waktu civ state ter-write

      try {
        // ② Pergi ke bed
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)
            ),
          12000
        );

        // ③ Verifikasi bed masih ada & masih free
        const freshBed = bot.blockAt(bed.position);
        if (!freshBed || !BED_TYPES.includes(freshBed.name)) {
          console.log(`[${bot.username}] Bed sudah hilang, cari lain...`);
          releaseBed();
          continue;
        }

        // ④ Coba tidur
        isSleeping = true;
        console.log(`[${bot.username}] 😴 Tidur di ${posKey(bed.position)}`);
        civ.addLog(`[${bot.username}] 😴 Tidur`);
        civ.updateBotStatus(bot.username, { bedPos: posKey(bed.position), status: 'sleeping' });

        await bot.sleep(freshBed);
        return true; // Berhasil!
      } catch (err) {
        isSleeping = false;
        releaseBed();

        const msg = err.message?.toLowerCase() || '';
        if (msg.includes('occupied') || msg.includes('too far') || msg.includes('obstructed')) {
          console.log(
            `[${bot.username}] Bed error (${err.message}), coba bed lain... (${attempt + 1}/${maxRetries})`
          );
          await waitMs(1000);
          continue; // Coba bed lain
        }

        // Error lain (bukan occupied) → stop
        console.log(`[${bot.username}] [sleeping] error: ${err.message}`);
        break;
      }
    }
    return false;
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
      // Pastikan di base
      if (!isNearHome()) {
        await returnHome();
        if (!isNearHome()) {
          active = false;
          return;
        }
      }

      // Cari bed bebas
      let bed = findFreeBed();

      if (!bed) {
        // Tidak ada bed → craft & pasang
        if (!bot.inventory.items().find(i => BED_TYPES.includes(i.name))) {
          if (!(await craftBed())) {
            active = false;
            return;
          }
        }
        bed = await placeBedNearHome();
        if (!bed) {
          active = false;
          return;
        }
      }

      // Tidur dengan retry logic
      await trySleep(5);
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
    console.log(`[${bot.username}] ☀️ Bangun, siap kerja!`);
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
