const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: 'SiPetani', // ← ganti username bot yang mau didebug
  auth: 'offline',
  version: '1.21.1', // ← paksa versi eksplisit
};

function createBot() {
  console.log(`[DEBUG] Mencoba connect ke ${CONFIG.host}:${CONFIG.port}...`);
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;

  // =====================
  // EVENT: LOGIN
  // =====================
  bot.on('login', () => {
    console.log(`[✅ LOGIN] Bot berhasil login sebagai: ${bot.username}`);
  });

  // =====================
  // EVENT: SPAWN
  // =====================
  bot.on('spawn', () => {
    console.log('='.repeat(50));
    console.log(`[✅ SPAWN] Bot spawned!`);
    console.log(`[INFO] Username  : ${bot.username}`);
    console.log(`[INFO] Version   : ${bot.version}`);
    console.log(`[INFO] Position  : ${JSON.stringify(bot.entity.position)}`);
    console.log(`[INFO] Health    : ${bot.health}`);
    console.log(`[INFO] Food      : ${bot.food}`);
    console.log(`[INFO] GameMode  : ${bot.game?.gameMode}`);
    console.log('='.repeat(50));

    mcData = require('minecraft-data')(bot.version);

    if (!mcData) {
      console.log('[❌ ERROR] mcData gagal dimuat!');
      return;
    }
    console.log(`[✅ mcData] Berhasil dimuat untuk versi ${bot.version}`);

    // Cek wheat tersedia di mcData
    const wheatData = mcData.blocksByName['wheat'];
    console.log(
      `[INFO] wheat block data: ${wheatData ? JSON.stringify(wheatData) : '❌ TIDAK DITEMUKAN'}`
    );

    // Setup pathfinder
    try {
      const move = new Movements(bot, mcData);
      move.canDig = true;
      bot.pathfinder.setMovements(move);
      console.log('[✅ PATHFINDER] Movements berhasil di-set');
    } catch (err) {
      console.log('[❌ PATHFINDER] Gagal setup movements:', err.message);
    }

    // Print inventory
    printInventory();

    // Mulai debug loop
    console.log('[INFO] Memulai debug loop...');
    debugLoop();
  });

  // =====================
  // DEBUG LOOP UTAMA
  // =====================
  async function debugLoop() {
    let tick = 0;

    while (true) {
      await sleep(3000);
      tick++;

      console.log(`\n${'─'.repeat(50)}`);
      console.log(`[🔄 TICK #${tick}] ${new Date().toLocaleTimeString()}`);

      // Cek bot entity
      if (!bot.entity) {
        console.log('[❌] bot.entity adalah NULL, skip...');
        continue;
      }

      const pos = bot.entity.position;
      console.log(`[📍 POS] x:${pos.x.toFixed(2)} y:${pos.y.toFixed(2)} z:${pos.z.toFixed(2)}`);
      console.log(`[❤️  HP] Health: ${bot.health} | Food: ${bot.food}`);
      console.log(`[🎮 MODE] GameMode: ${bot.game?.gameMode}`);

      // Cek mcData
      if (!mcData) {
        console.log('[❌] mcData NULL, skip...');
        continue;
      }

      // =====================
      // TEST 1: findBlock
      // =====================
      console.log('\n[TEST 1] Mencari wheat block...');
      const cropId = mcData.blocksByName['wheat']?.id;
      console.log(`[INFO] wheat ID: ${cropId}`);

      const anyWheat = bot.findBlock({
        matching: cropId,
        maxDistance: 32,
      });
      console.log(
        `[INFO] Wheat (any age) dalam 32 blok: ${anyWheat ? `✅ DITEMUKAN di ${JSON.stringify(anyWheat.position)}` : '❌ TIDAK ADA'}`
      );

      const matureWheat = bot.findBlock({
        matching: cropId,
        maxDistance: 32,
        useExtraInfo: b => {
          const age = b.getProperties().age;
          return age === 7;
        },
      });
      console.log(
        `[INFO] Wheat MATURE (age=7) dalam 32 blok: ${matureWheat ? `✅ DITEMUKAN di ${JSON.stringify(matureWheat.position)}` : '❌ TIDAK ADA'}`
      );

      // Scan semua wheat di sekitar beserta usianya
      if (anyWheat) {
        console.log('[INFO] Scan wheat terdekat:');
        for (let r = 5; r <= 32; r += 5) {
          const found = bot.findBlock({ matching: cropId, maxDistance: r });
          if (found) {
            const age = found.getProperties().age;
            console.log(`  → Radius ${r}: wheat di ${JSON.stringify(found.position)}, age=${age}`);
            break;
          }
        }
      }

      // =====================
      // TEST 2: Inventory
      // =====================
      console.log('\n[TEST 2] Inventory:');
      printInventory();

      // =====================
      // TEST 3: Pathfinder test
      // =====================
      console.log('\n[TEST 3] Test pathfinder gerak kecil...');
      try {
        const target = new Vec3(Math.round(pos.x) + 2, Math.round(pos.y), Math.round(pos.z));
        console.log(`[INFO] Mencoba GoalNear ke ${JSON.stringify(target)}`);
        await Promise.race([
          bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 1)),
          sleep(5000), // timeout 5 detik
        ]);
        console.log('[✅ PATHFINDER] Berhasil bergerak!');
      } catch (err) {
        console.log('[❌ PATHFINDER] Gagal gerak:', err.message);
      }

      // =====================
      // TEST 4: Cek nearby entities
      // =====================
      console.log('\n[TEST 4] Entitas di sekitar (radius 10):');
      const nearbyEntities = Object.values(bot.entities).filter(e => {
        if (!e || e === bot.entity) return false;
        return bot.entity.position.distanceTo(e.position) < 10;
      });

      if (nearbyEntities.length === 0) {
        console.log('[INFO] Tidak ada entitas di sekitar.');
      } else {
        nearbyEntities.forEach(e => {
          const dist = bot.entity.position.distanceTo(e.position).toFixed(1);
          console.log(`  → ${e.name || e.type} (${e.type}) — ${dist} blok`);
        });
      }

      // Hanya jalankan 5 tick lalu stop debug loop
      if (tick >= 5) {
        console.log('\n[✅ DEBUG SELESAI] 5 tick sudah dijalankan.');
        console.log('[INFO] Semua test selesai. Periksa log di atas untuk diagnosis.');
        break;
      }
    }
  }

  // =====================
  // HELPER: Print Inventory
  // =====================
  function printInventory() {
    const items = bot.inventory.items();
    if (items.length === 0) {
      console.log('[⚠️  INVENTORY] Kosong!');
    } else {
      console.log(`[📦 INVENTORY] ${items.length} item:`);
      items.forEach(item => {
        console.log(`  → ${item.name} x${item.count}`);
      });
    }
  }

  // =====================
  // EVENT LAINNYA
  // =====================
  bot.on('health', () => {
    if (bot.health < 10) {
      console.log(`[⚠️  HEALTH] HP rendah: ${bot.health}`);
    }
  });

  bot.on('death', () => {
    console.log('[💀 DEATH] Bot mati!');
  });

  bot.on('respawn', () => {
    console.log('[🔄 RESPAWN] Bot respawn');
  });

  bot.on('kicked', reason => {
    console.log('[🚫 KICKED]', reason);
  });

  bot.on('error', err => {
    console.log('[❌ ERROR]', err.message);
  });

  bot.on('end', reason => {
    console.log('[🔌 END] Koneksi terputus:', reason);
    console.log('[INFO] Reconnect dalam 10 detik...');
    setTimeout(createBot, 10000);
  });

  // Timeout jika tidak spawn dalam 30 detik
  setTimeout(() => {
    if (!bot.entity) {
      console.log('[❌ TIMEOUT] Bot tidak spawn dalam 30 detik! Cek koneksi/server.');
    }
  }, 30000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

createBot();
