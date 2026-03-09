const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { sleep, createReconnectHandler } = require('../shared/utils');

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiPenebang',
  auth: 'offline',
};

function createBot() {
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let isWorking = false;

  // Jenis kayu yang dicari
  const WOOD_TYPES = [
    'oak_log',
    'birch_log',
    'spruce_log',
    'jungle_log',
    'acacia_log',
    'dark_oak_log',
  ];

  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);
    const move = new Movements(bot, mcData);
    move.canDig = true;
    move.allow1by1towers = false;
    bot.pathfinder.setMovements(move);
    console.log(`[SiPenebang] Siap menebang! Versi: ${bot.version}`);
    choppingLoop();
  });

  async function choppingLoop() {
    while (true) {
      await sleep(3000);
      if (!bot.entity || isWorking) continue;
      isWorking = true;
      try {
        await chopTree();
      } catch (err) {
        console.log('[SiPenebang] Error:', err.message);
      }
      isWorking = false;
    }
  }

  async function chopTree() {
    // Cari log terdekat
    const logBlock = bot.findBlock({
      matching: WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean),
      maxDistance: 32,
    });

    if (!logBlock) {
      console.log('[SiPenebang] Tidak ada pohon di sekitar.');
      return;
    }

    const pos = logBlock.position;
    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

    // Tebang semua log yang terhubung (strip mining ke atas)
    let currentPos = pos.clone();
    let count = 0;

    while (count < 10) {
      // Max 10 blok ke atas per pohon
      const currentBlock = bot.blockAt(currentPos);
      if (!currentBlock || !WOOD_TYPES.includes(currentBlock.name)) break;

      await bot.dig(currentBlock);
      console.log(
        `[SiPenebang] 🪓 Tebang log di (${currentPos.x}, ${currentPos.y}, ${currentPos.z})`
      );
      await sleep(300);

      currentPos = currentPos.offset(0, 1, 0); // Naik ke log berikutnya
      count++;
    }

    console.log(`[SiPenebang] ✅ Selesai tebang ${count} log.`);
    await sleep(1000); // Tunggu item drop
  }

  bot.on('error', err => console.log('[SiPenebang] Error:', err.message));
  bot.on('kicked', reason => console.log('[SiPenebang] Kicked:', reason));
  bot.on('end', createReconnectHandler(CONFIG, createBot));
}

createBot();
