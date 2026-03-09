const { goals } = require('mineflayer-pathfinder');
const { sleep } = require('../shared/utils');

const HOSTILE_MOBS = [
  'zombie',
  'skeleton',
  'spider',
  'creeper',
  'enderman',
  'witch',
  'pillager',
  'husk',
  'stray',
  'drowned',
  'phantom',
];
const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
const FOODS = [
  'golden_apple',
  'cooked_beef',
  'cooked_chicken',
  'bread',
  'apple',
  'carrot',
  'potato',
];

module.exports = function combatSkill(bot, mcData) {
  let active = false;
  let interval = null;

  async function run() {
    if (active) return;
    active = true;

    // Auto makan jika lapar
    if (bot.food < 16) {
      const food = bot.inventory.items().find(i => FOODS.includes(i.name));
      if (food) {
        await bot.equip(food, 'hand');
        await bot.consume().catch(() => {});
      }
    }

    // Cari hostile mob
    const hostile = Object.values(bot.entities).find(e => {
      if (!e?.name || e.type !== 'mob') return false;
      return (
        HOSTILE_MOBS.includes(e.name.toLowerCase()) &&
        bot.entity.position.distanceTo(e.position) < 24
      );
    });

    if (!hostile) {
      active = false;
      return;
    }

    const dist = bot.entity.position.distanceTo(hostile.position).toFixed(1);
    bot.chat(`⚔️ Menyerang ${hostile.name} (${dist} blok)`);

    // Equip sword terbaik
    for (const sword of SWORDS) {
      const item = bot.inventory.items().find(i => i.name === sword);
      if (item) {
        await bot.equip(item, 'hand');
        break;
      }
    }

    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2)
      );
      bot.attack(hostile);
      await sleep(600);
    } catch (err) {
      bot.chat(`Error combat: ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'combat',
    start() {
      bot.chat('⚔️ Mode tempur aktif!');
      interval = setInterval(run, 1000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      bot.chat('🛑 Stop combat.');
    },
  };
};
