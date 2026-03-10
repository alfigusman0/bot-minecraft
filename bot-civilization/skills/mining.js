const { goals } = require('mineflayer-pathfinder');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');

const ORE_PRIORITY = [
  { name: 'ancient_debris', resource: 'ancient_debris' },
  { name: 'diamond_ore', resource: 'diamond' },
  { name: 'deepslate_diamond_ore', resource: 'diamond' },
  { name: 'gold_ore', resource: 'gold' },
  { name: 'deepslate_gold_ore', resource: 'gold' },
  { name: 'iron_ore', resource: 'iron' },
  { name: 'deepslate_iron_ore', resource: 'iron' },
  { name: 'coal_ore', resource: 'coal' },
  { name: 'deepslate_coal_ore', resource: 'coal' },
  { name: 'cobblestone', resource: 'cobblestone' },
  { name: 'stone', resource: 'stone' },
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
  let storage = null;

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  function isViable() {
    return true;
  }

  async function ensurePickaxe() {
    const has = PICKAXES.some(p => bot.inventory.items().find(i => i.name === p));
    if (has) return true;
    // Cek storage
    for (const pick of PICKAXES) {
      if (await getStorage().fetchFromStorage(pick, 1)) return true;
    }
    return false;
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      await getStorage().checkAndDeposit();

      if (!(await ensurePickaxe())) {
        console.log(`[${bot.username}] Tidak ada pickaxe`);
        active = false;
        return;
      }

      let target = null,
        meta = null;
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

      await equipBest(bot, PICKAXES, 'hand');
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)
        )
      );

      const block = bot.blockAt(target.position);
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
