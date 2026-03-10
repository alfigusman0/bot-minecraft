const { goals } = require('mineflayer-pathfinder');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');

const WOOD_TYPES = [
  'oak_log',
  'birch_log',
  'spruce_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'cherry_log',
];
const STRUCTURE_BLOCKS = [
  'oak_door',
  'birch_door',
  'spruce_door',
  'iron_door',
  'glass',
  'glass_pane',
  'bookshelf',
  'crafting_table',
  'furnace',
  'chest',
  'torch',
  'lantern',
  'bed',
  'cobblestone_wall',
  'stone_bricks',
  'mossy_cobblestone',
];
const AXES = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];

module.exports = function loggingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  function isNearStructure(pos) {
    const nearVillager = Object.values(bot.entities).some(e => {
      if (!e?.name) return false;
      return (
        ['villager', 'wandering_trader'].includes(e.name.toLowerCase()) &&
        pos.distanceTo(e.position) < 8
      );
    });
    if (nearVillager) return true;
    const ids = STRUCTURE_BLOCKS.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    return (
      ids.length > 0 &&
      !!bot.findBlock({
        matching: ids,
        maxDistance: 5,
        useExtraInfo: b => b.position.distanceTo(pos) <= 5,
      })
    );
  }

  function isViable() {
    const ids = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    return !!bot.findBlock({
      matching: ids,
      maxDistance: 32,
      useExtraInfo: b => !isNearStructure(b.position),
    });
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      await getStorage().checkAndDeposit();

      const ids = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
      const target = bot.findBlock({
        matching: ids,
        maxDistance: 32,
        useExtraInfo: b => !isNearStructure(b.position),
      });
      if (!target) {
        active = false;
        return;
      }

      await equipBest(bot, AXES, 'hand');
      if (isNearStructure(target.position)) {
        active = false;
        return;
      }

      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)
        )
      );

      let cur = target.position.clone(),
        count = 0;
      while (count < 15) {
        const b = bot.blockAt(cur);
        if (!b || !WOOD_TYPES.includes(b.name) || isNearStructure(cur)) break;
        await bot.dig(b);
        await waitMs(300);
        cur = cur.offset(0, 1, 0);
        count++;
      }

      if (count > 0) {
        await waitMs(800);
        civ.addResources({ wood: count });
        civ.addLog(`[${bot.username}] 🪓 Tebang ${count} log`);
      }
    } catch (err) {
      console.log(`[${bot.username}] [logging] ${err.message}`);
    }
    active = false;
  }

  return {
    name: 'logging',
    label: '🪓 Logging',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] 🪓 Mulai logging`);
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
