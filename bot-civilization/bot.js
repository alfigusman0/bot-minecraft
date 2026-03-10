/**
 * BOT.JS — Multi-Bot Civilization Engine
 *
 * Mode Bot:
 * - PRIMARY_SKILL=farming  → SiPetani: dedicated farming, tidak ganti job
 * - PRIMARY_SKILL=building → SiPembangun: dedicated building, tidak ganti job
 * - PRIMARY_SKILL=lainnya  → Auto-mode: decision engine normal
 *
 * Creative Mode:
 * - Bot farming & building berjalan dalam creative mode
 * - Tidak perlu khawatir soal material/food — auto /give sendiri
 */

'use strict';

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const civ = require('./core/civilization');
const engine = require('./core/decisionEngine');
const { waitMs, withUnstuck } = require('./shared/utils');
const { HOME_BASE } = require('./core/config');

const farmingSkill = require('./skills/farming');
const miningSkill = require('./skills/mining');
const loggingSkill = require('./skills/logging');
const combatSkill = require('./skills/combat');
const buildingSkill = require('./skills/building');
const craftingSkill = require('./skills/crafting');
const huntingSkill = require('./skills/hunting');
const sleepingSkill = require('./skills/sleeping');

const USERNAME = process.env.BOT_USERNAME || 'SiPetani';
const PRIMARY_SKILL = (process.env.PRIMARY_SKILL || 'farming').toLowerCase();
const OWNER = 'aLG30';

// Bot yang DEDICATED (tidak akan ganti job)
const DEDICATED_SKILLS = new Set(['farming', 'building']);

// Bot dedicated berjalan dalam mode creative (auto-supply material)
const CREATIVE_SKILLS = new Set(['farming', 'building']);

const CONFIG = {
  host: process.env.MC_HOST || 'minecraft.alfi-gusman.web.id',
  port: parseInt(process.env.MC_PORT || '25565'),
  username: USERNAME,
  auth: 'offline',
  version: '1.21.11',
};

// ─────────────────────────────────────────────
//  CREATIVE MATERIAL PROVIDER
//  Bot creative bisa `/give` sendiri tanpa storage
// ─────────────────────────────────────────────

const CREATIVE_REFILL_COOLDOWN = 8000; // ms minimum antar /give
const creativeRefillCache = new Map(); // itemName → lastRefillTime

/**
 * Pastikan bot punya cukup item. Jika kurang, gunakan /give (creative).
 * Hanya aktif jika bot dalam mode creative.
 */
async function creativeEnsure(bot, itemName, amount = 64) {
  if (!CREATIVE_SKILLS.has(PRIMARY_SKILL)) return false; // Hanya untuk bot creative

  const now = Date.now();
  const last = creativeRefillCache.get(itemName) ?? 0;
  if (now - last < CREATIVE_REFILL_COOLDOWN) return true; // Rate limit

  const current = bot.inventory
    .items()
    .filter(i => i.name === itemName)
    .reduce((s, i) => s + i.count, 0);

  if (current >= amount) return true;

  creativeRefillCache.set(itemName, now);
  try {
    // /give @s <item> <amount>
    bot.chat(`/give ${bot.username} ${itemName} ${amount}`);
    await waitMs(800);
    console.log(`[${bot.username}] 🎁 /give ${itemName} ×${amount}`);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Aktifkan creative mode saat spawn (hanya untuk bot dedicated)
 */
async function ensureCreativeMode(bot) {
  if (!CREATIVE_SKILLS.has(PRIMARY_SKILL)) return;
  try {
    bot.chat(`/gamemode creative ${bot.username}`);
    await waitMs(1000);
    console.log(`[${bot.username}] 🎮 Creative mode aktif`);
    civ.addLog(`[${bot.username}] 🎮 Mode: CREATIVE`);
  } catch (_) {}
}

// ─────────────────────────────────────────────
//  BOT FACTORY
// ─────────────────────────────────────────────

function createBot() {
  console.log(`[${USERNAME}] Connecting... (skill: ${PRIMARY_SKILL})`);
  const bot = mineflayer.createBot(CONFIG);
  bot.loadPlugin(pathfinder);

  let mcData = null;
  let skills = {};
  let currentSkill = null;
  let decideTimer = null;
  let idleTimer = null;
  let lastPos = null;
  let idleCount = 0;
  let skillLoopInterval = null; // Untuk dedicated mode

  // Expose creative helper ke skills
  bot.creativeEnsure = (itemName, amount) => creativeEnsure(bot, itemName, amount);
  bot.isCreativeMode = () => CREATIVE_SKILLS.has(PRIMARY_SKILL);
  bot.isDedicated = () => DEDICATED_SKILLS.has(PRIMARY_SKILL);

  // ──────────────────────────────────────────
  //  SPAWN
  // ──────────────────────────────────────────
  bot.on('spawn', async () => {
    mcData = require('minecraft-data')(bot.version);

    const move = new Movements(bot, mcData);
    move.canDig = true;
    move.allowFreeMotion = false;
    move.allowParkour = true;
    move.allowSprinting = true;
    bot.pathfinder.setMovements(move);

    // Pasang semua skill
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

    civ.updateBotStatus(USERNAME, {
      skill: null,
      status: 'spawned',
      primarySkill: PRIMARY_SKILL,
      mode: bot.isCreativeMode() ? 'creative' : 'survival',
    });
    civ.addLog(
      `[${USERNAME}] ✅ Online | Skill: ${PRIMARY_SKILL} | Mode: ${bot.isCreativeMode() ? 'CREATIVE' : 'survival'}`
    );
    console.log(`[${USERNAME}] ✅ Spawned | v${bot.version} | Primary: ${PRIMARY_SKILL}`);

    // Inisialisasi setelah 3 detik
    setTimeout(async () => {
      // Aktifkan creative mode jika perlu
      await ensureCreativeMode(bot);

      // Kembali ke home base
      const dist = bot.entity.position.distanceTo(HOME_BASE);
      if (dist > 20) {
        console.log(`[${USERNAME}] 🏠 Menuju home base (${dist.toFixed(0)} blok)...`);
        civ.updateBotStatus(USERNAME, { status: 'going_home' });
        try {
          await withUnstuck(
            bot,
            () => bot.pathfinder.goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 5)),
            30000
          );
        } catch (_) {
          console.log(`[${USERNAME}] ⚠️ Gagal ke home base, lanjut dari posisi sekarang`);
        }
      }

      // ── DEDICATED MODE: Hanya jalankan satu skill, tidak pernah ganti ──
      if (bot.isDedicated()) {
        console.log(`[${USERNAME}] 🔒 DEDICATED mode: hanya ${PRIMARY_SKILL}`);
        civ.addLog(`[${USERNAME}] 🔒 Dedicated: ${PRIMARY_SKILL}`);
        startSkill(PRIMARY_SKILL);
        startDedicatedLoop();
      } else {
        // AUTO MODE: Decision engine normal
        startSkill(PRIMARY_SKILL);
        makeDecision();
        decideTimer = setInterval(() => makeDecision(), 10000);
        engine.generateTasks();
        setInterval(() => engine.generateTasks(), 30000);
        setInterval(() => engine.logDistribution(), 60000);
      }

      startTimers();
    }, 3000);
  });

  // ──────────────────────────────────────────
  //  DEDICATED LOOP (Farming & Building)
  //  Selalu jalankan skill utama, tidak pernah ganti.
  //  Combat & sleeping tetap bisa interrupt.
  // ──────────────────────────────────────────
  function startDedicatedLoop() {
    if (skillLoopInterval) clearInterval(skillLoopInterval);

    skillLoopInterval = setInterval(async () => {
      if (!bot.entity) return;

      const state = civ.getState();

      // ── Interrupt: Combat darurat ──
      if (state.threats.hostileMobs && skills.combat?.isViable(bot)) {
        if (currentSkill !== 'combat') {
          console.log(`[${USERNAME}] ⚔️ Interrupt: combat darurat`);
          startSkill('combat');
        }
        return;
      }

      // ── Interrupt: Tidur malam ──
      if (skills.sleeping?.isViable(bot)) {
        if (currentSkill !== 'sleeping') {
          console.log(`[${USERNAME}] 😴 Interrupt: waktu tidur`);
          startSkill('sleeping');
        }
        return;
      }

      // ── Kembali ke skill utama jika sedang di interrupt ──
      if (currentSkill !== PRIMARY_SKILL) {
        console.log(`[${USERNAME}] 🔄 Kembali ke ${PRIMARY_SKILL}`);
        startSkill(PRIMARY_SKILL);
        return;
      }

      // ── Creative refill health/food ──
      if (bot.isCreativeMode()) {
        if (bot.health < 20) {
          bot.chat(`/effect give ${bot.username} regeneration 5 255 true`);
        }
        if (bot.food < 20 && PRIMARY_SKILL === 'farming') {
          // Farming bot tidak perlu makanan tapi pastikan tidak mati
          bot.chat(`/effect give ${bot.username} saturation 5 255 true`);
        }
      }
    }, 5000);
  }

  // ──────────────────────────────────────────
  //  TIMERS (Heartbeat + Idle Detector)
  // ──────────────────────────────────────────
  function startTimers() {
    // Heartbeat setiap 5 detik
    setInterval(() => {
      if (!bot.entity) return;
      civ.updateBotStatus(USERNAME, {
        skill: currentSkill,
        status: 'working',
        mode: bot.isCreativeMode() ? 'creative' : 'survival',
        pos: {
          x: Math.floor(bot.entity.position.x),
          y: Math.floor(bot.entity.position.y),
          z: Math.floor(bot.entity.position.z),
        },
      });
    }, 5000);

    // Idle detector setiap 20 detik
    idleTimer = setInterval(() => {
      if (!bot.entity) return;
      const cur = bot.entity.position;
      if (lastPos && cur.distanceTo(lastPos) < 0.5) {
        idleCount++;
        if (idleCount >= 2) {
          console.log(`[${USERNAME}] 💤 Idle terdeteksi`);
          if (bot.isDedicated()) {
            // Restart skill utama
            startSkill(PRIMARY_SKILL);
          } else {
            makeDecision(true);
          }
          idleCount = 0;
        }
      } else {
        idleCount = 0;
      }
      lastPos = cur.clone();
    }, 20000);
  }

  // ──────────────────────────────────────────
  //  DECISION ENGINE (Auto-mode only)
  // ──────────────────────────────────────────
  function makeDecision(forceSwitch = false) {
    if (!bot.entity || bot.isDedicated()) return;

    const newSkill = engine.decideSkill(bot, skills, currentSkill, PRIMARY_SKILL);

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
    if (skillLoopInterval) {
      clearInterval(skillLoopInterval);
      skillLoopInterval = null;
    }
    if (currentSkill && skills[currentSkill]) skills[currentSkill].stop();
    currentSkill = null;
  }

  // ──────────────────────────────────────────
  //  CHAT COMMANDS (hanya OWNER)
  // ──────────────────────────────────────────
  bot.on('chat', async (username, message) => {
    if (username === bot.username || username !== OWNER) return;

    const args = message.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    if (!cmd.startsWith('!')) return;

    switch (cmd) {
      case '!help':
        bot.chat(
          'Commands: !civ !bots !jobs !do <skill> !stop !resume !home !status !come !follow !unfollow !inv !mode !give <item> [n] !say <msg>'
        );
        break;

      case '!civ': {
        const s = civ.getState();
        const r = s.resources;
        bot.chat(`Fase: ${s.phase} | 🪵${r.wood} 🪨${r.stone} ⚙️${r.iron} 💎${r.diamond}`);
        bot.chat(`🍖${r.food} 🌾${r.wheat} 🪨${r.cobblestone}`);
        bot.chat(
          `Farm:${s.structures.farm ? '✅' : '❌'} Tembok:${s.structures.wall ? '✅' : '❌'} Mob:${s.threats.hostileMobs ? '⚠️' : '✅'}`
        );
        break;
      }

      case '!bots': {
        const s = civ.getState();
        for (const [name, info] of Object.entries(s.bots)) {
          const ago = info.lastSeen
            ? Math.round((Date.now() - new Date(info.lastSeen)) / 1000) + 's'
            : '?';
          const mode = info.mode ? ` [${info.mode}]` : '';
          bot.chat(`${name}: ${info.skill || 'idle'}${mode} | ${info.status} | ${ago} lalu`);
        }
        break;
      }

      case '!jobs': {
        const dist = engine.logDistribution();
        const lines = Object.entries(dist).map(
          ([sk, bots]) => `${sk}:${bots.join('+')}(${bots.length})`
        );
        bot.chat(lines.length ? '📊 ' + lines.join(' | ') : 'Semua bot idle');
        const s2 = civ.getState();
        const now = Date.now();
        const offline = Object.entries(s2.bots).filter(
          ([, i]) => !i.lastSeen || now - new Date(i.lastSeen) > 15000
        );
        if (offline.length) bot.chat('❌ Offline: ' + offline.map(([n]) => n).join(', '));
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
        if (skillLoopInterval) {
          clearInterval(skillLoopInterval);
          skillLoopInterval = null;
        }
        startSkill(sk);
        bot.chat(`✅ Manual: ${sk}`);
        break;
      }

      case '!stop':
        stopAll();
        bot.chat('⏹️ Semua dihentikan.');
        break;

      case '!resume':
        if (bot.isDedicated()) {
          if (!skillLoopInterval) startDedicatedLoop();
          startSkill(PRIMARY_SKILL);
          bot.chat(`▶️ Resume dedicated: ${PRIMARY_SKILL}`);
        } else {
          if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
          makeDecision(true);
          bot.chat('▶️ Auto-mode ON.');
        }
        break;

      case '!status': {
        const pos = bot.entity.position;
        const modeStr = bot.isCreativeMode() ? 'CREATIVE' : 'survival';
        const dedStr = bot.isDedicated() ? 'DEDICATED' : 'auto';
        bot.chat(
          `${USERNAME} | ${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)} | HP:${bot.health} Food:${bot.food}`
        );
        bot.chat(
          `Skill: ${currentSkill || 'idle'} | ${modeStr} | ${dedStr} | Fase: ${civ.getState().phase}`
        );
        break;
      }

      case '!mode': {
        // Paksa ganti gamemode
        const m = args[1] || 'creative';
        bot.chat(`/gamemode ${m} ${bot.username}`);
        bot.chat(`🎮 Gamemode: ${m}`);
        break;
      }

      case '!give': {
        // Manual give item ke bot
        const item = args[1];
        const amount = parseInt(args[2] || '64');
        if (!item) {
          bot.chat('Usage: !give <item> [amount]');
          break;
        }
        bot.chat(`/give ${bot.username} ${item} ${amount}`);
        bot.chat(`🎁 /give ${item} ×${amount}`);
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

      case '!home': {
        bot.chat(`🏠 Kembali ke base...`);
        stopAll();
        bot.pathfinder
          .goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 3))
          .then(() => {
            bot.chat('🏠 Sudah di base!');
            if (bot.isDedicated()) {
              startSkill(PRIMARY_SKILL);
              startDedicatedLoop();
            } else {
              if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
              makeDecision(true);
            }
          })
          .catch(() => bot.chat('Tidak bisa ke base!'));
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
              .map(it => `${it.name}×${it.count}`)
              .join(', ')
          );
        break;
      }

      case '!build':
        if (args[1] === 'set') {
          const pos = bot.entity.position.floored();
          skills.building?.setOrigin?.(pos);
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
  //  DEATH & RESPAWN
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
    console.log(`[${USERNAME}] 🔄 Respawn — kembali ke home base...`);
    civ.updateBotStatus(USERNAME, { status: 'respawned' });
    await waitMs(2000);

    try {
      await withUnstuck(
        bot,
        () => bot.pathfinder.goto(new goals.GoalNear(HOME_BASE.x, HOME_BASE.y, HOME_BASE.z, 5)),
        30000
      );
    } catch (_) {}

    // Re-aktifkan creative mode setelah respawn
    await ensureCreativeMode(bot);

    if (bot.isDedicated()) {
      startSkill(PRIMARY_SKILL);
      startDedicatedLoop();
    } else {
      startSkill(PRIMARY_SKILL);
      if (!decideTimer) decideTimer = setInterval(() => makeDecision(), 10000);
    }
    startTimers();
  });

  // ──────────────────────────────────────────
  //  ERROR HANDLING
  // ──────────────────────────────────────────
  bot.on('error', err => {
    console.error(`[${USERNAME}] ❌ ${err.message}`);
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
