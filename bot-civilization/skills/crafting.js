/**
 * CRAFTING SKILL — Professional Edition
 *
 * Fitur:
 * - Recipe tree lengkap: tools, weapons, armor, food, building, redstone, utility
 * - Smart priority: craft berdasarkan kebutuhan peradaban saat ini
 * - Auto-fetch bahan dari storage jika kurang
 * - Craft chain: kayu → papan → tongkat → alat secara otomatis
 * - Upgrade tracker: tidak craft item yang sudah ada versi lebih baik
 * - Crafting table auto-place jika tidak ada
 * - Furnace smelt: otomatis masak ore jadi ingot
 */

'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, withUnstuck, hasItem, countItem } = require('../shared/utils');
const civ = require('../core/civilization');
const createStorage = require('../core/storage');

// ─────────────────────────────────────────────
//  RECIPE REGISTRY
// ─────────────────────────────────────────────

/**
 * Urutan priority: lebih kecil = lebih dulu dicoba
 * needs: { itemName: minCount }
 * maxKeep: hentikan craft jika sudah punya >= ini
 */
const RECIPES = [
  // ── DASAR ──────────────────────────────────
  { name: 'oak_planks', needs: { oak_log: 1 }, priority: 1, maxKeep: 64, needsTable: false },
  { name: 'birch_planks', needs: { birch_log: 1 }, priority: 1, maxKeep: 64, needsTable: false },
  { name: 'spruce_planks', needs: { spruce_log: 1 }, priority: 1, maxKeep: 64, needsTable: false },
  { name: 'stick', needs: { oak_planks: 2 }, priority: 2, maxKeep: 32, needsTable: false },
  { name: 'crafting_table', needs: { oak_planks: 4 }, priority: 2, maxKeep: 2, needsTable: false },
  { name: 'chest', needs: { oak_planks: 8 }, priority: 2, maxKeep: 8, needsTable: true },
  { name: 'furnace', needs: { cobblestone: 8 }, priority: 3, maxKeep: 2, needsTable: true },
  { name: 'smoker', needs: { oak_log: 4, furnace: 1 }, priority: 4, maxKeep: 1, needsTable: true },
  {
    name: 'barrel',
    needs: { oak_planks: 6, oak_slab: 2 },
    priority: 4,
    maxKeep: 4,
    needsTable: true,
  },
  { name: 'oak_slab', needs: { oak_planks: 3 }, priority: 3, maxKeep: 16, needsTable: true },
  { name: 'oak_stairs', needs: { oak_planks: 6 }, priority: 4, maxKeep: 16, needsTable: true },
  { name: 'torch', needs: { coal: 1, stick: 1 }, priority: 3, maxKeep: 64, needsTable: false },
  { name: 'torch', needs: { charcoal: 1, stick: 1 }, priority: 3, maxKeep: 64, needsTable: false },
  {
    name: 'campfire',
    needs: { stick: 3, coal: 1, oak_log: 3 },
    priority: 4,
    maxKeep: 2,
    needsTable: true,
  },
  { name: 'ladder', needs: { stick: 7 }, priority: 4, maxKeep: 32, needsTable: true },
  {
    name: 'scaffolding',
    needs: { bamboo: 6, string: 1 },
    priority: 4,
    maxKeep: 32,
    needsTable: true,
  },

  // ── ALAT KAYU ──────────────────────────────
  {
    name: 'wooden_pickaxe',
    needs: { oak_planks: 3, stick: 2 },
    priority: 5,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'pickaxe',
  },
  {
    name: 'wooden_axe',
    needs: { oak_planks: 3, stick: 2 },
    priority: 5,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'axe',
  },
  {
    name: 'wooden_shovel',
    needs: { oak_planks: 1, stick: 2 },
    priority: 5,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'shovel',
  },
  {
    name: 'wooden_hoe',
    needs: { oak_planks: 2, stick: 2 },
    priority: 5,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'hoe',
  },
  {
    name: 'wooden_sword',
    needs: { oak_planks: 2, stick: 1 },
    priority: 5,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'sword',
  },

  // ── ALAT BATU ──────────────────────────────
  {
    name: 'stone_pickaxe',
    needs: { cobblestone: 3, stick: 2 },
    priority: 6,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'pickaxe',
  },
  {
    name: 'stone_axe',
    needs: { cobblestone: 3, stick: 2 },
    priority: 6,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'axe',
  },
  {
    name: 'stone_shovel',
    needs: { cobblestone: 1, stick: 2 },
    priority: 6,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'shovel',
  },
  {
    name: 'stone_hoe',
    needs: { cobblestone: 2, stick: 2 },
    priority: 6,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'hoe',
  },
  {
    name: 'stone_sword',
    needs: { cobblestone: 2, stick: 1 },
    priority: 6,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'sword',
  },

  // ── ALAT BESI ──────────────────────────────
  {
    name: 'iron_pickaxe',
    needs: { iron_ingot: 3, stick: 2 },
    priority: 7,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'pickaxe',
  },
  {
    name: 'iron_axe',
    needs: { iron_ingot: 3, stick: 2 },
    priority: 7,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'axe',
  },
  {
    name: 'iron_shovel',
    needs: { iron_ingot: 1, stick: 2 },
    priority: 7,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'shovel',
  },
  {
    name: 'iron_hoe',
    needs: { iron_ingot: 2, stick: 2 },
    priority: 7,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'hoe',
  },
  {
    name: 'iron_sword',
    needs: { iron_ingot: 2, stick: 1 },
    priority: 7,
    maxKeep: 2,
    needsTable: true,
    upgradeOf: 'sword',
  },

  // ── ALAT DIAMOND ───────────────────────────
  {
    name: 'diamond_pickaxe',
    needs: { diamond: 3, stick: 2 },
    priority: 9,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'pickaxe',
  },
  {
    name: 'diamond_axe',
    needs: { diamond: 3, stick: 2 },
    priority: 9,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'axe',
  },
  {
    name: 'diamond_sword',
    needs: { diamond: 2, stick: 1 },
    priority: 9,
    maxKeep: 1,
    needsTable: true,
    upgradeOf: 'sword',
  },

  // ── ARMOR BESI ─────────────────────────────
  { name: 'iron_helmet', needs: { iron_ingot: 5 }, priority: 8, maxKeep: 1, needsTable: true },
  { name: 'iron_chestplate', needs: { iron_ingot: 8 }, priority: 8, maxKeep: 1, needsTable: true },
  { name: 'iron_leggings', needs: { iron_ingot: 7 }, priority: 8, maxKeep: 1, needsTable: true },
  { name: 'iron_boots', needs: { iron_ingot: 4 }, priority: 8, maxKeep: 1, needsTable: true },

  // ── ARMOR DIAMOND ──────────────────────────
  { name: 'diamond_helmet', needs: { diamond: 5 }, priority: 10, maxKeep: 1, needsTable: true },
  { name: 'diamond_chestplate', needs: { diamond: 8 }, priority: 10, maxKeep: 1, needsTable: true },
  { name: 'diamond_leggings', needs: { diamond: 7 }, priority: 10, maxKeep: 1, needsTable: true },
  { name: 'diamond_boots', needs: { diamond: 4 }, priority: 10, maxKeep: 1, needsTable: true },

  // ── MAKANAN ────────────────────────────────
  { name: 'bread', needs: { wheat: 3 }, priority: 3, maxKeep: 16, needsTable: false },
  {
    name: 'pumpkin_pie',
    needs: { pumpkin: 1, sugar: 1, egg: 1 },
    priority: 4,
    maxKeep: 8,
    needsTable: false,
  },

  // ── UTILITAS ───────────────────────────────
  { name: 'bow', needs: { stick: 3, string: 3 }, priority: 7, maxKeep: 1, needsTable: true },
  {
    name: 'arrow',
    needs: { flint: 1, stick: 1, feather: 1 },
    priority: 5,
    maxKeep: 32,
    needsTable: true,
  },
  { name: 'bucket', needs: { iron_ingot: 3 }, priority: 6, maxKeep: 3, needsTable: true },
  { name: 'shears', needs: { iron_ingot: 2 }, priority: 6, maxKeep: 1, needsTable: true },
  {
    name: 'fishing_rod',
    needs: { stick: 3, string: 2 },
    priority: 5,
    maxKeep: 1,
    needsTable: true,
  },
  {
    name: 'flint_and_steel',
    needs: { iron_ingot: 1, flint: 1 },
    priority: 6,
    maxKeep: 1,
    needsTable: true,
  },
  {
    name: 'compass',
    needs: { iron_ingot: 4, redstone: 1 },
    priority: 7,
    maxKeep: 1,
    needsTable: true,
  },
  {
    name: 'clock',
    needs: { gold_ingot: 4, redstone: 1 },
    priority: 7,
    maxKeep: 1,
    needsTable: true,
  },
  {
    name: 'shield',
    needs: { oak_planks: 6, iron_ingot: 1 },
    priority: 7,
    maxKeep: 1,
    needsTable: true,
  },

  // ── BANGUNAN ───────────────────────────────
  { name: 'stone_bricks', needs: { stone: 4 }, priority: 4, maxKeep: 32, needsTable: true },
  {
    name: 'cobblestone_wall',
    needs: { cobblestone: 6 },
    priority: 4,
    maxKeep: 16,
    needsTable: true,
  },
  { name: 'glass_pane', needs: { glass: 6 }, priority: 5, maxKeep: 16, needsTable: true },
  { name: 'iron_bars', needs: { iron_ingot: 6 }, priority: 5, maxKeep: 16, needsTable: true },

  // ── REDSTONE ───────────────────────────────
  {
    name: 'piston',
    needs: { oak_planks: 3, cobblestone: 4, iron_ingot: 1, redstone: 1 },
    priority: 8,
    maxKeep: 4,
    needsTable: true,
  },
  {
    name: 'observer',
    needs: { cobblestone: 6, redstone: 2, quartz: 1 },
    priority: 8,
    maxKeep: 4,
    needsTable: true,
  },
  { name: 'hopper', needs: { iron_ingot: 5, chest: 1 }, priority: 8, maxKeep: 2, needsTable: true },
  {
    name: 'dispenser',
    needs: { cobblestone: 7, bow: 1, redstone: 1 },
    priority: 8,
    maxKeep: 2,
    needsTable: true,
  },
  {
    name: 'comparator',
    needs: { stone: 3, redstone_torch: 3, quartz: 1 },
    priority: 8,
    maxKeep: 4,
    needsTable: true,
  },
  {
    name: 'repeater',
    needs: { stone: 3, redstone_torch: 2, redstone: 1 },
    priority: 8,
    maxKeep: 4,
    needsTable: true,
  },

  // ── BONE MEAL ──────────────────────────────
  { name: 'bone_meal', needs: { bone: 1 }, priority: 3, maxKeep: 32, needsTable: false },
];

// Tier urutan upgrade: nama → tier (lebih tinggi = lebih baik)
const TOOL_TIERS = {
  wooden: 1,
  stone: 2,
  golden: 2,
  iron: 3,
  diamond: 4,
  netherite: 5,
};

function getToolTier(itemName) {
  for (const [mat, tier] of Object.entries(TOOL_TIERS)) {
    if (itemName.startsWith(mat + '_')) return tier;
  }
  return 0;
}

// Smelting config (ore → ingot)
const SMELT_RECIPES = [
  { input: 'iron_ore', output: 'iron_ingot', fuel: 'coal' },
  { input: 'deepslate_iron_ore', output: 'iron_ingot', fuel: 'coal' },
  { input: 'gold_ore', output: 'gold_ingot', fuel: 'coal' },
  { input: 'deepslate_gold_ore', output: 'gold_ingot', fuel: 'coal' },
  { input: 'copper_ore', output: 'copper_ingot', fuel: 'coal' },
  { input: 'raw_iron', output: 'iron_ingot', fuel: 'coal' },
  { input: 'raw_gold', output: 'gold_ingot', fuel: 'coal' },
  { input: 'raw_copper', output: 'copper_ingot', fuel: 'coal' },
  { input: 'sand', output: 'glass', fuel: 'coal' },
  { input: 'cobblestone', output: 'stone', fuel: 'coal' },
  { input: 'beef', output: 'cooked_beef', fuel: 'coal' },
  { input: 'porkchop', output: 'cooked_porkchop', fuel: 'coal' },
  { input: 'chicken', output: 'cooked_chicken', fuel: 'coal' },
  { input: 'mutton', output: 'cooked_mutton', fuel: 'coal' },
  { input: 'cod', output: 'cooked_cod', fuel: 'coal' },
  { input: 'salmon', output: 'cooked_salmon', fuel: 'coal' },
  { input: 'potato', output: 'baked_potato', fuel: 'coal' },
  { input: 'oak_log', output: 'charcoal', fuel: 'coal' },
];

const FUEL_PRIORITY = [
  'coal',
  'charcoal',
  'blaze_rod',
  'oak_log',
  'birch_log',
  'spruce_log',
  'oak_planks',
  'stick',
];

// ─────────────────────────────────────────────
//  MAIN SKILL
// ─────────────────────────────────────────────

module.exports = function craftingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let storage = null;

  const stats = { crafted: 0, smelted: 0 };

  function getStorage() {
    if (!storage) storage = createStorage(bot, mcData);
    return storage;
  }

  // ── Inventory helpers ────────────────────────────────────────
  function countInv(name) {
    return bot.inventory
      .items()
      .filter(i => i.name === name)
      .reduce((s, i) => s + i.count, 0);
  }

  function hasItems(needs) {
    return Object.entries(needs).every(([item, count]) => countInv(item) >= count);
  }

  /** Cek apakah sudah punya versi lebih baik dari tool ini */
  function alreadyHasBetter(recipe) {
    if (!recipe.upgradeOf) return false;
    const newTier = getToolTier(recipe.name);

    return bot.inventory.items().some(i => {
      if (!i.name.endsWith('_' + recipe.upgradeOf)) return false;
      return getToolTier(i.name) >= newTier;
    });
  }

  // ── Cari atau buat crafting table ────────────────────────────
  async function ensureCraftingTable() {
    const tableId = mcData.blocksByName['crafting_table']?.id;
    if (tableId) {
      const existing = bot.findBlock({ matching: tableId, maxDistance: 12 });
      if (existing) return existing;
    }

    // Buat dari inventory
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      // Craft dari papan
      const plankItem = bot.inventory.items().find(i => i.name.includes('_planks') && i.count >= 4);
      if (!plankItem) return null;

      const tableItemId = mcData.itemsByName['crafting_table']?.id;
      if (!tableItemId) return null;

      const recipes = await bot.recipesFor(tableItemId, null, 1, null);
      if (recipes?.length) {
        await bot.craft(recipes[0], 1, null);
        await waitMs(300);
        tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
      }
    }

    if (!tableItem) return null;

    // Pasang di dekat bot
    await bot.equip(tableItem, 'hand');
    const pos = bot.entity.position.floored();
    const offsets = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

    for (const off of offsets) {
      const target = pos.plus(off);
      const at = bot.blockAt(target);
      const below = bot.blockAt(target.offset(0, -1, 0));
      if (at?.name === 'air' && below?.name !== 'air') {
        try {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(400);
          const placed = tableId ? bot.findBlock({ matching: tableId, maxDistance: 4 }) : null;
          if (placed) return placed;
        } catch (_) {}
      }
    }
    return null;
  }

  // ── Cari furnace ─────────────────────────────────────────────
  function findFurnace() {
    const ids = ['furnace', 'smoker', 'blast_furnace']
      .map(n => mcData.blocksByName[n]?.id)
      .filter(Boolean);
    return ids.length ? bot.findBlock({ matching: ids, maxDistance: 24 }) : null;
  }

  // ── Smelt ore → ingot ─────────────────────────────────────────
  async function smeltOres() {
    const furnace = findFurnace();
    if (!furnace) return false;

    for (const recipe of SMELT_RECIPES) {
      const inputItem = bot.inventory.items().find(i => i.name === recipe.input && i.count >= 1);
      if (!inputItem) continue;

      const outputCount = countInv(recipe.output);
      if (outputCount >= 32) continue; // Sudah cukup

      const fuel = bot.inventory.items().find(i => FUEL_PRIORITY.includes(i.name));
      if (!fuel) continue;

      try {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(furnace.position.x, furnace.position.y, furnace.position.z, 2)
            ),
          10000
        );

        const window = await Promise.race([
          bot.openFurnace(furnace),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ]);

        const amount = Math.min(inputItem.count, 8);
        await window.putInput(inputItem.type, null, amount);
        await waitMs(200);

        const fuelAmount = Math.min(fuel.count, Math.ceil(amount / 8) + 1);
        await window.putFuel(fuel.type, null, fuelAmount);
        await waitMs(2000);

        try {
          await window.takeOutput();
        } catch (_) {}
        window.close();

        civ.addLog(`[${bot.username}] 🔥 Smelt ${recipe.input} → ${recipe.output} ×${amount}`);
        stats.smelted += amount;
        return true;
      } catch (err) {
        console.log(`[${bot.username}] [smelt] ${err.message}`);
      }
    }
    return false;
  }

  // ── Craft satu item ───────────────────────────────────────────
  async function craftItem(recipe, table) {
    const itemId = mcData.itemsByName[recipe.name]?.id;
    if (!itemId) return false;

    try {
      const recipes = await bot.recipesFor(itemId, null, 1, table);
      if (!recipes?.length) return false;

      if (table) {
        await withUnstuck(
          bot,
          () =>
            bot.pathfinder.goto(
              new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
            ),
          10000
        );
      }

      await bot.craft(recipes[0], 1, table);
      await waitMs(350);

      civ.addLog(`[${bot.username}] 🔨 Craft ${recipe.name}`);
      stats.crafted++;
      return true;
    } catch (err) {
      console.log(`[${bot.username}] [craft] ${recipe.name}: ${err.message}`);
      return false;
    }
  }

  // ── isViable ─────────────────────────────────────────────────
  function isViable() {
    return RECIPES.some(r => hasItems(r.needs) && !alreadyHasBetter(r));
  }

  // ── Prioritas dinamis berdasarkan state peradaban ─────────────
  function sortedRecipes() {
    const state = civ.getState();
    const phase = state.phase;
    const resources = state.resources;

    return [...RECIPES].sort((a, b) => {
      // Boost priority berdasarkan kebutuhan fase
      let pa = a.priority;
      let pb = b.priority;

      if (phase === 'BOOTSTRAP') {
        if (a.name.includes('_pickaxe') || a.name.includes('_axe')) pa -= 2;
        if (b.name.includes('_pickaxe') || b.name.includes('_axe')) pb -= 2;
      }
      if (resources.food < 16) {
        if (a.name === 'bread') pa -= 3;
        if (b.name === 'bread') pb -= 3;
      }
      if (resources.iron >= 4) {
        if (a.name.startsWith('iron_')) pa -= 1;
        if (b.name.startsWith('iron_')) pb -= 1;
      }

      return pa - pb;
    });
  }

  // ── MAIN RUN ─────────────────────────────────────────────────
  async function run() {
    if (active) return;
    active = true;

    try {
      await getStorage()
        .checkAndDeposit()
        .catch(() => {});

      // Coba smelt ore dulu
      await smeltOres();

      const sorted = sortedRecipes();
      let crafted = false;

      for (const recipe of sorted) {
        // Cek stok maksimal
        const current = countInv(recipe.name);
        if (current >= recipe.maxKeep) continue;

        // Sudah punya versi lebih baik?
        if (alreadyHasBetter(recipe)) continue;

        // Punya bahan?
        if (!hasItems(recipe.needs)) {
          // Coba fetch dari storage
          for (const [item] of Object.entries(recipe.needs)) {
            if (countInv(item) < (recipe.needs[item] || 1)) {
              await getStorage()
                .fetchFromStorage(item, recipe.needs[item] * 2)
                .catch(() => {});
            }
          }
          if (!hasItems(recipe.needs)) continue;
        }

        // Butuh crafting table?
        let table = null;
        if (recipe.needsTable) {
          table = await ensureCraftingTable();
          if (!table) continue;
        }

        const ok = await craftItem(recipe, table);
        if (ok) {
          crafted = true;
          break;
        }
      }

      if (!crafted) {
        console.log(`[${bot.username}] Tidak ada yang bisa di-craft sekarang`);
      }
    } catch (err) {
      console.error(`[${bot.username}] [crafting ERROR] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'crafting',
    label: '🔨 Crafting',
    isViable,

    getStats() {
      return { ...stats };
    },

    start() {
      civ.addLog(`[${bot.username}] 🔨 Crafting dimulai`);
      interval = setInterval(run, 3000);
    },

    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      civ.addLog(
        `[${bot.username}] 🛑 Crafting dihentikan | Crafted: ${stats.crafted} | Smelted: ${stats.smelted}`
      );
    },
  };
};
