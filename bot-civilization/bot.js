/**
 * BOT PERADABAN — Universal Civilization Bot
 *
 * Setiap instance bot punya:
 *  - Skill utama sesuai namanya
 *  - Kemampuan semua skill lainnya
 *  - Auto-switch berdasarkan kebutuhan peradaban
 *  - Shared state dengan bot lain via civilization.js
 *  - Hanya aLG30 yang bisa kasih perintah manual
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const civ = require('./core/civilization');
const engine = require('./core/decisionEngine');
const taskQueue = require('./core/taskQueue');
const { sleep: waitMs } = require('./shared/utils');

// Skills
const farmingSkill = require('./skills/farming');
const miningSkill = require('./skills/mining');
const loggingSkill = require('./skills/logging');
const combatSkill = require('./skills/combat');
const buildingSkill = require('./skills/building');
const craftingSkill = require('./skills/crafting');
const huntingSkill = require('./skills/hunting');
const sleepingSkill = require('./skills/sleeping');

// ──────────────────────────────────────────────
// KONFIGURASI
// ──────────────────────────────────────────────
const USERNAME = process.env.BOT_USERNAME || 'SiPetani';
const PRIMARY_SKILL = process.env.PRIMARY_SKILL || 'farming';
const OWNER = 'aLG30';

const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id',
  port: 25565,
  username: USERNAME,
  auth: 'offline',
  version: '1.21.11',
};

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
function createBot() {
  console.log(`[${USERNAME}] Connecting...`);
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let skills = {};
  let currentSkill = null;
  let decideTimer = null;
  let idleTimer = null;
  let lastActivity = Date.now();

  // ────────────────────────────────────────────
  // SPAWN
  // ────────────────────────────────────────────
  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);

    const move = new Movements(bot, mcData);
    move.canDig = true;
    bot.pathfinder.setMovements(move);

    // Inisialisasi semua skill
    skills = {
      farming: farmingSkill(bot, mcData),
      mining: miningSkill(bot, mcData),
      logging: loggingSkill(bot, mcData),
      combat: combatSkill(bot, mcData),
      building: buildingSkill(bot, mcData),
      crafting: craftingSkill(bot, mcData),
      hunting: huntingSkill(bot, mcData),
      sleeping: sleepingSkill(bot, mcData),
    };

    // Daftarkan bot ke civilization state
    civ.updateBotStatus(USERNAME, {
      skill: null,
      status: 'spawned',
      primarySkill: PRIMARY_SKILL,
    });

    civ.addLog(`[${USERNAME}] ✅ Online! Skill utama: ${PRIMARY_SKILL}`);
    console.log(`[${USERNAME}] ✅ Spawned | v${bot.version} | Skill utama: ${PRIMARY_SKILL}`);

    // Mulai dengan skill utama
    startSkill(PRIMARY_SKILL);

    // Decision loop — evaluasi setiap 10 detik
    decideTimer = setInterval(() => makeDecision(), 10000);

    // Idle detector — jika bot tidak ada aktivitas 30 detik, paksa decide
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > 30000) {
        console.log(`[${USERNAME}] 💤 Terdeteksi idle, mengevaluasi ulang...`);
        makeDecision(true);
        lastActivity = Date.now();
      }
    }, 15000);

    // Generate tasks global setiap 30 detik
    setInterval(() => engine.generateTasks(), 30000);
  });

  // ────────────────────────────────────────────
  // DECISION ENGINE
  // ────────────────────────────────────────────
  function makeDecision(forceSwitch = false) {
    if (!bot.entity) return;

    const newSkill = engine.decideSkill(bot, skills, currentSkill);

    if (!newSkill) {
      // Tidak ada skill yang viable
      if (currentSkill) {
        console.log(`[${USERNAME}] ⏸️ Tidak ada skill viable, menunggu...`);
        civ.addLog(`[${USERNAME}] ⏸️ Menunggu kondisi yang sesuai...`);
      }
      return;
    }

    if (newSkill !== currentSkill || forceSwitch) {
      const reason = forceSwitch
        ? 'idle recovery'
        : `kebutuhan peradaban (fase: ${civ.getState().phase})`;
      console.log(
        `[${USERNAME}] 🔄 Switch skill: ${currentSkill || 'none'} → ${newSkill} (${reason})`
      );
      civ.addLog(`[${USERNAME}] 🔄 ${currentSkill || '-'} → ${newSkill} | ${reason}`);
      startSkill(newSkill);
    }

    lastActivity = Date.now();
  }

  function startSkill(skillName) {
    // Stop skill sekarang
    if (currentSkill && skills[currentSkill]) {
      skills[currentSkill].stop();
    }

    currentSkill = skillName;

    if (!skillName || !skills[skillName]) return;

    skills[skillName].start();
    civ.updateBotStatus(USERNAME, { skill: skillName, status: 'working' });
  }

  function stopAll() {
    if (decideTimer) clearInterval(decideTimer);
    if (idleTimer) clearInterval(idleTimer);
    if (currentSkill && skills[currentSkill]) {
      skills[currentSkill].stop();
    }
    currentSkill = null;
  }

  // ────────────────────────────────────────────
  // CHAT COMMAND (hanya aLG30)
  // ────────────────────────────────────────────
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    if (username !== OWNER) return;

    const args = message.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    if (!cmd.startsWith('!')) return;

    console.log(`[${USERNAME}] Perintah dari ${username}: ${message}`);

    switch (cmd) {
      case '!help':
        bot.chat('=== Perintah Bot Peradaban ===');
        bot.chat('!civ — Status peradaban (fase, resource, struktur)');
        bot.chat('!bots — Status semua bot');
        bot.chat('!do <skill> — Paksa ganti skill');
        bot.chat('!stop — Hentikan semua skill');
        bot.chat('!resume — Lanjut auto-mode');
        bot.chat('!come — Bot datang ke kamu');
        bot.chat('!follow — Bot ikuti kamu');
        bot.chat('!unfollow — Berhenti ikuti');
        bot.chat('!inv — Lihat inventory');
        bot.chat('!status — Status bot ini');
        bot.chat('!build set — Set titik bangun');
        bot.chat('!tp <x> <y> <z> — Teleport bot');
        bot.chat('!say <pesan> — Bot ngomong');
        break;

      case '!civ': {
        const state = civ.getState();
        const r = state.resources;
        bot.chat(`=== PERADABAN — Fase: ${state.phase} ===`);
        bot.chat(`🪵 Kayu:${r.wood} 🪨 Batu:${r.stone} 🔩 Iron:${r.iron}`);
        bot.chat(`💎 Diamond:${r.diamond} 🌾 Gandum:${r.wheat} 🍞 Makanan:${r.food}`);
        bot.chat(
          `🏗️ Farm:${state.structures.farm ? '✅' : '❌'} Tembok:${state.structures.wall ? '✅' : '❌'}`
        );
        bot.chat(`⚠️ Ancaman mob: ${state.threats.hostileMobs ? 'ADA' : 'Aman'}`);
        break;
      }

      case '!bots': {
        const state = civ.getState();
        bot.chat('=== Status Semua Bot ===');
        for (const [name, info] of Object.entries(state.bots)) {
          const lastSeen = info.lastSeen
            ? Math.round((Date.now() - new Date(info.lastSeen)) / 1000) + 's lalu'
            : '?';
          bot.chat(`${name}: ${info.skill || '-'} | ${info.status} | ${lastSeen}`);
        }
        break;
      }

      case '!do': {
        const skillName = args[1]?.toLowerCase();
        if (!skillName || !skills[skillName]) {
          bot.chat(`Skill tidak ada! Tersedia: ${Object.keys(skills).join(', ')}`);
          break;
        }
        if (decideTimer) {
          clearInterval(decideTimer);
          decideTimer = null;
        }
        startSkill(skillName);
        bot.chat(`✅ Skill diganti ke: ${skillName} (manual)`);
        break;
      }

      case '!stop':
        stopAll();
        bot.chat('⏹️ Semua skill dihentikan.');
        break;

      case '!resume':
        if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
        makeDecision(true);
        bot.chat('▶️ Auto-mode dilanjutkan.');
        break;

      case '!status': {
        const pos = bot.entity.position;
        bot.chat(`=== ${USERNAME} ===`);
        bot.chat(`Pos: ${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}`);
        bot.chat(`HP: ${bot.health} | Food: ${bot.food}`);
        bot.chat(`Skill: ${currentSkill || 'idle'} | Utama: ${PRIMARY_SKILL}`);
        bot.chat(`Fase peradaban: ${civ.getState().phase}`);
        break;
      }

      case '!come': {
        const player = bot.players[username];
        if (!player?.entity) {
          bot.chat('Tidak bisa menemukanmu!');
          break;
        }
        const p = player.entity.position;
        bot.chat(`Menuju ${username}...`);
        bot.pathfinder
          .goto(new goals.GoalNear(p.x, p.y, p.z, 2))
          .then(() => bot.chat('Sudah di sini!'))
          .catch(() => bot.chat('Tidak bisa mencapai posisimu.'));
        break;
      }

      case '!follow': {
        const target = args[1] || username;
        if (bot._followInterval) clearInterval(bot._followInterval);
        bot.chat(`Mengikuti ${target}...`);
        bot._followInterval = setInterval(() => {
          const p = bot.players[target]?.entity;
          if (p) bot.pathfinder.setGoal(new goals.GoalFollow(p, 2), true);
        }, 1000);
        break;
      }

      case '!unfollow':
        if (bot._followInterval) {
          clearInterval(bot._followInterval);
          bot._followInterval = null;
        }
        bot.pathfinder.setGoal(null);
        bot.chat('Berhenti mengikuti.');
        break;

      case '!inv': {
        const items = bot.inventory.items();
        if (!items.length) {
          bot.chat('Inventory kosong!');
          break;
        }
        const chunks = [];
        for (let i = 0; i < items.length; i += 3)
          chunks.push(
            items
              .slice(i, i + 3)
              .map(it => `${it.name}x${it.count}`)
              .join(', ')
          );
        bot.chat(`📦 ${items.length} jenis item:`);
        chunks.forEach(c => bot.chat(c));
        break;
      }

      case '!build': {
        if (args[1] === 'set') {
          const pos = bot.entity.position.floored();
          skills.building?.setOrigin(pos);
          bot.chat(`📐 Origin build: (${pos.x}, ${pos.y}, ${pos.z})`);
        }
        break;
      }

      case '!tp': {
        const x = parseFloat(args[1]),
          y = parseFloat(args[2]),
          z = parseFloat(args[3]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          bot.chat('Format: !tp <x> <y> <z>');
          break;
        }
        bot.chat(`/tp ${USERNAME} ${x} ${y} ${z}`);
        break;
      }

      case '!say':
        if (args.slice(1).join(' ')) bot.chat(args.slice(1).join(' '));
        break;

      default:
        bot.chat(`Perintah tidak dikenal: ${cmd}. Ketik !help`);
    }
  });

  // ────────────────────────────────────────────
  // DEATH & RESPAWN
  // ────────────────────────────────────────────
  bot.on('death', async () => {
    console.log(`[${USERNAME}] 💀 Mati!`);
    civ.addLog(`[${USERNAME}] 💀 Mati!`);
    civ.updateBotStatus(USERNAME, { status: 'dead' });
    taskQueue.releaseBot(USERNAME);
    stopAll();
    await waitMs(2000);
    bot.respawn();
  });

  bot.on('respawn', async () => {
    console.log(`[${USERNAME}] 🔄 Respawn`);
    civ.updateBotStatus(USERNAME, { status: 'respawned' });
    await waitMs(2000);
    // Restart skill utama setelah respawn
    startSkill(PRIMARY_SKILL);
    if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
  });

  // ────────────────────────────────────────────
  // ERROR HANDLING
  // ────────────────────────────────────────────
  bot.on('error', err => {
    console.log(`[${USERNAME}] ❌ Error: ${err.message}`);
    civ.updateBotStatus(USERNAME, { status: 'error' });
  });

  bot.on('kicked', reason => {
    console.log(`[${USERNAME}] 🚫 Kicked: ${reason}`);
    civ.updateBotStatus(USERNAME, { status: 'kicked' });
  });

  bot.on('end', () => {
    console.log(`[${USERNAME}] 🔌 Disconnect. Reconnect dalam 30 detik...`);
    civ.updateBotStatus(USERNAME, { status: 'offline' });
    taskQueue.releaseBot(USERNAME);
    stopAll();
    setTimeout(createBot, 30000);
  });
}

createBot();
