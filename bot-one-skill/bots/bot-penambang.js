const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { sleep, createReconnectHandler } = require('../shared/utils');

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiPenambang',
  auth: 'offline',
};

function createBot() {
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let isMining = false;

  // Prioritas ore: diamond > gold > iron > coal > stone
  const ORE_PRIORITY = [
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

  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);
    const move = new Movements(bot, mcData);
    move.canDig = true;
    move.scafoldingBlocks = [];
    bot.pathfinder.setMovements(move);
    console.log(`[SiPenambang] Siap mining! Versi: ${bot.version}`);
    miningLoop();
  });

  async function miningLoop() {
    while (true) {
      await sleep(2500);
      if (!bot.entity || isMining) continue;
      isMining = true;
      try {
        await mineOre();
      } catch (err) {
        console.log('[SiPenambang] Error:', err.message);
      }
      isMining = false;
    }
  }

  async function mineOre() {
    let targetBlock = null;

    // Cari ore berdasarkan prioritas
    for (const oreName of ORE_PRIORITY) {
      const oreId = mcData.blocksByName[oreName]?.id;
      if (!oreId) continue;

      targetBlock = bot.findBlock({
        matching: oreId,
        maxDistance: 16,
      });

      if (targetBlock) {
        console.log(`[SiPenambang] 🎯 Target: ${oreName}`);
        break;
      }
    }

    if (!targetBlock) {
      console.log('[SiPenambang] Tidak ada ore ditemukan.');
      return;
    }

    const pos = targetBlock.position;

    // Equip pickaxe terbaik yang ada
    const pickaxes = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];
    for (const pick of pickaxes) {
      const tool = bot.inventory.items().find(i => i.name === pick);
      if (tool) {
        await bot.equip(tool, 'hand');
        break;
      }
    }

    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

    const block = bot.blockAt(pos);
    if (!block || block.name === 'air') return;

    await bot.dig(block);
    console.log(`[SiPenambang] ⛏️ Tambang ${block.name} di (${pos.x}, ${pos.y}, ${pos.z})`);
    await sleep(500);
  }

  bot.on('error', err => console.log('[SiPenambang] Error:', err.message));
  bot.on('kicked', reason => console.log('[SiPenambang] Kicked:', reason));
  bot.on('end', createReconnectHandler(CONFIG, createBot));
}

createBot();
