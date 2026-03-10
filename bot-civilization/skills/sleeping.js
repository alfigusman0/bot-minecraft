const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck, hasItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');

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
  let active = false,
    isSleeping = false,
    myBedPos = null,
    checkTimer = null;
  let storage = null;

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }
  function isNight() {
    const t = bot.time?.timeOfDay ?? 0;
    return t >= 12500 && t <= 23500;
  }
  function isViable() {
    return isNight() && !isSleeping;
  }

  function findFreeBed() {
    const ids = BED_TYPES.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (!ids.length) return null;
    const state = civ.getState();
    const used = Object.entries(state.bots)
      .filter(([n, i]) => n !== bot.username && i.bedPos)
      .map(([, i]) => i.bedPos);
    return bot.findBlock({
      matching: ids,
      maxDistance: 32,
      useExtraInfo: b => !used.includes(`${b.position.x},${b.position.y},${b.position.z}`),
    });
  }

  function claimBed(pos) {
    myBedPos = `${pos.x},${pos.y},${pos.z}`;
    civ.updateBotStatus(bot.username, { bedPos: myBedPos, status: 'sleeping' });
  }
  function releaseBed() {
    myBedPos = null;
    civ.updateBotStatus(bot.username, { bedPos: null });
  }

  async function sleepOnBed(bedBlock) {
    try {
      claimBed(bedBlock.position);
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2)
        )
      );
      const fresh = bot.blockAt(bedBlock.position);
      if (!fresh || !BED_TYPES.includes(fresh.name)) {
        releaseBed();
        return false;
      }
      isSleeping = true;
      civ.addLog(`[${bot.username}] 😴 Tidur`);
      await bot.sleep(bedBlock);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] [sleeping] ${err.message}`);
      isSleeping = false;
      releaseBed();
      return false;
    }
  }

  async function shearOrKillSheep() {
    const sheep = Object.values(bot.entities).find(
      e => e?.name?.toLowerCase() === 'sheep' && bot.entity.position.distanceTo(e.position) < 32
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
      await equipBest(bot, ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'], 'hand');
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

  async function ensurePlanks() {
    if (hasItem(bot, 'oak_planks', 3)) return true;
    for (const log of ['oak_log', 'birch_log', 'spruce_log', 'acacia_log', 'dark_oak_log']) {
      if (!hasItem(bot, log)) continue;
      const id = mcData.itemsByName[log.replace('_log', '_planks')]?.id;
      if (!id) continue;
      const r = await bot.recipesFor(id, null, 1, null);
      if (r?.length) {
        await bot.craft(r[0], 4, null);
        await waitMs(300);
        return true;
      }
    }
    // Coba ambil dari storage
    return await getStorage().fetchFromStorage('oak_planks', 8);
  }

  async function craftBed() {
    if (bot.inventory.items().find(i => BED_TYPES.includes(i.name))) return true;

    // Cek storage dulu
    for (const color of WOOL_COLORS) {
      if (await getStorage().fetchFromStorage(`${color}_bed`, 1)) return true;
    }

    const wool = WOOL_COLORS.map(c => `${c}_wool`)
      .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
      .find(Boolean);

    if (!wool) {
      // Cari wool dari storage
      for (const c of WOOL_COLORS) {
        if (await getStorage().fetchFromStorage(`${c}_wool`, 3)) break;
      }
      const woolNow = WOOL_COLORS.map(c => `${c}_wool`)
        .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
        .find(Boolean);
      if (!woolNow) {
        const got = await shearOrKillSheep();
        if (!got) return false;
        return await craftBed();
      }
    }

    if (!(await ensurePlanks())) return false;

    const tableId = mcData.blocksByName['crafting_table']?.id;
    let table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;
    if (!table) {
      const t = bot.inventory.items().find(i => i.name === 'crafting_table');
      if (t) {
        await bot.equip(t, 'hand');
        const p = bot.entity.position.floored();
        const below = bot.blockAt(p.offset(1, -1, 0));
        if (below && below.name !== 'air') {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(500);
        }
        table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;
      }
    }

    const woolItem = WOOL_COLORS.map(c => `${c}_wool`)
      .map(w => bot.inventory.items().find(i => i.name === w && i.count >= 3))
      .find(Boolean);
    if (!woolItem) return false;
    const bedName = woolItem.name.replace('_wool', '_bed');
    const bedId = mcData.itemsByName[bedName]?.id;
    if (!bedId) return false;
    try {
      const recipes = await bot.recipesFor(bedId, null, 1, table);
      if (!recipes?.length) return false;
      if (table)
        await withUnstuck(bot, () =>
          bot.pathfinder.goto(
            new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
          )
        );
      await bot.craft(recipes[0], 1, table);
      civ.addLog(`[${bot.username}] 🛏️ Craft ${bedName}`);
      await waitMs(400);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] Gagal craft bed: ${err.message}`);
      return false;
    }
  }

  async function placeBed() {
    const bedItem = bot.inventory.items().find(i => BED_TYPES.includes(i.name));
    if (!bedItem) return null;
    await bot.equip(bedItem, 'hand');
    const pos = bot.entity.position.floored();
    const offsets = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(2, 0, 0),
      new Vec3(0, 0, 2),
    ];
    for (const off of offsets) {
      const t = pos.plus(off);
      const at = bot.blockAt(t),
        below = bot.blockAt(t.offset(0, -1, 0)),
        above = bot.blockAt(t.offset(0, 1, 0));
      if (at?.name === 'air' && above?.name === 'air' && below && below.name !== 'air') {
        try {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(600);
          return findFreeBed();
        } catch (_) {}
      }
    }
    return null;
  }

  async function run() {
    if (active || isSleeping || !isNight()) return;
    active = true;
    try {
      let bed = findFreeBed();
      if (!bed) {
        if (!bot.inventory.items().find(i => BED_TYPES.includes(i.name))) {
          const crafted = await craftBed();
          if (!crafted) {
            active = false;
            return;
          }
        }
        bed = await placeBed();
        if (!bed) {
          active = false;
          return;
        }
      }
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
    civ.addLog(`[${bot.username}] ☀️ Bangun`);
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
