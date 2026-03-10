const { goals } = require('mineflayer-pathfinder');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
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

// FIX BUG 2: Urutan pickaxe dari terbaik ke terburuk
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

      // FIX BUG 2: Selalu equip pickaxe terbaik yang ada
      const equipped = await equipBest(bot, PICKAXES, 'hand');
      if (!equipped) {
        console.log(`[${bot.username}] Tidak punya pickaxe!`);
        active = false;
        return;
      }

      const pos = target.position;
      await withUnstuck(bot, () => bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)));

      const block = bot.blockAt(pos);
      if (!block || block.name === 'air') {
        active = false;
        return;
      }

      await bot.dig(block);
      await waitMs(300);
      civ.addResources({ [meta.resource]: 1 });
      civ.addLog(`[${bot.username}] ⛏️ Tambang ${meta.name}`);
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
