const { goals } = require('mineflayer-pathfinder');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');

const PREY = ['cow', 'chicken', 'pig', 'sheep', 'rabbit'];
const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
const MIN_POP = 2; // Sisakan minimal 2 hewan agar tidak punah

module.exports = function huntingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function countNearby(name) {
    return Object.values(bot.entities).filter(
      e => e?.name?.toLowerCase() === name && bot.entity.position.distanceTo(e.position) < 48
    ).length;
  }

  function findPrey() {
    return Object.values(bot.entities).find(e => {
      if (!e?.name) return false;
      const name = e.name.toLowerCase();
      if (!PREY.includes(name)) return false;
      if (countNearby(name) <= MIN_POP) return false;
      return bot.entity.position.distanceTo(e.position) < 32;
    });
  }

  function isViable() {
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

      // FIX BUG 2: Equip sword terbaik
      await equipBest(bot, SWORDS, 'hand');

      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(prey.position.x, prey.position.y, prey.position.z, 2)
        )
      );

      let attempts = 0;
      while (prey.isValid && attempts < 15) {
        bot.attack(prey);
        await waitMs(700);
        attempts++;
      }

      await waitMs(1000);
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
