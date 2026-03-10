const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { waitMs, equipBest, withUnstuck } = require('../shared/utils');
const civ = require('../core/civilization');

const MATERIALS = [
  'cobblestone',
  'stone',
  'dirt',
  'oak_planks',
  'spruce_planks',
  'smooth_stone',
  'bricks',
];

const BLUEPRINTS = {
  base: origin => {
    const bp = [];
    for (let x = 0; x < 7; x++)
      for (let z = 0; z < 7; z++) bp.push(new Vec3(origin.x + x, origin.y, origin.z + z));
    return bp;
  },
  wall: origin => {
    const bp = [];
    for (let x = 0; x < 9; x++)
      for (let h = 0; h < 3; h++) {
        bp.push(new Vec3(origin.x + x, origin.y + h, origin.z));
        bp.push(new Vec3(origin.x + x, origin.y + h, origin.z + 8));
      }
    for (let z = 1; z < 8; z++)
      for (let h = 0; h < 3; h++) {
        bp.push(new Vec3(origin.x, origin.y + h, origin.z + z));
        bp.push(new Vec3(origin.x + 8, origin.y + h, origin.z + z));
      }
    return bp;
  },
};

module.exports = function buildingSkill(bot, mcData) {
  let active = false;
  let interval = null;
  let blueprint = [];
  let origin = null;
  let bpIndex = 0;

  function isViable() {
    return bot.inventory.items().some(i => MATERIALS.includes(i.name));
  }

  function loadBlueprint() {
    const state = civ.getState();
    const base = origin || bot.entity.position.floored().offset(-3, -1, -3);
    blueprint = state.structures.farm ? BLUEPRINTS.wall(base) : BLUEPRINTS.base(base);
    bpIndex = 0;
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      if (!blueprint.length) loadBlueprint();

      const material = bot.inventory.items().find(i => MATERIALS.includes(i.name));
      if (!material) {
        active = false;
        return;
      }

      await bot.equip(material, 'hand');

      let placed = 0;
      while (bpIndex < blueprint.length && placed < 5) {
        const pos = blueprint[bpIndex++];
        const block = bot.blockAt(pos);
        if (block && block.name !== 'air') continue;

        try {
          await withUnstuck(bot, () =>
            bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3))
          );
          const below = bot.blockAt(pos.offset(0, -1, 0));
          if (!below || below.name === 'air') continue;
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          await waitMs(250);
          placed++;
          civ.addResources({ cobblestone: -1 });
        } catch (_) {}
      }

      if (bpIndex >= blueprint.length) {
        const state = civ.getState();
        if (!state.structures.farm) {
          civ.updateState(s => {
            s.structures.farm = true;
          });
          civ.addLog(`[${bot.username}] 🏗️ Base selesai!`);
        } else if (!state.structures.wall) {
          civ.updateState(s => {
            s.structures.wall = true;
          });
          civ.addLog(`[${bot.username}] 🏗️ Tembok selesai!`);
        }
        blueprint = [];
        bpIndex = 0;
      }
    } catch (err) {
      console.log(`[${bot.username}] [building] ${err.message}`);
    }
    active = false;
  }

  return {
    name: 'building',
    label: '🧱 Building',
    isViable,
    setOrigin(pos) {
      origin = pos;
      blueprint = [];
      bpIndex = 0;
    },
    start() {
      civ.addLog(`[${bot.username}] 🧱 Mulai building`);
      loadBlueprint();
      interval = setInterval(run, 4000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
