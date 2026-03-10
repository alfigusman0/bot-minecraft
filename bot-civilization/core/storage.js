/**
 * STORAGE MANAGER — v4 Creative Edition
 *
 * Perubahan:
 * - Bot creative (farming/building) bypass chest → langsung /give
 * - Semua material selalu tersedia untuk dedicated bot
 * - Chest system tetap berjalan untuk bot survival (mining, logging, dll)
 * - Rate limit /give agar tidak spam chat
 */

'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs } = require('../shared/utils');
const civ = require('./civilization');

const INVENTORY_FULL_THRESHOLD = 4;
const CHEST_OPEN_TIMEOUT = 8000;
const PATHFIND_TO_CHEST_TIMEOUT = 12000;

// Items yang selalu disimpan bot (tidak di-deposit)
const KEEP_ITEMS = new Set([
  'netherite_pickaxe',
  'diamond_pickaxe',
  'iron_pickaxe',
  'stone_pickaxe',
  'wooden_pickaxe',
  'netherite_axe',
  'diamond_axe',
  'iron_axe',
  'stone_axe',
  'wooden_axe',
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'stone_sword',
  'wooden_sword',
  'netherite_hoe',
  'diamond_hoe',
  'iron_hoe',
  'stone_hoe',
  'wooden_hoe',
  'netherite_helmet',
  'diamond_helmet',
  'iron_helmet',
  'golden_helmet',
  'chainmail_helmet',
  'leather_helmet',
  'netherite_chestplate',
  'diamond_chestplate',
  'iron_chestplate',
  'golden_chestplate',
  'chainmail_chestplate',
  'leather_chestplate',
  'netherite_leggings',
  'diamond_leggings',
  'iron_leggings',
  'golden_leggings',
  'chainmail_leggings',
  'leather_leggings',
  'netherite_boots',
  'diamond_boots',
  'iron_boots',
  'golden_boots',
  'chainmail_boots',
  'leather_boots',
  'shield',
  'bow',
  'crossbow',
  'trident',
  'fishing_rod',
  'shears',
  'crafting_table',
  'furnace',
  'smoker',
  'white_bed',
  'orange_bed',
  'magenta_bed',
  'light_blue_bed',
  'yellow_bed',
  'lime_bed',
  'pink_bed',
  'gray_bed',
  'light_gray_bed',
  'cyan_bed',
  'purple_bed',
  'blue_bed',
  'brown_bed',
  'green_bed',
  'red_bed',
  'black_bed',
]);

const KEEP_MIN = {
  torch: 16,
  bread: 8,
  cooked_beef: 8,
  cooked_chicken: 8,
  cooked_porkchop: 8,
  wheat_seeds: 16,
  bone_meal: 8,
  cobblestone: 16,
  oak_planks: 8,
  stick: 8,
};

// Chest locks — mencegah 2 bot buka chest yang sama bersamaan
const chestLocks = {};
function lockChest(key, user) {
  chestLocks[key] = user;
}
function unlockChest(key) {
  delete chestLocks[key];
}
function isChestLocked(key, me) {
  return chestLocks[key] && chestLocks[key] !== me;
}

// /give rate limiter
const giveCache = new Map(); // itemName → lastGiveTime
const GIVE_COOLDOWN_MS = 5000;

module.exports = function createStorageManager(bot, mcData) {
  // ── Deteksi apakah bot ini dalam creative mode ──────────────
  function isCreative() {
    return typeof bot.isCreativeMode === 'function' && bot.isCreativeMode();
  }

  // ── /give helper (creative only) ───────────────────────────
  async function giveItem(itemName, amount = 64) {
    if (!isCreative()) return false;

    const now = Date.now();
    const last = giveCache.get(itemName) ?? 0;
    if (now - last < GIVE_COOLDOWN_MS) return true; // Sudah di-give baru-baru ini

    const current = bot.inventory
      .items()
      .filter(i => i.name === itemName)
      .reduce((s, i) => s + i.count, 0);

    if (current >= amount) return true; // Sudah cukup

    giveCache.set(itemName, now);
    bot.chat(`/give ${bot.username} ${itemName} ${amount}`);
    await waitMs(600);
    console.log(`[${bot.username}] 🎁 /give ${itemName} ×${amount}`);
    return true;
  }

  // ── Inventory helpers ────────────────────────────────────────
  function getEmptySlots() {
    return 36 - bot.inventory.items().length;
  }

  function isInventoryFull() {
    // Creative bot tidak pernah dianggap penuh (tidak perlu deposit)
    if (isCreative()) return false;
    return getEmptySlots() <= INVENTORY_FULL_THRESHOLD;
  }

  function getDepositableItems() {
    return bot.inventory.items().filter(item => {
      if (KEEP_ITEMS.has(item.name)) return false;
      const minKeep = KEEP_MIN[item.name] || 0;
      return item.count > minKeep;
    });
  }

  // ── Chest registry ───────────────────────────────────────────
  function posKey(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  function registerChest(pos) {
    const key = posKey(pos);
    civ.updateState(s => {
      if (!s.chests) s.chests = {};
      if (!s.chests[key]) {
        s.chests[key] = {
          pos: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
          contents: {},
        };
        civ.addLog(`[Storage] 📦 Chest tercatat: (${key})`);
      }
    });
  }

  function updateChestContents(pos, contents) {
    const key = posKey(pos);
    civ.updateState(s => {
      if (!s.chests) s.chests = {};
      if (s.chests[key]) s.chests[key].contents = contents;
    });
  }

  function getAllChestPositions() {
    const state = civ.getState();
    if (!state.chests) return [];
    return Object.values(state.chests).map(c => new Vec3(c.pos.x, c.pos.y, c.pos.z));
  }

  function findChestWithItem(itemName) {
    const state = civ.getState();
    if (!state.chests) return null;
    for (const chest of Object.values(state.chests)) {
      if ((chest.contents?.[itemName] || 0) > 0)
        return new Vec3(chest.pos.x, chest.pos.y, chest.pos.z);
    }
    return null;
  }

  function findAllNearChests(maxDistance = 48) {
    const chestId = mcData.blocksByName['chest']?.id;
    if (!chestId) return [];

    const results = [];
    const seen = new Set();

    for (let i = 0; i < 30; i++) {
      const found = bot.findBlock({
        matching: chestId,
        maxDistance,
        useExtraInfo: b => !seen.has(posKey(b.position)),
      });
      if (!found) break;
      seen.add(posKey(found.position));
      results.push(found);
    }

    for (const savedPos of getAllChestPositions()) {
      const key = posKey(savedPos);
      if (seen.has(key)) continue;
      const block = bot.blockAt(savedPos);
      if (block?.name === 'chest') {
        results.push(block);
        seen.add(key);
      }
    }

    results.sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
    );
    return results;
  }

  async function goToChest(chestBlock) {
    const p = chestBlock.position;
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 1)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout pathfind ke chest')), PATHFIND_TO_CHEST_TIMEOUT)
      ),
    ]);
  }

  async function openChestSafe(chestBlock) {
    return await Promise.race([
      bot.openChest(chestBlock),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout openChest')), CHEST_OPEN_TIMEOUT)
      ),
    ]);
  }

  // ── DEPOSIT ─────────────────────────────────────────────────
  async function depositToChest(chestBlock) {
    const key = posKey(chestBlock.position);
    if (isChestLocked(key, bot.username)) return false;

    lockChest(key, bot.username);
    let window = null;

    try {
      await goToChest(chestBlock);
      await waitMs(200);

      const fresh = bot.blockAt(chestBlock.position);
      if (!fresh || fresh.name !== 'chest') return false;

      window = await openChestSafe(fresh);
      await waitMs(300);

      const depositables = getDepositableItems();
      const deposited = {};
      let depositCount = 0;

      for (const item of depositables) {
        const minKeep = KEEP_MIN[item.name] || 0;
        const toDeposit = item.count - minKeep;
        if (toDeposit <= 0) continue;

        try {
          await window.deposit(item.type, null, toDeposit);
          deposited[item.name] = (deposited[item.name] || 0) + toDeposit;
          depositCount++;
          await waitMs(80);
        } catch (e) {
          if (e.message?.includes('full') || e.message?.includes('penuh')) break;
        }
      }

      const contents = {};
      for (const i of window.items()) contents[i.name] = (contents[i.name] || 0) + i.count;
      updateChestContents(chestBlock.position, contents);

      window.close();
      window = null;

      if (depositCount > 0) {
        const summary = Object.entries(deposited)
          .map(([n, c]) => `${n}×${c}`)
          .join(', ');
        console.log(`[${bot.username}] 📦 Deposit: ${summary}`);
        civ.addLog(`[${bot.username}] 📦 ${summary}`);

        const resMap = {
          oak_log: 'wood',
          birch_log: 'wood',
          spruce_log: 'wood',
          cobblestone: 'cobblestone',
          iron_ingot: 'iron',
          gold_ingot: 'gold',
          diamond: 'diamond',
          wheat: 'wheat',
        };
        for (const [item, res] of Object.entries(resMap)) {
          if (deposited[item]) civ.addResources({ [res]: deposited[item] });
        }
        return true;
      }
      return false;
    } catch (err) {
      console.log(`[${bot.username}] [deposit] ${err.message}`);
      if (window)
        try {
          window.close();
        } catch (_) {}
      return false;
    } finally {
      unlockChest(key);
    }
  }

  // ── WITHDRAW ─────────────────────────────────────────────────
  async function withdrawFromChest(chestBlock, itemName, amount = 64) {
    const key = posKey(chestBlock.position);
    if (isChestLocked(key, bot.username)) return false;

    lockChest(key, bot.username);
    let window = null;

    try {
      await goToChest(chestBlock);
      await waitMs(200);

      const fresh = bot.blockAt(chestBlock.position);
      if (!fresh || fresh.name !== 'chest') return false;

      window = await openChestSafe(fresh);
      await waitMs(300);

      const item = window.items().find(i => i.name === itemName);
      if (!item) {
        window.close();
        window = null;
        return false;
      }

      const toWithdraw = Math.min(item.count, amount);
      await window.withdraw(item.type, null, toWithdraw);
      await waitMs(150);

      const contents = {};
      for (const i of window.items()) contents[i.name] = (contents[i.name] || 0) + i.count;
      updateChestContents(chestBlock.position, contents);

      window.close();
      window = null;
      console.log(`[${bot.username}] 📤 Ambil ${toWithdraw}× ${itemName}`);
      civ.addLog(`[${bot.username}] 📤 ${itemName}×${toWithdraw}`);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] [withdraw] ${err.message}`);
      if (window)
        try {
          window.close();
        } catch (_) {}
      return false;
    } finally {
      unlockChest(key);
    }
  }

  // ── Buat & pasang chest baru ─────────────────────────────────
  async function placeNewChest() {
    let chestItem = bot.inventory.items().find(i => i.name === 'chest');

    if (!chestItem) {
      if (isCreative()) {
        // Creative: /give chest langsung
        await giveItem('chest', 4);
        await waitMs(500);
        chestItem = bot.inventory.items().find(i => i.name === 'chest');
      } else {
        const planks = bot.inventory.items().find(i => i.name.includes('_planks') && i.count >= 8);
        if (!planks) return null;
        const chestId = mcData.itemsByName['chest']?.id;
        if (!chestId) return null;
        try {
          const recipes = await bot.recipesFor(chestId, null, 1, null);
          if (recipes?.length) {
            await bot.craft(recipes[0], 1, null);
            await waitMs(400);
            chestItem = bot.inventory.items().find(i => i.name === 'chest');
          }
        } catch (_) {
          return null;
        }
      }
    }

    if (!chestItem) return null;
    await bot.equip(chestItem, 'hand');

    const pos = bot.entity.position.floored();
    const offsets = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(2, 0, 0),
      new Vec3(0, 0, 2),
      new Vec3(-2, 0, 0),
      new Vec3(0, 0, -2),
    ];

    for (const off of offsets) {
      const target = pos.plus(off);
      const at = bot.blockAt(target);
      const below = bot.blockAt(target.offset(0, -1, 0));
      const above = bot.blockAt(target.offset(0, 1, 0));
      if (at?.name === 'air' && above?.name === 'air' && below?.name !== 'air') {
        try {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(500);
          const cid = mcData.blocksByName['chest']?.id;
          const placed = cid ? bot.findBlock({ matching: cid, maxDistance: 5 }) : null;
          if (placed) {
            registerChest(placed.position);
            return placed;
          }
        } catch (_) {
          continue;
        }
      }
    }
    return null;
  }

  // ── PUBLIC: checkAndDeposit ──────────────────────────────────
  async function checkAndDeposit() {
    // Creative bot tidak perlu deposit
    if (isCreative()) return false;
    if (!isInventoryFull()) return false;

    console.log(`[${bot.username}] 🎒 Inventory penuh! Cari chest...`);
    const chests = findAllNearChests(48);

    if (!chests.length) {
      const newChest = await placeNewChest();
      if (!newChest) return false;
      return depositToChest(newChest);
    }

    for (const c of chests) registerChest(c.position);
    for (const c of chests) {
      const ok = await depositToChest(c);
      if (ok) return true;
      await waitMs(200);
    }

    const newChest = await placeNewChest();
    if (!newChest) return false;
    return depositToChest(newChest);
  }

  // ── PUBLIC: fetchFromStorage ─────────────────────────────────
  async function fetchFromStorage(itemName, amount = 16) {
    // Creative bot: /give langsung, tidak perlu chest
    if (isCreative()) {
      return await giveItem(itemName, amount);
    }

    // Survival: cari di chest
    const knownPos = findChestWithItem(itemName);
    if (knownPos) {
      const block = bot.blockAt(knownPos);
      if (block?.name === 'chest') {
        const ok = await withdrawFromChest(block, itemName, amount);
        if (ok) return true;
      }
    }

    const chests = findAllNearChests(48);
    for (const c of chests) {
      registerChest(c.position);
      const ok = await withdrawFromChest(c, itemName, amount);
      if (ok) return true;
    }

    return false;
  }

  return {
    isInventoryFull,
    getEmptySlots,
    checkAndDeposit,
    fetchFromStorage,
    placeNewChest,
    registerChest,
    getAllChestPositions,
    findChestWithItem,
    giveItem, // expose untuk skill yang butuh
  };
};
