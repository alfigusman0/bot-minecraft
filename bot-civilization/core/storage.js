/**
 * STORAGE MANAGER — v3 fix
 *
 * Fix utama:
 * 1. GoalBlock (jarak 1) bukan GoalNear(2) agar bot tepat di sebelah chest
 * 2. Tidak pakai withUnstuck wrapper untuk pathfinding ke chest — timeout sendiri
 * 3. Scan SEMUA chest terdekat, retry satu per satu jika gagal
 * 4. Lock sederhana per-chest agar 2 bot tidak buka chest yang sama bersamaan
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs } = require('../shared/utils');
const civ = require('./civilization');

const INVENTORY_FULL_THRESHOLD = 4;
const CHEST_OPEN_TIMEOUT = 8000; // ms tunggu openChest
const PATHFIND_TO_CHEST_TIMEOUT = 12000; // ms pathfind ke chest

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
  'crafting_table',
  'furnace',
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

// Chest yang sedang dibuka bot tertentu (lock sederhana)
// key = "x,y,z", value = botUsername
const chestLocks = {};

function lockChest(posKey, username) {
  chestLocks[posKey] = username;
}
function unlockChest(posKey) {
  delete chestLocks[posKey];
}
function isChestLocked(posKey, selfName) {
  return chestLocks[posKey] && chestLocks[posKey] !== selfName;
}

module.exports = function createStorageManager(bot, mcData) {
  // ── Inventory helpers ────────────────────────────────────────
  function getEmptySlots() {
    // Mineflayer: slot 9-44 = inventory (36 slot total)
    const total = 36;
    const used = bot.inventory.items().length;
    return total - used;
  }

  function isInventoryFull() {
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

  // ── Scan semua chest dalam radius, return array terurut jarak ─
  function findAllNearChests(maxDistance = 48) {
    const chestId = mcData.blocksByName['chest']?.id;
    if (!chestId) return [];

    const results = [];
    const seen = new Set();

    // bot.findBlock hanya return 1, kita akali dengan useExtraInfo exclude
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

    // Tambah chest dari registry yang mungkin di luar render distance
    for (const savedPos of getAllChestPositions()) {
      const key = posKey(savedPos);
      if (seen.has(key)) continue;
      const block = bot.blockAt(savedPos);
      if (block?.name === 'chest') {
        results.push(block);
        seen.add(key);
      }
    }

    // Urutkan dari yang paling dekat
    results.sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
    );

    return results;
  }

  // ── Pathfind ke chest — GoalLookAtBlock agar tepat di sebelah ─
  async function goToChest(chestBlock) {
    const p = chestBlock.position;

    await Promise.race([
      // GoalNear jarak 1 agar bot tepat di sebelah chest
      bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 1)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout pathfind ke chest')), PATHFIND_TO_CHEST_TIMEOUT)
      ),
    ]);
  }

  // ── Open chest dengan timeout ────────────────────────────────
  async function openChestSafe(chestBlock) {
    return await Promise.race([
      bot.openChest(chestBlock),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout openChest')), CHEST_OPEN_TIMEOUT)
      ),
    ]);
  }

  // ── DEPOSIT ke satu chest ────────────────────────────────────
  async function depositToChest(chestBlock) {
    const key = posKey(chestBlock.position);

    if (isChestLocked(key, bot.username)) {
      console.log(`[${bot.username}] Chest ${key} sedang dipakai bot lain, skip`);
      return false;
    }

    lockChest(key, bot.username);
    let window = null;

    try {
      // 1. Pergi ke chest
      await goToChest(chestBlock);
      await waitMs(200);

      // 2. Verifikasi chest masih ada
      const fresh = bot.blockAt(chestBlock.position);
      if (!fresh || fresh.name !== 'chest') {
        console.log(`[${bot.username}] Chest ${key} sudah tidak ada`);
        return false;
      }

      // 3. Buka chest
      window = await openChestSafe(fresh);
      await waitMs(300);

      // 4. Deposit semua item yang bisa di-deposit
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
        } catch (depositErr) {
          // Chest penuh → berhenti deposit ke chest ini
          if (depositErr.message?.includes('full') || depositErr.message?.includes('penuh')) break;
        }
      }

      // 5. Update catatan isi chest
      const contents = {};
      for (const i of window.items()) {
        contents[i.name] = (contents[i.name] || 0) + i.count;
      }
      updateChestContents(chestBlock.position, contents);

      // 6. Tutup chest
      window.close();
      window = null;

      if (depositCount > 0) {
        const summary = Object.entries(deposited)
          .map(([n, c]) => `${n}x${c}`)
          .join(', ');
        console.log(`[${bot.username}] 📦 Deposit berhasil: ${summary}`);
        civ.addLog(`[${bot.username}] 📦 Deposit: ${summary}`);

        // Update civ resources
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

      // Tidak ada yang di-deposit (semua sudah di-keep)
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

  // ── WITHDRAW dari satu chest ─────────────────────────────────
  async function withdrawFromChest(chestBlock, itemName, amount = 64) {
    const key = posKey(chestBlock.position);

    if (isChestLocked(key, bot.username)) {
      console.log(`[${bot.username}] Chest ${key} locked, skip withdraw`);
      return false;
    }

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

      console.log(`[${bot.username}] 📤 Ambil ${toWithdraw}x ${itemName}`);
      civ.addLog(`[${bot.username}] 📤 Ambil ${itemName}x${toWithdraw} dari chest`);
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
      const planks = bot.inventory.items().find(i => i.name.includes('_planks') && i.count >= 8);
      if (!planks) {
        console.log(`[${bot.username}] Tidak ada planks untuk craft chest`);
        return null;
      }

      const chestId = mcData.itemsByName['chest']?.id;
      if (!chestId) return null;

      try {
        const recipes = await bot.recipesFor(chestId, null, 1, null);
        if (recipes?.length) {
          await bot.craft(recipes[0], 1, null);
          await waitMs(400);
          chestItem = bot.inventory.items().find(i => i.name === 'chest');
        }
      } catch (err) {
        console.log(`[${bot.username}] Gagal craft chest: ${err.message}`);
        return null;
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
          const chestBlockId = mcData.blocksByName['chest']?.id;
          const placed = chestBlockId
            ? bot.findBlock({ matching: chestBlockId, maxDistance: 5 })
            : null;
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
    if (!isInventoryFull()) return false;

    console.log(`[${bot.username}] 🎒 Inventory penuh! Cari chest...`);

    // Kumpulkan semua chest di sekitar
    const chests = findAllNearChests(48);

    if (chests.length === 0) {
      console.log(`[${bot.username}] Tidak ada chest, buat baru...`);
      const newChest = await placeNewChest();
      if (!newChest) {
        console.log(`[${bot.username}] Gagal buat chest!`);
        return false;
      }
      return await depositToChest(newChest);
    }

    // Register semua chest yang ditemukan
    for (const c of chests) registerChest(c.position);

    // Coba deposit ke chest satu per satu sampai berhasil
    for (const chest of chests) {
      const ok = await depositToChest(chest);
      if (ok) return true;
      // Chest penuh atau gagal → coba chest berikutnya
      await waitMs(200);
    }

    // Semua chest penuh → buat chest baru
    console.log(`[${bot.username}] Semua chest penuh, buat chest baru...`);
    const newChest = await placeNewChest();
    if (!newChest) return false;
    return await depositToChest(newChest);
  }

  // ── PUBLIC: fetchFromStorage ─────────────────────────────────
  async function fetchFromStorage(itemName, amount = 16) {
    // Cek catatan state dulu (lebih cepat)
    const knownPos = findChestWithItem(itemName);
    if (knownPos) {
      const block = bot.blockAt(knownPos);
      if (block?.name === 'chest') {
        const ok = await withdrawFromChest(block, itemName, amount);
        if (ok) return true;
      }
    }

    // Scan fisik semua chest
    const chests = findAllNearChests(48);
    for (const chest of chests) {
      registerChest(chest.position);
      const ok = await withdrawFromChest(chest, itemName, amount);
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
  };
};
