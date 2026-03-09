const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const bot = mineflayer.createBot({
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiPetani',
  auth: 'offline',
});

bot.loadPlugin(pathfinder);

let mcData;
let isFarming = false;

bot.on('spawn', () => {
  mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  defaultMove.canDig = true;
  bot.pathfinder.setMovements(defaultMove);

  console.log(`Bot spawned! Versi: ${bot.version}`);
  farmingLoop();
});

async function farmingLoop() {
  while (true) {
    await sleep(2000);

    if (!bot.entity || isFarming) continue;

    isFarming = true;
    try {
      await doFarming();
    } catch (err) {
      console.log('Error farming loop:', err.message);
    }
    isFarming = false;
  }
}

async function doFarming() {
  const cropType = 'wheat';
  const cropId = mcData.blocksByName[cropType]?.id;

  if (!cropId) {
    console.log('Crop tidak ditemukan di mcData!');
    return;
  }

  // Cari tanaman dewasa (metadata/age = 7)
  const blockToHarvest = bot.findBlock({
    matching: cropId,
    maxDistance: 16,
    useExtraInfo: b => b.getProperties().age === 7,
  });

  if (!blockToHarvest) {
    console.log('Tidak ada tanaman siap panen di sekitar.');
    return;
  }

  // Pergi ke dekat tanaman (1 blok di bawahnya agar bisa menjangkau)
  const pos = blockToHarvest.position;
  await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

  // Pastikan blok masih mature setelah jalan
  const freshBlock = bot.blockAt(pos);
  if (!freshBlock || freshBlock.getProperties().age !== 7) {
    console.log('Tanaman sudah dipanen orang lain.');
    return;
  }

  // Panen
  await bot.dig(freshBlock);
  console.log(`✅ Memanen di (${pos.x}, ${pos.y}, ${pos.z})`);

  await sleep(600); // Tunggu item drop

  // Tanam ulang
  const seeds = bot.inventory.items().find(item => item.name === 'wheat_seeds');
  if (!seeds) {
    console.log('⚠️  Habis benih!');
    return;
  }

  await bot.equip(seeds, 'hand');

  // Cek apakah blok sekarang farmland (siap ditanam)
  const groundBlock = bot.blockAt(pos);
  if (groundBlock?.name === 'farmland') {
    try {
      await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
      console.log(`🌱 Menanam benih di (${pos.x}, ${pos.y}, ${pos.z})`);
    } catch (e) {
      console.log('Gagal menanam:', e.message);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

bot.on('error', err => console.log('Bot error:', err));
bot.on('kicked', reason => console.log('Bot kicked:', reason));
bot.on('end', () => {
  console.log('Koneksi terputus. Reconnect dalam 5 detik...');
  setTimeout(() => {
    bot.connect();
  }, 5000);
});
