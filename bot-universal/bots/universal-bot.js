const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const farmingSkill = require('../skills/farming');
const miningSkill = require('../skills/mining');
const loggingSkill = require('../skills/logging');
const combatSkill = require('../skills/combat');
const buildingSkill = require('../skills/building');

// =============================================
// KONFIGURASI — sesuaikan per instance
// =============================================
const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: process.env.BOT_USERNAME || 'SiPetani',
  auth: 'offline',
  version: '1.21.11',
};

// Owner yang boleh kasih perintah
const OWNERS = ['aLG30'];

function createBot() {
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let skills = {};
  let currentSkill = null; // skill yang sedang aktif
  let autoMode = false; // mode otomatis (bot pilih skill sendiri)

  // =============================================
  // SPAWN
  // =============================================
  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);
    const move = new Movements(bot, mcData);
    move.canDig = true;
    bot.pathfinder.setMovements(move);

    // Daftarkan semua skill
    skills = {
      farming: farmingSkill(bot, mcData),
      mining: miningSkill(bot, mcData),
      logging: loggingSkill(bot, mcData),
      combat: combatSkill(bot, mcData),
      building: buildingSkill(bot, mcData),
    };

    console.log(
      `[${bot.username}] ✅ Spawned | Versi: ${bot.version} | Pos: ${JSON.stringify(bot.entity.position)}`
    );
    bot.chat(`Halo! Saya ${bot.username} siap bekerja. Ketik !help untuk daftar perintah.`);
  });

  // =============================================
  // RESPAWN & DEATH
  // =============================================
  bot.on('death', async () => {
    console.log(`[${bot.username}] 💀 Mati! Menghentikan semua skill...`);
    stopCurrentSkill();
    await sleep(2000);
    bot.respawn();
  });

  bot.on('respawn', async () => {
    console.log(`[${bot.username}] 🔄 Respawn`);
    await sleep(1500);
    bot.chat('Sudah respawn!');
  });

  // =============================================
  // CHAT COMMAND HANDLER
  // =============================================
  bot.on('chat', async (username, message) => {
    // Abaikan pesan dari diri sendiri
    if (username === bot.username) return;

    // Hanya owner yang bisa kasih perintah
    if (!OWNERS.includes(username)) return;

    const args = message.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();

    if (!cmd.startsWith('!')) return;

    console.log(`[${bot.username}] Perintah dari ${username}: ${message}`);

    switch (cmd) {
      // ── HELP ──────────────────────────────────
      case '!help':
        bot.chat('=== Daftar Perintah ===');
        bot.chat('!do <skill> — Aktifkan skill (farming/mining/logging/combat/building)');
        bot.chat('!stop — Hentikan skill saat ini');
        bot.chat('!status — Cek status bot');
        bot.chat('!auto — Mode otomatis (bot pilih skill sendiri)');
        bot.chat('!tp <x> <y> <z> — Teleport bot');
        bot.chat('!come — Bot datang ke posisimu');
        bot.chat('!follow <player> — Bot follow player');
        bot.chat('!unfollow — Berhenti follow');
        bot.chat('!inv — Lihat inventory');
        bot.chat('!drop <item> — Buang item');
        bot.chat('!eat — Makan jika lapar');
        bot.chat('!build set — Set origin build di posisi sekarang');
        bot.chat('!say <pesan> — Bot ngomong di chat');
        bot.chat('!skills — Daftar skill tersedia');
        break;

      // ── SKILLS LIST ───────────────────────────
      case '!skills':
        bot.chat(`Skill tersedia: ${Object.keys(skills).join(', ')}`);
        bot.chat(`Skill aktif: ${currentSkill || 'tidak ada'}`);
        break;

      // ── DO <skill> ────────────────────────────
      case '!do': {
        const skillName = args[1]?.toLowerCase();
        if (!skillName || !skills[skillName]) {
          bot.chat(`Skill tidak ditemukan! Tersedia: ${Object.keys(skills).join(', ')}`);
          break;
        }
        stopCurrentSkill();
        currentSkill = skillName;
        autoMode = false;
        skills[skillName].start();
        break;
      }

      // ── STOP ──────────────────────────────────
      case '!stop':
        stopCurrentSkill();
        autoMode = false;
        bot.chat('Semua skill dihentikan.');
        break;

      // ── STATUS ────────────────────────────────
      case '!status': {
        const pos = bot.entity.position;
        bot.chat(`=== Status ${bot.username} ===`);
        bot.chat(`Posisi: ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`);
        bot.chat(`HP: ${bot.health} | Food: ${bot.food}`);
        bot.chat(`Skill aktif: ${currentSkill || 'tidak ada'}`);
        bot.chat(`Auto mode: ${autoMode ? 'ON' : 'OFF'}`);
        bot.chat(`GameMode: ${bot.game?.gameMode}`);
        break;
      }

      // ── AUTO MODE ─────────────────────────────
      case '!auto':
        autoMode = !autoMode;
        if (autoMode) {
          bot.chat('🤖 Auto mode ON! Bot akan pilih skill sendiri.');
          runAutoMode();
        } else {
          stopCurrentSkill();
          bot.chat('🤖 Auto mode OFF.');
        }
        break;

      // ── TELEPORT ──────────────────────────────
      case '!tp': {
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          bot.chat('Format: !tp <x> <y> <z>');
          break;
        }
        // Bot tidak bisa teleport sendiri, minta admin
        bot.chat(`/tp ${bot.username} ${x} ${y} ${z}`);
        break;
      }

      // ── COME ──────────────────────────────────
      case '!come': {
        const player = bot.players[username];
        if (!player?.entity) {
          bot.chat('Tidak bisa menemukanmu!');
          break;
        }
        const { goals: g } = require('mineflayer-pathfinder');
        const p = player.entity.position;
        bot.chat(`Menuju ke ${username}...`);
        bot.pathfinder
          .goto(new g.GoalNear(p.x, p.y, p.z, 2))
          .then(() => bot.chat(`Sudah sampai di sisi ${username}!`))
          .catch(() => bot.chat('Tidak bisa mencapai posisimu.'));
        break;
      }

      // ── FOLLOW ────────────────────────────────
      case '!follow': {
        const target = args[1] || username;
        const { goals: g } = require('mineflayer-pathfinder');
        bot.chat(`Mengikuti ${target}...`);

        // Follow loop
        if (bot._followInterval) clearInterval(bot._followInterval);
        bot._followInterval = setInterval(() => {
          const p = bot.players[target]?.entity;
          if (!p) return;
          bot.pathfinder.setGoal(new g.GoalFollow(p, 2), true);
        }, 1000);
        break;
      }

      // ── UNFOLLOW ──────────────────────────────
      case '!unfollow':
        if (bot._followInterval) {
          clearInterval(bot._followInterval);
          bot._followInterval = null;
        }
        bot.pathfinder.setGoal(null);
        bot.chat('Berhenti mengikuti.');
        break;

      // ── INVENTORY ─────────────────────────────
      case '!inv': {
        const items = bot.inventory.items();
        if (items.length === 0) {
          bot.chat('Inventory kosong!');
          break;
        }
        bot.chat(`📦 Inventory (${items.length} jenis):`);
        // Kirim per 3 item agar tidak spam
        const chunks = [];
        for (let i = 0; i < items.length; i += 3) {
          chunks.push(
            items
              .slice(i, i + 3)
              .map(it => `${it.name}x${it.count}`)
              .join(', ')
          );
        }
        chunks.forEach(c => bot.chat(c));
        break;
      }

      // ── DROP ──────────────────────────────────
      case '!drop': {
        const itemName = args[1];
        if (!itemName) {
          bot.chat('Format: !drop <nama_item>');
          break;
        }
        const item = bot.inventory.items().find(i => i.name === itemName);
        if (!item) {
          bot.chat(`Item ${itemName} tidak ditemukan di inventory.`);
          break;
        }
        await bot.toss(item.type, null, item.count);
        bot.chat(`🗑️ Buang ${item.count}x ${itemName}`);
        break;
      }

      // ── EAT ───────────────────────────────────
      case '!eat': {
        const FOODS = [
          'golden_apple',
          'cooked_beef',
          'cooked_chicken',
          'bread',
          'apple',
          'carrot',
          'potato',
        ];
        const food = bot.inventory.items().find(i => FOODS.includes(i.name));
        if (!food) {
          bot.chat('Tidak ada makanan!');
          break;
        }
        await bot.equip(food, 'hand');
        await bot.consume().catch(() => {});
        bot.chat(`🍖 Makan ${food.name}`);
        break;
      }

      // ── BUILD SET ─────────────────────────────
      case '!build': {
        if (args[1] === 'set') {
          const pos = bot.entity.position.floored();
          skills.building.setOrigin(pos);
        } else {
          bot.chat('Gunakan: !build set');
        }
        break;
      }

      // ── SAY ───────────────────────────────────
      case '!say': {
        const msg = args.slice(1).join(' ');
        if (msg) bot.chat(msg);
        break;
      }

      default:
        bot.chat(`Perintah tidak dikenal: ${cmd}. Ketik !help`);
    }
  });

  // =============================================
  // AUTO MODE — bot pilih skill sendiri
  // =============================================
  async function runAutoMode() {
    while (autoMode) {
      await sleep(5000);
      if (!autoMode || !bot.entity) continue;

      // Prioritas: combat > farming > mining > logging
      const hasHostile = Object.values(bot.entities).some(e => {
        if (!e?.name || e.type !== 'mob') return false;
        const hostiles = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman'];
        return (
          hostiles.includes(e.name.toLowerCase()) && bot.entity.position.distanceTo(e.position) < 16
        );
      });

      let newSkill = 'farming'; // default

      if (hasHostile) {
        newSkill = 'combat';
      } else if (bot.food < 8) {
        // Jika lapar banget, prioritas cari makanan (tetap farming)
        newSkill = 'farming';
      }

      if (newSkill !== currentSkill) {
        stopCurrentSkill();
        currentSkill = newSkill;
        skills[newSkill].start();
        console.log(`[${bot.username}] 🤖 Auto switch ke: ${newSkill}`);
      }
    }
  }

  // =============================================
  // HELPER
  // =============================================
  function stopCurrentSkill() {
    if (currentSkill && skills[currentSkill]) {
      skills[currentSkill].stop();
    }
    currentSkill = null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =============================================
  // ERROR HANDLING
  // =============================================
  bot.on('error', err => console.log(`[${bot.username}] ❌ Error:`, err.message));
  bot.on('kicked', reason => console.log(`[${bot.username}] 🚫 Kicked:`, reason));
  bot.on('end', () => {
    console.log(`[${bot.username}] 🔌 Disconnect. Reconnect dalam 30 detik...`);
    stopCurrentSkill();
    setTimeout(createBot, 30000);
  });
}

createBot();
