const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const civ = require('./core/civilization');
const engine = require('./core/decisionEngine');
const { waitMs } = require('./shared/utils');

const farmingSkill = require('./skills/farming');
const miningSkill = require('./skills/mining');
const loggingSkill = require('./skills/logging');
const combatSkill = require('./skills/combat');
const buildingSkill = require('./skills/building');
const craftingSkill = require('./skills/crafting');
const huntingSkill = require('./skills/hunting');
const sleepingSkill = require('./skills/sleeping');

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

function createBot() {
  console.log(`[${USERNAME}] Connecting...`);
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData;
  let skills = {};
  let currentSkill = null;
  let decideTimer = null;
  let idleTimer = null;
  let lastPos = null;
  let idleCount = 0;

  // ──────────────────────────────────────────
  // SPAWN
  // ──────────────────────────────────────────
  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version);

    const move = new Movements(bot, mcData);
    move.canDig = true;
    move.allowFreeMotion = false;
    move.allowParkour = true;
    move.allowSprinting = true;
    bot.pathfinder.setMovements(move);

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

    civ.updateBotStatus(USERNAME, { skill: null, status: 'spawned', primarySkill: PRIMARY_SKILL });
    civ.addLog(`[${USERNAME}] ✅ Online | Skill utama: ${PRIMARY_SKILL}`);
    console.log(`[${USERNAME}] ✅ Spawned | v${bot.version} | Skill: ${PRIMARY_SKILL}`);

    startSkill(PRIMARY_SKILL);

    // Decision loop setiap 10 detik
    decideTimer = setInterval(() => makeDecision(), 10000);

    // FIX BUG 1: Idle/stuck detector setiap 20 detik
    idleTimer = setInterval(() => {
      if (!bot.entity) return;
      const curPos = bot.entity.position;

      if (lastPos && curPos.distanceTo(lastPos) < 0.5) {
        idleCount++;
        if (idleCount >= 2) {
          console.log(`[${USERNAME}] 💤 Idle terdeteksi, re-evaluate skill...`);
          makeDecision(true);
          idleCount = 0;
        }
      } else {
        idleCount = 0;
      }
      lastPos = curPos.clone();
    }, 20000);

    // Generate tasks peradaban setiap 30 detik
    setInterval(() => engine.generateTasks(), 30000);
  });

  // ──────────────────────────────────────────
  // DECISION ENGINE
  // ──────────────────────────────────────────
  function makeDecision(forceSwitch = false) {
    if (!bot.entity) return;

    const newSkill = engine.decideSkill(bot, skills, currentSkill);

    if (!newSkill) {
      if (!currentSkill || !skills[currentSkill]?.isViable(bot)) {
        console.log(`[${USERNAME}] ⏸️ Tidak ada skill viable...`);
      }
      return;
    }

    if (newSkill !== currentSkill || forceSwitch) {
      const state = civ.getState();
      const reason = forceSwitch ? 'idle recovery' : `fase ${state.phase}`;
      console.log(`[${USERNAME}] 🔄 ${currentSkill || 'none'} → ${newSkill} (${reason})`);
      civ.addLog(`[${USERNAME}] 🔄 ${currentSkill || '-'} → ${newSkill} | ${reason}`);
      startSkill(newSkill);
    }
  }

  function startSkill(skillName) {
    if (currentSkill && skills[currentSkill]) skills[currentSkill].stop();
    currentSkill = skillName;
    if (!skillName || !skills[skillName]) return;
    skills[skillName].start();
    civ.updateBotStatus(USERNAME, { skill: skillName, status: 'working' });
  }

  function stopAll() {
    if (decideTimer) {
      clearInterval(decideTimer);
      decideTimer = null;
    }
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    if (currentSkill && skills[currentSkill]) skills[currentSkill].stop();
    currentSkill = null;
  }

  // ──────────────────────────────────────────
  // CHAT COMMANDS (hanya aLG30)
  // ──────────────────────────────────────────
  bot.on('chat', async (username, message) => {
    if (username === bot.username || username !== OWNER) return;

    const args = message.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    if (!cmd.startsWith('!')) return;

    switch (cmd) {
      case '!help':
        bot.chat(
          '!civ !bots !do <skill> !stop !resume !status !come !follow !unfollow !inv !build set !say <msg>'
        );
        break;

      case '!civ': {
        const s = civ.getState();
        const r = s.resources;
        bot.chat(
          `Fase: ${s.phase} | Kayu:${r.wood} Batu:${r.stone} Iron:${r.iron} Diamond:${r.diamond}`
        );
        bot.chat(`Makanan:${r.food} Gandum:${r.wheat} Cobble:${r.cobblestone}`);
        bot.chat(
          `Farm:${s.structures.farm ? '✅' : '❌'} Tembok:${s.structures.wall ? '✅' : '❌'} Mob:${s.threats.hostileMobs ? '⚠️' : 'aman'}`
        );
        break;
      }

      case '!bots': {
        const s = civ.getState();
        for (const [name, info] of Object.entries(s.bots)) {
          const ago = info.lastSeen
            ? Math.round((Date.now() - new Date(info.lastSeen)) / 1000) + 's'
            : '?';
          bot.chat(`${name}: ${info.skill || 'idle'} | ${info.status} | ${ago} lalu`);
        }
        break;
      }

      case '!do': {
        const sk = args[1]?.toLowerCase();
        if (!sk || !skills[sk]) {
          bot.chat(`Skill tidak ada. Tersedia: ${Object.keys(skills).join(', ')}`);
          break;
        }
        if (decideTimer) {
          clearInterval(decideTimer);
          decideTimer = null;
        }
        startSkill(sk);
        bot.chat(`✅ Skill: ${sk} (manual)`);
        break;
      }

      case '!stop':
        stopAll();
        bot.chat('⏹️ Semua dihentikan.');
        break;

      case '!resume':
        if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
        makeDecision(true);
        bot.chat('▶️ Auto-mode ON.');
        break;

      case '!status': {
        const pos = bot.entity.position;
        bot.chat(
          `${USERNAME} | ${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)} | HP:${bot.health} Food:${bot.food}`
        );
        bot.chat(
          `Skill: ${currentSkill || 'idle'} | Utama: ${PRIMARY_SKILL} | Fase: ${civ.getState().phase}`
        );
        break;
      }

      case '!come': {
        const p = bot.players[username]?.entity?.position;
        if (!p) {
          bot.chat('Tidak ketemu!');
          break;
        }
        bot.pathfinder
          .goto(new goals.GoalNear(p.x, p.y, p.z, 2))
          .then(() => bot.chat('Sudah sampai!'))
          .catch(() => bot.chat('Tidak bisa jangkau.'));
        break;
      }

      case '!follow': {
        const target = args[1] || username;
        if (bot._followInterval) clearInterval(bot._followInterval);
        bot._followInterval = setInterval(() => {
          const p = bot.players[target]?.entity;
          if (p) bot.pathfinder.setGoal(new goals.GoalFollow(p, 2), true);
        }, 1000);
        bot.chat(`Mengikuti ${target}`);
        break;
      }

      case '!unfollow':
        if (bot._followInterval) {
          clearInterval(bot._followInterval);
          bot._followInterval = null;
        }
        bot.pathfinder.setGoal(null);
        bot.chat('Berhenti follow.');
        break;

      case '!inv': {
        const items = bot.inventory.items();
        if (!items.length) {
          bot.chat('Inventory kosong!');
          break;
        }
        for (let i = 0; i < items.length; i += 3)
          bot.chat(
            items
              .slice(i, i + 3)
              .map(it => `${it.name}x${it.count}`)
              .join(', ')
          );
        break;
      }

      case '!build':
        if (args[1] === 'set') {
          const pos = bot.entity.position.floored();
          skills.building?.setOrigin(pos);
          bot.chat(`📐 Origin: (${pos.x},${pos.y},${pos.z})`);
        }
        break;

      case '!say':
        if (args.slice(1).join(' ')) bot.chat(args.slice(1).join(' '));
        break;

      default:
        bot.chat(`Tidak kenal: ${cmd}. Ketik !help`);
    }
  });

  // ──────────────────────────────────────────
  // DEATH & RESPAWN
  // ──────────────────────────────────────────
  bot.on('death', async () => {
    console.log(`[${USERNAME}] 💀 Mati!`);
    civ.addLog(`[${USERNAME}] 💀 Mati!`);
    civ.updateBotStatus(USERNAME, { status: 'dead' });
    stopAll();
    await waitMs(2000);
    bot.respawn();
  });

  bot.on('respawn', async () => {
    console.log(`[${USERNAME}] 🔄 Respawn`);
    civ.updateBotStatus(USERNAME, { status: 'respawned' });
    await waitMs(2000);
    startSkill(PRIMARY_SKILL);
    if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
    if (!idleTimer)
      idleTimer = setInterval(() => {
        if (!bot.entity) return;
        const curPos = bot.entity.position;
        if (lastPos && curPos.distanceTo(lastPos) < 0.5) {
          idleCount++;
          if (idleCount >= 2) {
            makeDecision(true);
            idleCount = 0;
          }
        } else {
          idleCount = 0;
        }
        lastPos = curPos.clone();
      }, 20000);
  });

  // ──────────────────────────────────────────
  // ERROR HANDLING
  // ──────────────────────────────────────────
  bot.on('error', err => {
    console.log(`[${USERNAME}] ❌ ${err.message}`);
    civ.updateBotStatus(USERNAME, { status: 'error' });
  });

  bot.on('kicked', reason => {
    console.log(`[${USERNAME}] 🚫 Kicked: ${reason}`);
    civ.updateBotStatus(USERNAME, { status: 'kicked' });
  });

  bot.on('end', () => {
    console.log(`[${USERNAME}] 🔌 Disconnect. Reconnect 30 detik...`);
    civ.updateBotStatus(USERNAME, { status: 'offline' });
    stopAll();
    setTimeout(createBot, 30000);
  });
}

createBot();
