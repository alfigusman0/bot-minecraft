const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep, createReconnectHandler } = require('../shared/utils');

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiPetani',
  auth: 'offline',
};

function createBot() {
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let isFarming = false;

  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);
    const move = new Movements(bot, mcData);
    move.canDig = true;
    bot.pathfinder.setMovements(move);
    console.log(`[SiPetani] Siap farming! Versi: ${bot.version}`);
    farmingLoop();
  });

  async function farmingLoop() {
    while (true) {
      await sleep(2000);
      if (!bot.entity || isFarming) continue;
      isFarming = true;
      try {
        await doFarming();
      } catch (err) {
        console.log('[SiPetani] Error:', err.message);
      }
      isFarming = false;
    }
  }

  async function doFarming() {
    const cropId = mcData.blocksByName['wheat']?.id;
    if (!cropId) return;

    const block = bot.findBlock({
      matching: cropId,
      maxDistance: 32,
      useExtraInfo: b => b.getProperties().age === 7,
    });

    if (!block) {
      console.log('[SiPetani] Tidak ada tanaman siap panen.');
      return;
    }

    const pos = block.position;
    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

    const fresh = bot.blockAt(pos);
    if (!fresh || fresh.getProperties().age !== 7) return;

    await bot.dig(fresh);
    console.log(`[SiPetani] ✅ Panen di (${pos.x}, ${pos.y}, ${pos.z})`);
    await sleep(600);

    const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
    if (!seeds) {
      console.log('[SiPetani] ⚠️ Habis benih!');
      return;
    }

    await bot.equip(seeds, 'hand');
    const ground = bot.blockAt(pos);
    if (ground?.name === 'farmland') {
      try {
        await bot.placeBlock(ground, new Vec3(0, 1, 0));
        console.log(`[SiPetani] 🌱 Tanam di (${pos.x}, ${pos.y}, ${pos.z})`);
      } catch (e) {
        console.log('[SiPetani] Gagal tanam:', e.message);
      }
    }
  }

  bot.on('error', err => console.log('[SiPetani] Error:', err.message));
  bot.on('kicked', reason => console.log('[SiPetani] Kicked:', reason));
  bot.on('end', createReconnectHandler(CONFIG, createBot));
}

createBot();
