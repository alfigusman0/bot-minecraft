const { goals } = require('mineflayer-pathfinder');
const { sleep } = require('../shared/utils');
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
const AXES = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];

module.exports = function loggingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function isViable() {
    const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    return !!bot.findBlock({ matching: logIds, maxDistance: 32 });
  }

  async function run() {
    if (active) return;
    active = true;

    try {
      const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
      const logBlock = bot.findBlock({ matching: logIds, maxDistance: 32 });
      if (!logBlock) {
        active = false;
        return;
      }

      // Equip axe terbaik
      for (const axe of AXES) {
        const tool = bot.inventory.items().find(i => i.name === axe);
        if (tool) {
          await bot.equip(tool, 'hand');
          break;
        }
      }

      const pos = logBlock.position;
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

      let currentPos = pos.clone();
      let count = 0;

      while (count < 15) {
        const current = bot.blockAt(currentPos);
        if (!current || !WOOD_TYPES.includes(current.name)) break;
        await bot.dig(current);
        await sleep(300);
        currentPos = currentPos.offset(0, 1, 0);
        count++;
      }

      await sleep(800);
      civ.addResources({ wood: count });
      civ.addLog(`[${bot.username}] 🪓 Tebang ${count} log di (${pos.x},${pos.y},${pos.z})`);
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
