/**
 * STORAGE MANAGER
 * Manajemen chest bersama untuk semua bot.
 * - Bot deposit item saat inventory penuh
 * - Bot withdraw item saat butuh sesuatu
 * - Koordinat chest disimpan di civilization state
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, withUnstuck } = require('../shared/utils');
const civ = require('./civilization');

// Slot inventory dianggap "penuh" jika tersisa <= ini
const INVENTORY_FULL_THRESHOLD = 4;

// Item yang TIDAK boleh di-deposit (selalu disimpan di tangan)
const KEEP_ITEMS = [
  'diamond_pickaxe',
  'netherite_pickaxe',
  'iron_pickaxe',
  'stone_pickaxe',
  'wooden_pickaxe',
  'diamond_axe',
  'netherite_axe',
  'iron_axe',
  'stone_axe',
  'wooden_axe',
  'diamond_sword',
  'netherite_sword',
  'iron_sword',
  'stone_sword',
  'wooden_sword',
  'diamond_helmet',
  'iron_helmet',
  'golden_helmet',
  'chainmail_helmet',
  'leather_helmet',
  'diamond_chestplate',
  'iron_chestplate',
  'golden_chestplate',
  'chainmail_chestplate',
  'leather_chestplate',
  'diamond_leggings',
  'iron_leggings',
  'golden_leggings',
  'chainmail_leggings',
  'leather_leggings',
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
  'torch',
  'bread',
  'cooked_beef',
  'cooked_chicken',
  'cooked_porkchop',
  'wheat_seeds',
  'bone_meal',
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
];

// Minimal stack yang disimpan di inventory untuk tiap item penting
const KEEP_MIN = {
  torch: 16,
  bread: 8,
  cooked_beef: 8,
  wheat_seeds: 16,
  bone_meal: 8,
  cobblestone: 16,
  oak_planks: 8,
  stick: 8,
};

module.exports = function createStorageManager(bot, mcData) {
  // ──────────────────────────────────────────
  // UTILS
  // ──────────────────────────────────────────

  function getEmptySlots() {
    const used = bot.inventory.items().length;
    const max = bot.inventory.inventoryStart - bot.inventory.hotbarStart + 9; // ~36
    return max - used;
  }

  function isInventoryFull() {
    return getEmptySlots() <= INVENTORY_FULL_THRESHOLD;
  }

  function shouldKeep(itemName) {
    return KEEP_ITEMS.includes(itemName);
  }

  function getDepositableItems() {
    return bot.inventory.items().filter(item => {
      if (shouldKeep(item.name)) return false;
      // Jika ada minimum yang harus disimpan di inventory
      const minKeep = KEEP_MIN[item.name] || 0;
      return item.count > minKeep;
    });
  }

  // ──────────────────────────────────────────
  // SIMPAN KOORDINAT CHEST KE CIV STATE
  // ──────────────────────────────────────────

  function registerChest(pos) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    civ.updateState(s => {
      if (!s.chests) s.chests = {};
      if (!s.chests[key]) {
        s.chests[key] = { pos: { x: pos.x, y: pos.y, z: pos.z }, contents: {} };
        console.log(`[Storage] 📦 Chest baru terdaftar di (${pos.x},${pos.y},${pos.z})`);
        civ.addLog(`[Storage] 📦 Chest baru: (${pos.x},${pos.y},${pos.z})`);
      }
    });
  }

  function getAllChestPositions() {
    const state = civ.getState();
    if (!state.chests) return [];
    return Object.values(state.chests).map(c => new Vec3(c.pos.x, c.pos.y, c.pos.z));
  }

  function updateChestContents(pos, contents) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    civ.updateState(s => {
      if (!s.chests) s.chests = {};
      if (!s.chests[key]) s.chests[key] = { pos: { x: pos.x, y: pos.y, z: pos.z }, contents: {} };
      s.chests[key].contents = contents;
    });
  }

  // Cari chest yang punya item tertentu berdasarkan catatan state
  function findChestWithItem(itemName) {
    const state = civ.getState();
    if (!state.chests) return null;
    for (const [key, chest] of Object.entries(state.chests)) {
      if (chest.contents && chest.contents[itemName] > 0) {
        return new Vec3(chest.pos.x, chest.pos.y, chest.pos.z);
      }
    }
    return null;
  }

  // ──────────────────────────────────────────
  // BUAT CHEST BARU
  // ──────────────────────────────────────────

  async function placeNewChest() {
    // Cek punya chest di inventory
    let chestItem = bot.inventory.items().find(i => i.name === 'chest');

    // Tidak punya → craft dari planks
    if (!chestItem) {
      const planks = bot.inventory.items().find(i => i.name.includes('_planks') && i.count >= 8);
      if (!planks) {
        console.log(`[${bot.username}] Tidak bisa buat chest: tidak ada planks`);
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
          console.log(`[${bot.username}] 📦 Craft chest berhasil`);
        }
      } catch (err) {
        console.log(`[${bot.username}] Gagal craft chest: ${err.message}`);
        return null;
      }
    }

    if (!chestItem) return null;

    // Pasang chest di dekat bot
    await bot.equip(chestItem, 'hand');
    const pos = bot.entity.position.floored();

    // Cari tempat kosong untuk taruh chest
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

    for (const offset of offsets) {
      const target = pos.plus(offset);
      const blockAt = bot.blockAt(target);
      const blockBelow = bot.blockAt(target.offset(0, -1, 0));
      const blockAbove = bot.blockAt(target.offset(0, 1, 0));

      if (
        blockAt?.name === 'air' &&
        blockAbove?.name === 'air' &&
        blockBelow &&
        blockBelow.name !== 'air'
      ) {
        try {
          await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
          await waitMs(500);

          // Cari chest yang baru dipasang
          const chestId = mcData.blocksByName['chest']?.id;
          const newChest = chestId ? bot.findBlock({ matching: chestId, maxDistance: 5 }) : null;
          if (newChest) {
            registerChest(newChest.position);
            return newChest;
          }
        } catch (_) {
          continue;
        }
      }
    }

    return null;
  }

  // ──────────────────────────────────────────
  // DEPOSIT — Simpan item ke chest
  // ──────────────────────────────────────────

  async function depositToChest(chestBlock) {
    try {
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
        )
      );

      const chest = await bot.openChest(chestBlock);
      await waitMs(300);

      const depositables = getDepositableItems();
      const deposited = {};

      for (const item of depositables) {
        const minKeep = KEEP_MIN[item.name] || 0;
        const toDeposit = item.count - minKeep;
        if (toDeposit <= 0) continue;

        try {
          await chest.deposit(item.type, null, toDeposit);
          deposited[item.name] = (deposited[item.name] || 0) + toDeposit;
          await waitMs(100);
        } catch (_) {}
      }

      // Update catatan isi chest
      const contents = {};
      for (const item of chest.items()) {
        contents[item.name] = (contents[item.name] || 0) + item.count;
      }
      updateChestContents(chestBlock.position, contents);

      await chest.close();

      const depositedNames = Object.entries(deposited)
        .map(([n, c]) => `${n}x${c}`)
        .join(', ');

      if (depositedNames) {
        console.log(`[${bot.username}] 📦 Deposit: ${depositedNames}`);
        civ.addLog(`[${bot.username}] 📦 Deposit ke chest: ${depositedNames}`);

        // Update civ resources
        if (deposited.wood) civ.addResources({ wood: deposited.wood });
        if (deposited.cobblestone) civ.addResources({ cobblestone: deposited.cobblestone });
        if (deposited.iron_ingot) civ.addResources({ iron: deposited.iron_ingot });
        if (deposited.diamond) civ.addResources({ diamond: deposited.diamond });
        if (deposited.wheat) civ.addResources({ wheat: deposited.wheat });
      }

      return true;
    } catch (err) {
      console.log(`[${bot.username}] [deposit] ${err.message}`);
      return false;
    }
  }

  // ──────────────────────────────────────────
  // WITHDRAW — Ambil item dari chest
  // ──────────────────────────────────────────

  async function withdrawFromChest(chestBlock, itemName, amount = 64) {
    try {
      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
        )
      );

      const chest = await bot.openChest(chestBlock);
      await waitMs(300);

      const item = chest.items().find(i => i.name === itemName);
      if (!item) {
        await chest.close();
        return false;
      }

      const toWithdraw = Math.min(item.count, amount);
      await chest.withdraw(item.type, null, toWithdraw);
      await waitMs(200);

      // Update catatan isi chest
      const contents = {};
      for (const i of chest.items()) {
        contents[i.name] = (contents[i.name] || 0) + i.count;
      }
      updateChestContents(chestBlock.position, contents);

      await chest.close();
      console.log(`[${bot.username}] 📤 Ambil ${toWithdraw}x ${itemName} dari chest`);
      civ.addLog(`[${bot.username}] 📤 Ambil ${itemName}x${toWithdraw} dari chest`);
      return true;
    } catch (err) {
      console.log(`[${bot.username}] [withdraw] ${err.message}`);
      return false;
    }
  }

  // ──────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────

  /**
   * Cek dan deposit jika inventory penuh.
   * Dipanggil dari skill sebelum mulai kerja.
   */
  async function checkAndDeposit() {
    if (!isInventoryFull()) return false;

    console.log(`[${bot.username}] 🎒 Inventory penuh! Cari chest...`);
    civ.addLog(`[${bot.username}] 🎒 Inventory penuh, deposit...`);

    // Cari chest yang sudah ada
    const chestId = mcData.blocksByName['chest']?.id;
    let nearestChest = chestId ? bot.findBlock({ matching: chestId, maxDistance: 32 }) : null;

    // Tidak ada chest di dekat → cek koordinat yang tersimpan
    if (!nearestChest) {
      const positions = getAllChestPositions();
      for (const pos of positions) {
        const b = bot.blockAt(pos);
        if (b?.name === 'chest') {
          nearestChest = b;
          break;
        }
      }
    }

    // Masih tidak ada → buat chest baru
    if (!nearestChest) {
      console.log(`[${bot.username}] Tidak ada chest, membuat baru...`);
      nearestChest = await placeNewChest();
    }

    if (!nearestChest) {
      console.log(`[${bot.username}] Gagal dapat chest!`);
      return false;
    }

    return await depositToChest(nearestChest);
  }

  /**
   * Cari item di chest, ambil jika ada.
   * Return true jika berhasil ambil.
   */
  async function fetchFromStorage(itemName, amount = 16) {
    // Cek dulu di chest yang tercatat punya item ini
    const knownPos = findChestWithItem(itemName);

    if (knownPos) {
      const block = bot.blockAt(knownPos);
      if (block?.name === 'chest') {
        const ok = await withdrawFromChest(block, itemName, amount);
        if (ok) return true;
      }
    }

    // Scan semua chest di dekat
    const chestId = mcData.blocksByName['chest']?.id;
    if (!chestId) return false;

    const nearChests = [];
    let found = bot.findBlock({ matching: chestId, maxDistance: 48 });
    while (found && nearChests.length < 10) {
      nearChests.push(found);
      found = bot.findBlock({
        matching: chestId,
        maxDistance: 48,
        useExtraInfo: b => !nearChests.some(c => c.position.equals(b.position)),
      });
      if (!found) break;
    }

    for (const chest of nearChests) {
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
