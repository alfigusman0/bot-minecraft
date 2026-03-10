const { goals } = require('mineflayer-pathfinder');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');

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

// Blok yang menandakan area bangunan — jangan tebang pohon di dekat ini
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

  function isNearStructure(pos) {
    // Cek villager dalam radius 8
    const nearVillager = Object.values(bot.entities).some(e => {
      if (!e?.name) return false;
      return (
        ['villager', 'wandering_trader'].includes(e.name.toLowerCase()) &&
        pos.distanceTo(e.position) < 8
      );
    });
    if (nearVillager) return true;

    // Cek blok bangunan dalam radius 5
    const structIds = STRUCTURE_BLOCKS.map(b => mcData.blocksByName[b]?.id).filter(Boolean);
    if (!structIds.length) return false;
    return !!bot.findBlock({
      matching: structIds,
      maxDistance: 5,
      useExtraInfo: b => b.position.distanceTo(pos) <= 5,
    });
  }

  function isViable() {
    const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    return !!bot.findBlock({
      matching: logIds,
      maxDistance: 32,
      useExtraInfo: b => !isNearStructure(b.position),
    });
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
      const logBlock = bot.findBlock({
        matching: logIds,
        maxDistance: 32,
        useExtraInfo: b => !isNearStructure(b.position),
      });

      if (!logBlock) {
        active = false;
        return;
      }

      // FIX BUG 2: Equip axe terbaik
      await equipBest(bot, AXES, 'hand');

      const pos = logBlock.position;
      if (isNearStructure(pos)) {
        active = false;
        return;
      }

      await withUnstuck(bot, () => bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)));

      let currentPos = pos.clone();
      let count = 0;
      while (count < 15) {
        const current = bot.blockAt(currentPos);
        if (!current || !WOOD_TYPES.includes(current.name)) break;
        if (isNearStructure(currentPos)) break;
        await bot.dig(current);
        await waitMs(300);
        currentPos = currentPos.offset(0, 1, 0);
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
