const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep } = require('../shared/utils');
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
  let checkTimer = null;

  function isNight() {
    // Waktu Minecraft: 0 = siang, 13000 = mulai malam, 23000 = akhir malam
    const time = bot.time?.timeOfDay ?? 0;
    return time >= 12500 && time <= 23500;
  }

  function isViable() {
    return isNight() && !isSleeping;
  }

  function findNearestBed() {
    const bedIds = BED_TYPES.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (bedIds.length === 0) return null;
    return bot.findBlock({ matching: bedIds, maxDistance: 32 });
  }

  async function tryPlaceBed() {
    // Cek apakah punya bed di inventory
    const bedInInv = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
    if (bedInInv) return await placeAndSleep(bedInInv);

    // Tidak punya bed — coba craft dari wool + planks
    console.log(`[${bot.username}] Tidak punya bed, coba craft...`);
    await tryCraftBed();
  }

  async function tryCraftBed() {
    const hasWool = bot.inventory.items().find(i => WOOL_TYPES.includes(i.name) && i.count >= 3);
    const hasPlank = bot.inventory.items().find(i => i.name.includes('_planks') && i.count >= 3);

    if (!hasWool || !hasPlank) {
      console.log(`[${bot.username}] Bahan bed tidak cukup (butuh 3 wool + 3 planks).`);
      return;
    }

    const tableId = mcData.blocksByName['crafting_table']?.id;
    const craftTable = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;

    if (!craftTable) {
      console.log(`[${bot.username}] Tidak ada crafting table untuk buat bed.`);
      return;
    }

    try {
      // Cari resep bed yang cocok dengan wool yang dimiliki
      const woolName = hasWool.name;
      const bedName = woolName.replace('_wool', '_bed');
      const bedItemId = mcData.itemsByName[bedName]?.id;
      if (!bedItemId) return;

      const recipes = await bot.recipesFor(bedItemId, null, 1, craftTable);
      if (recipes?.length > 0) {
        await bot.pathfinder.goto(
          new goals.GoalNear(craftTable.position.x, craftTable.position.y, craftTable.position.z, 2)
        );
        await bot.craft(recipes[0], 1, craftTable);
        console.log(`[${bot.username}] 🛏️ Berhasil craft ${bedName}`);
        civ.addLog(`[${bot.username}] 🛏️ Craft ${bedName}`);

        // Sekarang coba pakai bed yang baru di-craft
        const newBed = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
        if (newBed) await placeAndSleep(newBed);
      }
    } catch (err) {
      console.log(`[${bot.username}] Gagal craft bed: ${err.message}`);
    }
  }

  async function placeAndSleep(bedItem) {
    try {
      await bot.equip(bedItem, 'hand');

      // Cari tanah datar untuk taruh bed
      const pos = bot.entity.position.floored();
      const below = bot.blockAt(pos.offset(0, -1, 0));
      const inFront = bot.blockAt(pos.offset(1, 0, 0));
      const inFront2 = bot.blockAt(pos.offset(1, -1, 0));

      if (below && inFront?.name === 'air' && inFront2?.name !== 'air') {
        await bot.placeBlock(inFront2, new Vec3(0, 1, 0));
        await sleep(500);

        // Cari bed yang baru dipasang
        const placedBed = findNearestBed();
        if (placedBed) {
          await sleepOnBed(placedBed);
        }
      }
    } catch (err) {
      console.log(`[${bot.username}] Gagal pasang bed: ${err.message}`);
    }
  }

  async function sleepOnBed(bedBlock) {
    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2)
      );

      isSleeping = true;
      civ.updateBotStatus(bot.username, { status: 'sleeping' });
      civ.addLog(
        `[${bot.username}] 😴 Tidur di (${bedBlock.position.x},${bedBlock.position.y},${bedBlock.position.z})`
      );
      console.log(`[${bot.username}] 😴 Tidur...`);

      await bot.sleep(bedBlock);
    } catch (err) {
      isSleeping = false;
      console.log(`[${bot.username}] Gagal tidur: ${err.message}`);
    }
  }

  async function run() {
    if (active || isSleeping) return;
    if (!isNight()) return;
    active = true;

    try {
      // Cari bed terdekat
      const nearBed = findNearestBed();

      if (nearBed) {
        await sleepOnBed(nearBed);
      } else {
        // Tidak ada bed di sekitar — coba buat/taruh
        await tryPlaceBed();
      }
    } catch (err) {
      console.log(`[${bot.username}] [sleeping] ${err.message}`);
    }

    active = false;
  }

  // Dengarkan event wake up
  function onWake() {
    isSleeping = false;
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
      if (isSleeping) {
        bot.wake().catch(() => {});
        isSleeping = false;
      }
    },
  };
};
