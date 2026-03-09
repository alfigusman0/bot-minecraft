const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep, createReconnectHandler } = require('../shared/utils');

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiBuilder',
  auth: 'offline',
};

function createBot() {
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let isBuilding = false;

  // Koordinat area membangun (sesuaikan dengan server kamu)
  const BUILD_ORIGIN = new Vec3(100, 64, 100);

  // Blueprint: platform 5x5 dari cobblestone
  const BLUEPRINT = [];
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      BLUEPRINT.push(new Vec3(BUILD_ORIGIN.x + x, BUILD_ORIGIN.y, BUILD_ORIGIN.z + z));
    }
  }

  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);
    const move = new Movements(bot, mcData);
    bot.pathfinder.setMovements(move);
    console.log(`[SiBuilder] Siap membangun! Versi: ${bot.version}`);
    buildLoop();
  });

  async function buildLoop() {
    while (true) {
      await sleep(5000);
      if (!bot.entity || isBuilding) continue;
      isBuilding = true;
      try {
        await buildPlatform();
      } catch (err) {
        console.log('[SiBuilder] Error:', err.message);
      }
      isBuilding = false;
    }
  }

  async function buildPlatform() {
    // Cari bahan bangunan di inventory
    const material = bot.inventory
      .items()
      .find(i => ['cobblestone', 'stone', 'dirt', 'oak_planks'].includes(i.name));

    if (!material) {
      console.log('[SiBuilder] ⚠️ Tidak ada material!');
      return;
    }

    await bot.equip(material, 'hand');

    for (const pos of BLUEPRINT) {
      const block = bot.blockAt(pos);

      // Skip jika sudah ada blok di sini
      if (block && block.name !== 'air') continue;

      // Pergi ke dekat posisi
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));

      // Blok di bawah tempat kita akan menempatkan
      const below = bot.blockAt(pos.offset(0, -1, 0));
      if (!below || below.name === 'air') continue;

      try {
        await bot.placeBlock(below, new Vec3(0, 1, 0));
        console.log(`[SiBuilder] 🧱 Pasang blok di (${pos.x}, ${pos.y}, ${pos.z})`);
        await sleep(300);
      } catch (e) {
        console.log('[SiBuilder] Gagal pasang:', e.message);
      }
    }

    console.log('[SiBuilder] ✅ Platform selesai dibangun!');
  }

  bot.on('error', err => console.log('[SiBuilder] Error:', err.message));
  bot.on('kicked', reason => console.log('[SiBuilder] Kicked:', reason));
  bot.on('end', createReconnectHandler(CONFIG, createBot));
}

createBot();
