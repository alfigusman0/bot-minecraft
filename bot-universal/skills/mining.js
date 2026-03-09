const { goals } = require('mineflayer-pathfinder');
const { sleep } = require('../shared/utils');

const ORE_PRIORITY = [
  'ancient_debris',
  'diamond_ore',
  'deepslate_diamond_ore',
  'gold_ore',
  'deepslate_gold_ore',
  'iron_ore',
  'deepslate_iron_ore',
  'coal_ore',
  'deepslate_coal_ore',
  'stone',
];

const PICKAXES = [
  'netherite_pickaxe',
  'diamond_pickaxe',
  'iron_pickaxe',
  'stone_pickaxe',
  'wooden_pickaxe',
];

module.exports = function miningSkill(bot, mcData) {
  let active = false;
  let interval = null;

  async function run() {
    if (active) return;
    active = true;

    let targetBlock = null;
    let targetName = '';

    for (const oreName of ORE_PRIORITY) {
      const oreId = mcData.blocksByName[oreName]?.id;
      if (!oreId) continue;
      const found = bot.findBlock({ matching: oreId, maxDistance: 32 });
      if (found) {
        targetBlock = found;
        targetName = oreName;
        break;
      }
    }

    if (!targetBlock) {
      bot.chat('Tidak ada ore ditemukan di sekitar.');
      active = false;
      return;
    }

    // Equip pickaxe terbaik
    for (const pick of PICKAXES) {
      const tool = bot.inventory.items().find(i => i.name === pick);
      if (tool) {
        await bot.equip(tool, 'hand');
        break;
      }
    }

    const pos = targetBlock.position;
    try {
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
      const block = bot.blockAt(pos);
      if (!block || block.name === 'air') {
        active = false;
        return;
      }
      await bot.dig(block);
      bot.chat(`⛏️ Tambang ${targetName} di (${pos.x}, ${pos.y}, ${pos.z})`);
      await sleep(300);
    } catch (err) {
      bot.chat(`Error mining: ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'mining',
    start() {
      bot.chat('⛏️ Mulai mining!');
      interval = setInterval(run, 2500);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      bot.chat('🛑 Stop mining.');
    },
  };
};
