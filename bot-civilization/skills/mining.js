const { goals } = require('mineflayer-pathfinder');
const { sleep: waitMs } = require('../shared/utils');
const civ = require('../core/civilization');

const ORE_PRIORITY = [
  { name: 'ancient_debris', resource: 'ancient_debris', value: 10 },
  { name: 'diamond_ore', resource: 'diamond', value: 8 },
  { name: 'deepslate_diamond_ore', resource: 'diamond', value: 8 },
  { name: 'gold_ore', resource: 'gold', value: 5 },
  { name: 'deepslate_gold_ore', resource: 'gold', value: 5 },
  { name: 'iron_ore', resource: 'iron', value: 3 },
  { name: 'deepslate_iron_ore', resource: 'iron', value: 3 },
  { name: 'coal_ore', resource: 'coal', value: 2 },
  { name: 'deepslate_coal_ore', resource: 'coal', value: 2 },
  { name: 'cobblestone', resource: 'cobblestone', value: 1 },
  { name: 'stone', resource: 'stone', value: 1 },
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

  function isViable() {
    // Selalu bisa mining selama ada blok
    return true;
  }

  async function run() {
    if (active) return;
    active = true;

    try {
      let target = null;
      let meta = null;

      for (const ore of ORE_PRIORITY) {
        const id = mcData.blocksByName[ore.name]?.id;
        if (!id) continue;
        const found = bot.findBlock({ matching: id, maxDistance: 32 });
        if (found) {
          target = found;
          meta = ore;
          break;
        }
      }

      if (!target) {
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

      const pos = target.position;
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

      const block = bot.blockAt(pos);
      if (!block || block.name === 'air') {
        active = false;
        return;
      }

      await bot.dig(block);
      await waitMs(300);

      // Update resource peradaban
      civ.addResources({ [meta.resource]: 1, stone: meta.name === 'stone' ? 1 : 0 });
      civ.addLog(`[${bot.username}] ⛏️ Tambang ${meta.name} di (${pos.x},${pos.y},${pos.z})`);
    } catch (err) {
      console.log(`[${bot.username}] [mining] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'mining',
    label: '⛏️ Mining',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] ⛏️ Mulai mining`);
      interval = setInterval(run, 2500);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
