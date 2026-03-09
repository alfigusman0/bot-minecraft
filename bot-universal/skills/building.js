const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { sleep } = require('../shared/utils');

const MATERIALS = ['cobblestone', 'stone', 'dirt', 'oak_planks', 'spruce_planks', 'smooth_stone'];

module.exports = function buildingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let blueprint = [];
  let origin = null;

  function generateBlueprint(org, width = 5, length = 5) {
    const bp = [];
    for (let x = 0; x < width; x++)
      for (let z = 0; z < length; z++) bp.push(new Vec3(org.x + x, org.y, org.z + z));
    return bp;
  }

  async function run() {
    if (active || blueprint.length === 0) return;
    active = true;

    const material = bot.inventory.items().find(i => MATERIALS.includes(i.name));
    if (!material) {
      bot.chat('⚠️ Tidak ada material bangunan!');
      active = false;
      return;
    }

    await bot.equip(material, 'hand');

    for (const pos of blueprint) {
      const block = bot.blockAt(pos);
      if (block && block.name !== 'air') continue;

      try {
        await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
        const below = bot.blockAt(pos.offset(0, -1, 0));
        if (!below || below.name === 'air') continue;
        await bot.placeBlock(below, new Vec3(0, 1, 0));
        bot.chat(`🧱 Pasang blok di (${pos.x}, ${pos.y}, ${pos.z})`);
        await sleep(300);
      } catch (e) {
        // skip posisi gagal
      }
    }

    bot.chat('✅ Satu siklus build selesai!');
    active = false;
  }

  return {
    name: 'building',
    setOrigin(pos) {
      origin = pos;
      blueprint = generateBlueprint(pos);
      bot.chat(
        `📐 Origin build diset ke (${pos.x}, ${pos.y}, ${pos.z}), blueprint ${blueprint.length} blok.`
      );
    },
    start() {
      if (!origin) {
        bot.chat('⚠️ Set origin dulu! Ketik: !build set');
        return;
      }
      bot.chat('🧱 Mulai building!');
      interval = setInterval(run, 5000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
      bot.chat('🛑 Stop building.');
    },
  };
};
