const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep } = require('../shared/utils');

module.exports = function farmingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  async function run() {
    if (active) return;
    active = true;

    const cropId = mcData.blocksByName['wheat']?.id;
    if (!cropId) {
      active = false;
      return;
    }

    // Cari mature wheat
    let block = bot.findBlock({
      matching: cropId,
      maxDistance: 32,
      useExtraInfo: b => b.getProperties().age === 7,
    });

    // Kalau tidak ada mature, bone meal tanaman muda
    if (!block) {
      const youngBlock = bot.findBlock({
        matching: cropId,
        maxDistance: 32,
        useExtraInfo: b => b.getProperties().age < 7,
      });

      if (youngBlock) {
        const boneMeal = bot.inventory.items().find(i => i.name === 'bone_meal');
        if (boneMeal) {
          await bot.equip(boneMeal, 'hand');
          await bot.pathfinder.goto(
            new goals.GoalNear(
              youngBlock.position.x,
              youngBlock.position.y,
              youngBlock.position.z,
              2
            )
          );
          await bot.activateBlock(youngBlock);
          bot.chat('🦴 Bone meal digunakan!');
        } else {
          bot.chat('Tidak ada tanaman mature & kehabisan bone meal.');
        }
      } else {
        bot.chat('Tidak ada wheat di sekitar.');
      }
      active = false;
      return;
    }

    const pos = block.position;
    try {
      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
      const fresh = bot.blockAt(pos);
      if (!fresh || fresh.getProperties().age !== 7) {
        active = false;
        return;
      }

      await bot.dig(fresh);
      bot.chat(`✅ Panen di (${pos.x}, ${pos.y}, ${pos.z})`);
      await sleep(600);

      const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
      if (seeds) {
        await bot.equip(seeds, 'hand');
        const ground = bot.blockAt(pos);
        if (ground?.name === 'farmland') {
          await bot.placeBlock(ground, new Vec3(0, 1, 0));
          bot.chat(`🌱 Tanam ulang di (${pos.x}, ${pos.y}, ${pos.z})`);
        }
      } else {
        bot.chat('⚠️ Habis benih!');
      }
    } catch (err) {
      bot.chat(`Error farming: ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'farming',
    start() {
      bot.chat('🌾 Mulai farming!');
      interval = setInterval(run, 2000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      bot.chat('🛑 Stop farming.');
    },
  };
};
