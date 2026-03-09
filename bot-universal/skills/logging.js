const { goals } = require('mineflayer-pathfinder');
const { sleep } = require('../shared/utils');

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

  async function run() {
    if (active) return;
    active = true;

    const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    const logBlock = bot.findBlock({ matching: logIds, maxDistance: 32 });

    if (!logBlock) {
      bot.chat('Tidak ada pohon di sekitar.');
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
    try {
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

      let currentPos = pos.clone();
      let count = 0;
      while (count < 15) {
        const current = bot.blockAt(currentPos);
        if (!current || !WOOD_TYPES.includes(current.name)) break;
        await bot.dig(current);
        bot.chat(`🪓 Tebang log ke-${count + 1}`);
        await sleep(300);
        currentPos = currentPos.offset(0, 1, 0);
        count++;
      }
      bot.chat(`✅ Selesai tebang ${count} log.`);
      await sleep(800);
    } catch (err) {
      bot.chat(`Error logging: ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'logging',
    start() {
      bot.chat('🪓 Mulai menebang pohon!');
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      bot.chat('🛑 Stop logging.');
    },
  };
};
