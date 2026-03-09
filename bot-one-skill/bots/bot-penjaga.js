const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { sleep, createReconnectHandler } = require('../shared/utils');

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiPenjaga',
  auth: 'offline',
};

function createBot() {
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let isAttacking = false;

  // Mob hostile yang diserang
  const HOSTILE_MOBS = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'pillager'];

  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);
    const move = new Movements(bot, mcData);
    bot.pathfinder.setMovements(move);
    console.log(`[SiPenjaga] Siap berjaga! Versi: ${bot.version}`);
    guardLoop();
  });

  async function guardLoop() {
    while (true) {
      await sleep(1000);
      if (!bot.entity || isAttacking) continue;
      isAttacking = true;
      try {
        await attackNearestHostile();
      } catch (err) {
        console.log('[SiPenjaga] Error:', err.message);
      }
      isAttacking = false;
    }
  }

  async function attackNearestHostile() {
    // Cari mob hostile terdekat
    const hostile = Object.values(bot.entities).find(entity => {
      if (!entity || !entity.name) return false;
      if (entity.type !== 'mob') return false;
      const dist = bot.entity.position.distanceTo(entity.position);
      return HOSTILE_MOBS.includes(entity.name.toLowerCase()) && dist < 20;
    });

    if (!hostile) return;

    console.log(
      `[SiPenjaga] ⚔️ Menyerang: ${hostile.name} (${Math.round(bot.entity.position.distanceTo(hostile.position))} blok)`
    );

    // Equip sword terbaik
    const swords = ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
    for (const sword of swords) {
      const item = bot.inventory.items().find(i => i.name === sword);
      if (item) {
        await bot.equip(item, 'hand');
        break;
      }
    }

    // Kejar dan serang
    await bot.pathfinder.goto(
      new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2)
    );

    bot.attack(hostile);
    await sleep(600); // Cooldown serang
  }

  // Auto makan jika lapar
  bot.on('health', async () => {
    if (bot.food < 16) {
      const food = bot.inventory
        .items()
        .find(i =>
          ['bread', 'cooked_beef', 'cooked_chicken', 'apple', 'carrot', 'potato'].includes(i.name)
        );
      if (food) {
        await bot.equip(food, 'hand');
        bot.consume().catch(() => {});
      }
    }
  });

  bot.on('error', err => console.log('[SiPenjaga] Error:', err.message));
  bot.on('kicked', reason => console.log('[SiPenjaga] Kicked:', reason));
  bot.on('end', createReconnectHandler(CONFIG, createBot));
}

createBot();
