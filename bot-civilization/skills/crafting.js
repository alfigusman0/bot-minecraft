const { sleep } = require('../shared/utils');
const civ = require('../core/civilization');

// Daftar resep prioritas
const RECIPES = [
  {
    name: 'crafting_table',
    needs: { oak_planks: 4 },
    result: 'crafting_table',
    priority: 1,
  },
  {
    name: 'wooden_pickaxe',
    needs: { oak_planks: 3, stick: 2 },
    result: 'wooden_pickaxe',
    priority: 2,
  },
  {
    name: 'stick',
    needs: { oak_planks: 2 },
    result: 'stick',
    priority: 2,
  },
  {
    name: 'oak_planks',
    needs: { oak_log: 1 },
    result: 'oak_planks',
    priority: 1,
  },
  {
    name: 'wooden_sword',
    needs: { oak_planks: 2, stick: 1 },
    result: 'wooden_sword',
    priority: 3,
  },
  {
    name: 'bread',
    needs: { wheat: 3 },
    result: 'bread',
    priority: 2,
  },
  {
    name: 'torch',
    needs: { coal: 1, stick: 1 },
    result: 'torch',
    priority: 4,
  },
];

module.exports = function craftingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function hasItems(needs) {
    const inv = bot.inventory.items();
    for (const [item, count] of Object.entries(needs)) {
      const found = inv.find(i => i.name === item);
      if (!found || found.count < count) return false;
    }
    return true;
  }

  function isViable() {
    return RECIPES.some(r => hasItems(r.needs));
  }

  async function run() {
    if (active) return;
    active = true;

    try {
      // Urutkan berdasarkan prioritas
      const sorted = [...RECIPES].sort((a, b) => a.priority - b.priority);

      for (const recipe of sorted) {
        if (!hasItems(recipe.needs)) continue;

        // Cek sudah punya atau tidak
        const alreadyHas = bot.inventory.items().find(i => i.name === recipe.result);
        if (alreadyHas && alreadyHas.count >= 4) continue; // sudah cukup

        // Cari crafting table terdekat
        const tableId = mcData.blocksByName['crafting_table']?.id;
        const craftTable = tableId ? bot.findBlock({ matching: tableId, maxDistance: 16 }) : null;

        try {
          const recipeData = await bot.recipesFor(
            mcData.itemsByName[recipe.result]?.id,
            null,
            1,
            craftTable
          );

          if (recipeData && recipeData.length > 0) {
            await bot.craft(recipeData[0], 1, craftTable);
            civ.addLog(`[${bot.username}] 🔨 Craft ${recipe.result}`);
            await sleep(500);
            break;
          }
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
