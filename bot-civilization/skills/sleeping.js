const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep: waitMs } = require('../shared/utils'); // ← fungsi sleep(ms)
const civ = require('../core/civilization');

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

const WOOL_TYPES = [
  'white_wool',
  'orange_wool',
  'brown_wool',
  'gray_wool',
  'light_gray_wool',
  'black_wool',
];

module.exports = function sleepingSkill(bot, mcData) {
  let active = false;
  let isSleeping = false;
  let myBedPos = null; // Posisi bed milik bot ini
  let checkTimer = null;

  function isNight() {
    const time = bot.time?.timeOfDay ?? 0;
    return time >= 12500 && time <= 23500;
  }

  function isViable() {
    // Jangan masuk jika sudah tidur
    if (isSleeping) return false;
    return isNight();
  }

  // Cari bed yang TIDAK sedang dipakai bot lain
  function findFreeBed() {
    const bedIds = BED_TYPES.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (!bedIds.length) return null;

    // Ambil posisi bed yang sedang dipakai bot lain dari civ state
    const state = civ.getState();
    const usedBeds = Object.entries(state.bots)
      .filter(([name, info]) => name !== bot.username && info.bedPos)
      .map(([, info]) => info.bedPos);

    // Cari bed yang tidak ada di usedBeds
    return bot.findBlock({
      matching: bedIds,
      maxDistance: 32,
      useExtraInfo: b => {
        const posKey = `${b.position.x},${b.position.y},${b.position.z}`;
        return !usedBeds.includes(posKey);
      },
    });
  }

  async function goSleep(bedBlock) {
    try {
      // Claim bed ini dulu di state agar bot lain tidak pakai
      const posKey = `${bedBlock.position.x},${bedBlock.position.y},${bedBlock.position.z}`;
      myBedPos = posKey;
      civ.updateBotStatus(bot.username, { bedPos: posKey, status: 'sleeping' });

      await bot.pathfinder.goto(
        new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2)
      );

      // Cek sekali lagi bed masih ada
      const freshBed = bot.blockAt(bedBlock.position);
      if (!freshBed || !BED_TYPES.includes(freshBed.name)) {
        releaseBed();
        return;
      }

      isSleeping = true;
      console.log(
        `[${bot.username}] 😴 Tidur di (${bedBlock.position.x},${bedBlock.position.y},${bedBlock.position.z})`
      );
      civ.addLog(`[${bot.username}] 😴 Tidur`);

      await bot.sleep(bedBlock); // ← bot.sleep(), bukan sleep() dari utils
    } catch (err) {
      console.log(`[${bot.username}] [sleeping] Gagal tidur: ${err.message}`);
      isSleeping = false;
      releaseBed();
    }
  }

  function releaseBed() {
    myBedPos = null;
    civ.updateBotStatus(bot.username, { bedPos: null });
  }

  async function placeBedAndSleep() {
    // Cek punya bed di inventory
    const bedInInv = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
    if (bedInInv) {
      await placeBed(bedInInv);
      return;
    }

    // Coba craft bed
    const hasWool = bot.inventory.items().find(i => WOOL_TYPES.includes(i.name) && i.count >= 3);
    const hasPlank = bot.inventory.items().find(i => i.name.includes('_planks') && i.count >= 3);
    if (!hasWool || !hasPlank) {
      console.log(`[${bot.username}] Tidak punya bed & bahan tidak cukup untuk craft`);
      return;
    }

    const tableId = mcData.blocksByName['crafting_table']?.id;
    const table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;
    if (!table) {
      console.log(`[${bot.username}] Tidak ada crafting table untuk craft bed`);
      return;
    }

    try {
      const bedName = hasWool.name.replace('_wool', '_bed');
      const bedItemId = mcData.itemsByName[bedName]?.id;
      if (!bedItemId) return;

      const recipes = await bot.recipesFor(bedItemId, null, 1, table);
      if (!recipes?.length) return;

      await bot.pathfinder.goto(
        new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
      );
      await bot.craft(recipes[0], 1, table);
      console.log(`[${bot.username}] 🛏️ Craft ${bedName} berhasil`);
      await waitMs(500);

      const newBed = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
      if (newBed) await placeBed(newBed);
    } catch (err) {
      console.log(`[${bot.username}] Gagal craft bed: ${err.message}`);
    }
  }

  async function placeBed(bedItem) {
    try {
      await bot.equip(bedItem, 'hand');

      // Cari tanah kosong di dekat bot untuk taruh bed
      const pos = bot.entity.position.floored();
      const candidates = [
        pos.offset(1, 0, 0),
        pos.offset(-1, 0, 0),
        pos.offset(0, 0, 1),
        pos.offset(0, 0, -1),
      ];

      for (const candidate of candidates) {
        const blockAt = bot.blockAt(candidate);
        const blockBelow = bot.blockAt(candidate.offset(0, -1, 0));
        const blockAbove = bot.blockAt(candidate.offset(0, 1, 0));

        if (
          blockAt?.name === 'air' &&
          blockAbove?.name === 'air' &&
          blockBelow &&
          blockBelow.name !== 'air'
        ) {
          try {
            await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
            await waitMs(600);

            const placed = findFreeBed();
            if (placed) {
              await goSleep(placed);
              return;
            }
          } catch (_) {
            continue;
          }
        }
      }
    } catch (err) {
      console.log(`[${bot.username}] Gagal pasang bed: ${err.message}`);
    }
  }

  async function run() {
    // Jangan jalankan jika sudah tidur atau sedang proses
    if (active || isSleeping) return;
    if (!isNight()) return;

    active = true;
    try {
      const freeBed = findFreeBed();
      if (freeBed) {
        await goSleep(freeBed);
      } else {
        await placeBedAndSleep();
      }
    } catch (err) {
      console.log(`[${bot.username}] [sleeping] ${err.message}`);
    }
    active = false;
  }

  // Event: bot berhasil bangun
  function onWake() {
    isSleeping = false;
    releaseBed();
    console.log(`[${bot.username}] ☀️ Bangun!`);
    civ.updateBotStatus(bot.username, { status: 'working' });
    civ.addLog(`[${bot.username}] ☀️ Bangun, lanjut kerja`);
  }

  return {
    name: 'sleeping',
    label: '😴 Sleeping',
    isViable,
    start() {
      bot.on('wake', onWake);
      checkTimer = setInterval(run, 5000);
    },
    stop() {
      if (checkTimer) clearInterval(checkTimer);
      checkTimer = null;
      active = false;
      bot.removeListener('wake', onWake);
      // Bangunkan paksa jika masih tidur
      if (isSleeping) {
        bot.wake().catch(() => {});
        isSleeping = false;
        releaseBed();
      }
    },
  };
};
