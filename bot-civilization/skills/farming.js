const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');

const CROP_TYPES = [
  { name: 'wheat', seedName: 'wheat_seeds', matureAge: 7 },
  { name: 'carrots', seedName: 'carrot', matureAge: 7 },
  { name: 'potatoes', seedName: 'potato', matureAge: 7 },
  { name: 'beetroots', seedName: 'beetroot_seeds', matureAge: 3 },
];

module.exports = function farmingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function isViable() {
    for (const crop of CROP_TYPES) {
      const id = mcData.blocksByName[crop.name]?.id;
      if (!id) continue;
      if (bot.findBlock({ matching: id, maxDistance: 32 })) return true;
    }
    return bot.inventory
      .items()
      .some(i => CROP_TYPES.some(c => c.seedName === i.name) || i.name === 'bone_meal');
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      for (const crop of CROP_TYPES) {
        const cropId = mcData.blocksByName[crop.name]?.id;
        if (!cropId) continue;

        const mature = bot.findBlock({
          matching: cropId,
          maxDistance: 32,
          useExtraInfo: b => b.getProperties().age === crop.matureAge,
        });

        if (mature) {
          const pos = mature.position;
          await withUnstuck(bot, () =>
            bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
          );
          const fresh = bot.blockAt(pos);
          if (!fresh || fresh.getProperties().age !== crop.matureAge) continue;
          await bot.dig(fresh);
          await waitMs(600);

          const seed = bot.inventory.items().find(i => i.name === crop.seedName);
          if (seed) {
            await bot.equip(seed, 'hand');
            const ground = bot.blockAt(pos);
            if (ground?.name === 'farmland') {
              await bot.placeBlock(ground, new Vec3(0, 1, 0));
            }
          }
          civ.addResources({ wheat: 1, food: 1 });
          civ.addLog(`[${bot.username}] 🌾 Panen ${crop.name}`);
          break;
        }

        // Tidak ada mature → bone meal
        const young = bot.findBlock({
          matching: cropId,
          maxDistance: 32,
          useExtraInfo: b => b.getProperties().age < crop.matureAge,
        });
        if (young) {
          const boneMeal = bot.inventory.items().find(i => i.name === 'bone_meal');
          if (boneMeal) {
            await bot.equip(boneMeal, 'hand');
            await withUnstuck(bot, () =>
              bot.pathfinder.goto(
                new goals.GoalNear(young.position.x, young.position.y, young.position.z, 2)
              )
            );
            await bot.activateBlock(young);
            break;
          }
        }
      }
    } catch (err) {
      console.log(`[${bot.username}] [farming] ${err.message}`);
    }
    active = false;
  }

  return {
    name: 'farming',
    label: '🌾 Farming',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] 🌾 Mulai farming`);
      interval = setInterval(run, 2500);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
