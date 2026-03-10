const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem } = require('../shared/utils');
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

module.exports = function sleepingSkill(bot, mcData) {
  let active = false;
  let isSleeping = false;
  let myBedPos = null;
  let checkTimer = null;

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────
  function isNight() {
    const time = bot.time?.timeOfDay ?? 0;
    return time >= 12500 && time <= 23500;
  }

  function isViable() {
    return isNight() && !isSleeping;
  }

  function findFreeBed() {
    const bedIds = BED_TYPES.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (!bedIds.length) return null;

    const state = civ.getState();
    const usedBeds = Object.entries(state.bots)
      .filter(([name, info]) => name !== bot.username && info.bedPos)
      .map(([, info]) => info.bedPos);

    return bot.findBlock({
      matching: bedIds,
      maxDistance: 32,
      useExtraInfo: b => {
        const key = `${b.position.x},${b.position.y},${b.position.z}`;
        return !usedBeds.includes(key);
      },
    });
  }

  function claimBed(pos) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    myBedPos = key;
    civ.updateBotStatus(bot.username, { bedPos: key, status: 'sleeping' });
  }

  function releaseBed() {
    myBedPos = null;
    civ.updateBotStatus(bot.username, { bedPos: null });
  }

  // ────────────────────────────────────────────
  // FIX BUG 3: Cari bahan → craft → pasang → tidur
  // Bot TIDAK menyerah sampai berhasil tidur
  // ────────────────────────────────────────────

  // Step 1: Cari wool di sekitar (dari domba)
  async function shearOrKillSheep() {
    const sheep = Object.values(bot.entities).find(
      e => e?.name?.toLowerCase() === 'sheep' && bot.entity.position.distanceTo(e.position) < 32
    );
    if (!sheep) return false;

    console.log(`[${bot.username}] 🐑 Cari wool dari domba...`);

    // Coba gunakan shears jika punya
    const shears = bot.inventory.items().find(i => i.name === 'shears');
    if (shears) {
      await bot.equip(shears, 'hand');
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2)
        )
      );
      await bot.activateEntity(sheep).catch(() => {});
      await waitMs(500);
      return true;
    }

    // Tidak punya shears → bunuh untuk dapat wool
    await equipBest(
      bot,
      ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'],
      'hand'
    );
    await withUnstuck(bot, () =>
      bot.pathfinder.goto(
        new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2)
      )
    );
    let attempts = 0;
    while (sheep.isValid && attempts < 10) {
      bot.attack(sheep);
      await waitMs(700);
      attempts++;
    }
    await waitMs(800);
    return true;
  }

  // Step 2: Craft planks dari log jika tidak punya planks
  async function ensurePlanks() {
    if (hasItem(bot, 'oak_planks', 3)) return true;

    const logs = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
    for (const logName of logs) {
      const log = bot.inventory.items().find(i => i.name === logName);
      if (!log) continue;

      const plankName = logName.replace('_log', '_planks');
      const plankId = mcData.itemsByName[plankName]?.id;
      if (!plankId) continue;

      try {
        const recipes = await bot.recipesFor(plankId, null, 1, null);
        if (recipes?.length) {
          await bot.craft(recipes[0], 4, null); // craft 4 planks
          console.log(`[${bot.username}] 🪵 Craft ${plankName}`);
          await waitMs(300);
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  // Step 3: Craft bed
  async function craftBed() {
    // Cek sudah punya bed
    if (bot.inventory.items().find(i => BED_TYPES.includes(i.name))) return true;

    // Cek bahan: 3 wool + 3 planks
    const wool = WOOL_COLORS.map(c => `${c}_wool`)
      .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
      .find(Boolean);

    if (!wool) {
      // Tidak punya wool → cari dari domba
      const got = await shearOrKillSheep();
      if (!got) {
        console.log(`[${bot.username}] Tidak ada domba untuk dapat wool`);
        return false;
      }
      // Coba lagi setelah dapat wool
      return await craftBed();
    }

    // Pastikan punya planks
    const hasPlanks = await ensurePlanks();
    if (!hasPlanks) {
      console.log(`[${bot.username}] Tidak ada kayu untuk craft planks`);
      return false;
    }

    // Cari crafting table
    const tableId = mcData.blocksByName['crafting_table']?.id;
    const table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;

    // Kalau tidak ada crafting table, buat dulu
    if (!table) {
      const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
      if (tableItem) {
        await bot.equip(tableItem, 'hand');
        const pos = bot.entity.position.floored();
        const below = bot.blockAt(pos.offset(1, -1, 0));
        if (below && below.name !== 'air') {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(500);
        }
      }
    }

    const freshTable = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;

    // Craft bed
    const bedName = wool.name.replace('_wool', '_bed');
    const bedId = mcData.itemsByName[bedName]?.id;
    if (!bedId) return false;

    try {
      const recipes = await bot.recipesFor(bedId, null, 1, freshTable);
      if (!recipes?.length) return false;

      if (freshTable) {
        await withUnstuck(bot, () =>
          bot.pathfinder.goto(
            new goals.GoalNear(
              freshTable.position.x,
              freshTable.position.y,
              freshTable.position.z,
              2
            )
          )
        );
      }

      await bot.craft(recipes[0], 1, freshTable);
      console.log(`[${bot.username}] 🛏️ Craft ${bedName} berhasil!`);
      civ.addLog(`[${bot.username}] 🛏️ Craft ${bedName}`);
      await waitMs(400);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] Gagal craft bed: ${err.message}`);
      return false;
    }
  }

  // Step 4: Pasang bed di tanah
  async function placeBed() {
    const bedItem = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
    if (!bedItem) return null;

    await bot.equip(bedItem, 'hand');

    const pos = bot.entity.position.floored();
    const candidates = [
      pos.offset(1, 0, 0),
      pos.offset(-1, 0, 0),
      pos.offset(0, 0, 1),
      pos.offset(0, 0, -1),
      pos.offset(2, 0, 0),
      pos.offset(0, 0, 2),
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
          return findFreeBed();
        } catch (_) {
          continue;
        }
      }
    }
    return null;
  }

  // Step 5: Tidur di bed
  async function sleepOnBed(bedBlock) {
    try {
      claimBed(bedBlock.position);

      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2)
        )
      );

      const freshBed = bot.blockAt(bedBlock.position);
      if (!freshBed || !BED_TYPES.includes(freshBed.name)) {
        releaseBed();
        return false;
      }

      isSleeping = true;
      console.log(`[${bot.username}] 😴 Tidur...`);
      civ.addLog(`[${bot.username}] 😴 Tidur`);

      await bot.sleep(bedBlock); // bot.sleep() dari Mineflayer, bukan waitMs
      return true;
    } catch (err) {
      console.log(`[${bot.username}] [sleeping] ${err.message}`);
      isSleeping = false;
      releaseBed();
      return false;
    }
  }

  // ────────────────────────────────────────────
  // MAIN RUN — urutan wajib: cari bed → kalau
  // tidak ada → craft → pasang → tidur
  // ────────────────────────────────────────────
  async function run() {
    if (active || isSleeping || !isNight()) return;
    active = true;

    try {
      // 1. Cari bed bebas di sekitar
      let bed = findFreeBed();

      if (!bed) {
        // 2. Cek punya bed di inventory
        const hasBed = bot.inventory.items().find(i => BED_TYPES.includes(i.name));

        if (!hasBed) {
          // 3. Tidak punya → craft dulu (cari wool + planks → craft)
          console.log(`[${bot.username}] Tidak punya bed, coba craft...`);
          const crafted = await craftBed();
          if (!crafted) {
            console.log(`[${bot.username}] Gagal craft bed, coba lagi nanti`);
            active = false;
            return;
          }
        }

        // 4. Pasang bed di tanah
        bed = await placeBed();
        if (!bed) {
          console.log(`[${bot.username}] Gagal pasang bed`);
          active = false;
          return;
        }
      }

      // 5. Tidur
      await sleepOnBed(bed);
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
        releaseBed();
      }
    },
  };
};
