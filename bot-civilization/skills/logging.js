const { goals } = require('mineflayer-pathfinder');
const { sleep } = require('../shared/utils');
const civ = require('../core/civilization');

const WOOD_TYPES = [
  'oak_log',
  'birch_log',
  'spruce_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'cherry_log',
];
const AXES = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];

// Blok yang menandakan area bangunan/struktur buatan — jangan ditebang
const STRUCTURE_BLOCKS = [
  'oak_door',
  'birch_door',
  'spruce_door',
  'iron_door',
  'glass',
  'glass_pane',
  'oak_stairs',
  'cobblestone_stairs',
  'oak_planks',
  'birch_planks',
  'spruce_planks',
  'bookshelf',
  'crafting_table',
  'furnace',
  'chest',
  'torch',
  'lantern',
  'bed',
  'cobblestone_wall',
  'stone_bricks',
  'mossy_cobblestone',
];

module.exports = function loggingSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function isViable() {
    const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
    const found = bot.findBlock({
      matching: logIds,
      maxDistance: 32,
      useExtraInfo: b => !isNearStructure(b.position),
    });
    return !!found;
  }

  /**
   * Cek apakah posisi ini dekat dengan struktur bangunan/villager
   * Jika ya, berarti kayu ini bagian dari rumah — jangan ditebang
   */
  function isNearStructure(pos) {
    // Cek ada villager dalam radius 8 blok dari pohon
    const nearVillager = Object.values(bot.entities).some(e => {
      if (!e?.name) return false;
      const name = e.name.toLowerCase();
      return ['villager', 'wandering_trader'].includes(name) && pos.distanceTo(e.position) < 8;
    });
    if (nearVillager) return true;

    // Cek ada blok struktur dalam radius 4 blok
    const structureIds = STRUCTURE_BLOCKS.map(b => mcData.blocksByName[b]?.id).filter(Boolean);

    if (structureIds.length === 0) return false;

    const nearStructure = bot.findBlock({
      matching: structureIds,
      maxDistance: 4,
      useExtraInfo: b => b.position.distanceTo(pos) <= 4,
    });

    return !!nearStructure;
  }

  async function run() {
    if (active) return;
    active = true;

    try {
      const logIds = WOOD_TYPES.map(w => mcData.blocksByName[w]?.id).filter(Boolean);
      const logBlock = bot.findBlock({
        matching: logIds,
        maxDistance: 32,
        useExtraInfo: b => !isNearStructure(b.position),
      });

      if (!logBlock) {
        console.log(`[${bot.username}] Tidak ada pohon yang aman untuk ditebang.`);
        active = false;
        return;
      }

      // Equip axe terbaik
      for (const axe of AXES) {
        const tool = bot.inventory.items().find(i => i.name === axe);
        if (tool) {
          await bot.equip(tool, 'hand');
          break;
        }
      }

      const pos = logBlock.position;

      // Cek sekali lagi sebelum tebang
      if (isNearStructure(pos)) {
        console.log(
          `[${bot.username}] 🚫 Skip pohon di (${pos.x},${pos.y},${pos.z}) — dekat struktur`
        );
        active = false;
        return;
      }

      await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

      let currentPos = pos.clone();
      let count = 0;

      while (count < 15) {
        const current = bot.blockAt(currentPos);
        if (!current || !WOOD_TYPES.includes(current.name)) break;

        // Cek lagi per-blok saat menebang
        if (isNearStructure(currentPos)) break;

        await bot.dig(current);
        await sleep(300);
        currentPos = currentPos.offset(0, 1, 0);
        count++;
      }

      if (count > 0) {
        await sleep(800);
        civ.addResources({ wood: count });
        civ.addLog(`[${bot.username}] 🪓 Tebang ${count} log di (${pos.x},${pos.y},${pos.z})`);
      }
    } catch (err) {
      console.log(`[${bot.username}] [logging] ${err.message}`);
    }

    active = false;
  }

  return {
    name: 'logging',
    label: '🪓 Logging',
    isViable,
    start() {
      civ.addLog(`[${bot.username}] 🪓 Mulai logging`);
      interval = setInterval(run, 3000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
