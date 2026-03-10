const { goals } = require('mineflayer-pathfinder');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');

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
  'cave_spider',
];

const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
const ARMORS = {
  head: [
    'netherite_helmet',
    'diamond_helmet',
    'iron_helmet',
    'golden_helmet',
    'chainmail_helmet',
    'leather_helmet',
  ],
  torso: [
    'netherite_chestplate',
    'diamond_chestplate',
    'iron_chestplate',
    'golden_chestplate',
    'chainmail_chestplate',
    'leather_chestplate',
  ],
  legs: [
    'netherite_leggings',
    'diamond_leggings',
    'iron_leggings',
    'golden_leggings',
    'chainmail_leggings',
    'leather_leggings',
  ],
  feet: [
    'netherite_boots',
    'diamond_boots',
    'iron_boots',
    'golden_boots',
    'chainmail_boots',
    'leather_boots',
  ],
};
const FOODS = [
  'golden_apple',
  'cooked_beef',
  'cooked_porkchop',
  'cooked_chicken',
  'bread',
  'apple',
  'carrot',
  'potato',
];

module.exports = function combatSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function getNearestHostile() {
    return Object.values(bot.entities).find(e => {
      if (!e?.name || e.type !== 'mob') return false;
      return (
        HOSTILE_MOBS.includes(e.name.toLowerCase()) &&
        bot.entity.position.distanceTo(e.position) < 24
      );
    });
  }

  function isViable() {
    return !!getNearestHostile();
  }

  async function equipArmor() {
    // FIX BUG 2: Auto-equip armor terbaik
    await equipBest(bot, ARMORS.head, 'head');
    await equipBest(bot, ARMORS.torso, 'torso');
    await equipBest(bot, ARMORS.legs, 'legs');
    await equipBest(bot, ARMORS.feet, 'feet');
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      // Auto makan jika lapar
      if (bot.food < 14) {
        const food = bot.inventory.items().find(i => FOODS.includes(i.name));
        if (food) {
          await bot.equip(food, 'hand');
          await bot.consume().catch(() => {});
        }
      }

      await equipArmor();

      const hostile = getNearestHostile();
      if (!hostile) {
        civ.updateState(s => {
          s.threats.hostileMobs = false;
        });
        active = false;
        return;
      }

      // FIX BUG 2: Equip sword terbaik
      await equipBest(bot, SWORDS, 'hand');

      await withUnstuck(bot, () =>
        bot.pathfinder.goto(
          new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2)
        )
      );

      if (hostile.isValid) {
        bot.attack(hostile);
        civ.updateState(s => {
          s.threats.hostileMobs = true;
        });
      }
      await waitMs(600);
    } catch (err) {
      console.log(`[${bot.username}] [combat] ${err.message}`);
    }
    active = false;
  }

  return {
    name: 'combat',
    label: '⚔️ Combat',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] ⚔️ Mulai combat`);
      interval = setInterval(run, 800);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      civ.updateState(s => {
        s.threats.hostileMobs = false;
      });
    },
  };
};
