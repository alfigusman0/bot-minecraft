const { waitMs, withUnstuck } = require('../shared/utils');
const { goals } = require('mineflayer-pathfinder');
const civ = require('../core/civilization');

const RECIPES = [
  { name: 'oak_planks', needs: { oak_log: 1 }, priority: 1 },
  { name: 'stick', needs: { oak_planks: 2 }, priority: 2 },
  { name: 'crafting_table', needs: { oak_planks: 4 }, priority: 2 },
  { name: 'wooden_pickaxe', needs: { oak_planks: 3, stick: 2 }, priority: 3 },
  { name: 'wooden_sword', needs: { oak_planks: 2, stick: 1 }, priority: 3 },
  { name: 'wooden_axe', needs: { oak_planks: 3, stick: 2 }, priority: 3 },
  { name: 'bread', needs: { wheat: 3 }, priority: 2 },
  { name: 'torch', needs: { coal: 1, stick: 1 }, priority: 4 },
];

module.exports = function craftingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function hasItems(needs) {
    return Object.entries(needs).every(([item, count]) => {
      const found = bot.inventory.items().find(i => i.name === item);
      return found && found.count >= count;
    });
  }

  function isViable() {
    return RECIPES.some(r => hasItems(r.needs));
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      const sorted = [...RECIPES].sort((a, b) => a.priority - b.priority);

      for (const recipe of sorted) {
        if (!hasItems(recipe.needs)) continue;

        const alreadyHas = bot.inventory.items().find(i => i.name === recipe.name);
        if (alreadyHas && alreadyHas.count >= 8) continue;

        const tableId = mcData.blocksByName['crafting_table']?.id;
        const table = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;

        try {
          const itemId = mcData.itemsByName[recipe.name]?.id;
          if (!itemId) continue;

          const recipes = await bot.recipesFor(itemId, null, 1, table);
          if (!recipes?.length) continue;

          if (table) {
            await withUnstuck(bot, () =>
              bot.pathfinder.goto(
                new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
              )
            );
          }

          await bot.craft(recipes[0], 1, table);
          civ.addLog(`[${bot.username}] 🔨 Craft ${recipe.name}`);
          await waitMs(400);
          break;
        } catch (_) {
          continue;
        }
      }
    } catch (err) {
      console.log(`[${bot.username}] [crafting] ${err.message}`);
    }
    active = false;
  }

  return {
    name: 'crafting',
    label: '🔨 Crafting',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] 🔨 Mulai crafting`);
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
