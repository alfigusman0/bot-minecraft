const { goals } = require('mineflayer-pathfinder');
const { sleep } = require('../shared/utils');
const civ = require('../core/civilization');

const PREY = ['cow', 'chicken', 'pig', 'sheep', 'rabbit', 'salmon', 'cod'];
const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];

// Minimal hewan yang harus tersisa agar tidak punah
const MIN_POPULATION = 2;

module.exports = function huntingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function countNearby(mobName) {
    return Object.values(bot.entities).filter(
      e => e?.name?.toLowerCase() === mobName && bot.entity.position.distanceTo(e.position) < 32
    ).length;
  }

  function findPrey() {
    return Object.values(bot.entities).find(e => {
      if (!e?.name) return false;
      const name = e.name.toLowerCase();
      if (!PREY.includes(name)) return false;
      // Jangan bunuh jika populasinya sudah sedikit
      if (countNearby(name) <= MIN_POPULATION) return false;
      return bot.entity.position.distanceTo(e.position) < 32;
    });
  }

  function isViable() {
    // Cek apakah makanan sudah cukup
    const state = civ.getState();
    if (state.resources.food >= 32) return false;
    return !!findPrey();
  }

  async function run() {
    if (active) return;
    active = true;

    try {
      const prey = findPrey();

      if (!prey) {
        active = false;
        return;
      }

      console.log(`[${bot.username}] 🏹 Memburu: ${prey.name}`);

      // Equip sword terbaik
      for (const sword of SWORDS) {
        const item = bot.inventory.items().find(i => i.name === sword);
        if (item) {
          await bot.equip(item, 'hand');
          break;
        }
      }

      // Kejar dan serang
      await bot.pathfinder.goto(
        new goals.GoalNear(prey.position.x, prey.position.y, prey.position.z, 2)
      );

      // Serang beberapa kali sampai mati
      let attempts = 0;
      while (prey.isValid && attempts < 10) {
        bot.attack(prey);
        await sleep(700);
        attempts++;
      }

      await sleep(1000); // Tunggu item drop

      civ.addResources({ food: 3 });
      civ.addLog(`[${bot.username}] 🥩 Berburu ${prey.name} berhasil`);
    } catch (err) {
      console.log(`[${bot.username}] [hunting] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'hunting',
    label: '🏹 Hunting',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] 🏹 Mulai berburu`);
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
