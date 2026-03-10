/**
 * DECISION ENGINE + JOB COORDINATOR
 *
 * Perubahan utama:
 * - Bot DEDICATED (farming/building) tidak pernah masuk decision engine
 * - Mereka dikelola langsung oleh dedicated loop di bot.js
 * - Bot auto-mode tetap menggunakan load-balancing seperti sebelumnya
 * - Dedicated bots tidak dihitung dalam slot occupancy (agar tidak block bot lain)
 */

'use strict';

const civ = require('./civilization');

// ── Fase & threshold ──────────────────────────────────────────
const PHASE_THRESHOLDS = {
  BOOTSTRAP: { next: 'SURVIVAL', requires: { wood: 32, stone: 16 } },
  SURVIVAL: { next: 'GROWTH', requires: { food: 32, iron: 8, cobblestone: 64 } },
  GROWTH: { next: 'CIVILIZATION', requires: { diamond: 5, gold: 16, iron: 32 } },
  CIVILIZATION: { next: null, requires: {} },
};

// Prioritas skill per fase
const PHASE_SKILL_PRIORITY = {
  BOOTSTRAP: ['logging', 'mining', 'crafting', 'farming', 'hunting', 'building'],
  SURVIVAL: ['farming', 'hunting', 'logging', 'mining', 'crafting', 'building'],
  GROWTH: ['mining', 'farming', 'hunting', 'logging', 'crafting', 'building'],
  CIVILIZATION: ['building', 'farming', 'mining', 'hunting', 'logging', 'crafting'],
};

// Skill yang TIDAK dibatasi slot (boleh semua bot sekaligus)
const UNLIMITED_SKILLS = new Set(['sleeping', 'combat']);

// Bot yang DEDICATED — tidak pernah dikelola decision engine
// dan tidak dihitung sebagai occupant slot
const DEDICATED_SKILLS = new Set(['farming', 'building']);

// Max bot per skill (untuk bot auto-mode)
const MAX_BOTS_PER_SKILL = 2;

// ── Evaluasi fase ─────────────────────────────────────────────
function evaluatePhase() {
  const state = civ.getState();
  const current = state.phase;
  const threshold = PHASE_THRESHOLDS[current];
  if (!threshold?.next) return current;

  const allMet = Object.entries(threshold.requires).every(
    ([res, min]) => (state.resources[res] || 0) >= min
  );

  if (allMet) {
    civ.updateState(s => {
      s.phase = threshold.next;
    });
    civ.addLog(`🏛️ FASE NAIK: ${current} → ${threshold.next}!`);
    console.log(`[CIV] 🏛️ Fase naik: ${current} → ${threshold.next}`);
    return threshold.next;
  }
  return current;
}

// ── Cek apakah bot adalah dedicated ─────────────────────────
function isDedicatedBot(info) {
  return info?.primarySkill && DEDICATED_SKILLS.has(info.primarySkill);
}

// ── Hitung berapa bot AUTO yang sedang aktif di skill tertentu ─
function countBotsOnSkill(skillName, excludeUsername = null) {
  const state = civ.getState();
  const now = Date.now();

  return Object.entries(state.bots).filter(([name, info]) => {
    if (name === excludeUsername) return false;
    if (!info.lastSeen) return false;
    if (now - new Date(info.lastSeen).getTime() > 15000) return false; // Offline
    if (isDedicatedBot(info)) return false; // Dedicated bot tidak dihitung
    return info.skill === skillName && info.status === 'working';
  }).length;
}

// ── Cek apakah slot skill masih tersedia ─────────────────────
function isSlotAvailable(skillName, username) {
  if (UNLIMITED_SKILLS.has(skillName)) return true;
  if (DEDICATED_SKILLS.has(skillName)) return true; // Dedicated selalu tersedia
  return countBotsOnSkill(skillName, username) < MAX_BOTS_PER_SKILL;
}

// ── Generate tasks berdasarkan kebutuhan peradaban ────────────
function generateTasks() {
  const state = civ.getState();
  const r = state.resources;
  const phase = state.phase;

  if (state.threats.hostileMobs)
    civ.addTask({ type: 'combat', priority: 1, reason: 'Ada mob hostile' });

  if (r.food < 8) civ.addTask({ type: 'farming', priority: 2, reason: 'Makanan kritis' });
  if (r.food < 16) civ.addTask({ type: 'hunting', priority: 2, reason: 'Makanan menipis' });

  if (phase === 'BOOTSTRAP') {
    if (r.wood < 32) civ.addTask({ type: 'logging', priority: 2, reason: 'Butuh kayu' });
    if (r.stone < 16) civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh batu' });
  }

  if (phase !== 'BOOTSTRAP') {
    if (r.wood < 16) civ.addTask({ type: 'logging', priority: 4, reason: 'Kayu tipis' });
    if (r.iron < 8) civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh iron' });
    if (r.cobblestone < 32)
      civ.addTask({ type: 'mining', priority: 4, reason: 'Butuh cobblestone' });
  }

  if (phase === 'GROWTH' || phase === 'CIVILIZATION') {
    if (r.diamond < 5) civ.addTask({ type: 'mining', priority: 2, reason: 'Butuh diamond' });
    if (!state.structures.farm)
      civ.addTask({ type: 'building', priority: 3, reason: 'Bangun farm' });
    if (!state.structures.wall)
      civ.addTask({ type: 'building', priority: 4, reason: 'Bangun tembok' });
  }
}

// ── MAIN: Tentukan skill terbaik untuk bot auto-mode ──────────
function decideSkill(bot, skills, currentSkill, primarySkill) {
  // Dedicated bot TIDAK boleh masuk sini
  if (DEDICATED_SKILLS.has(primarySkill)) return primarySkill;

  const phase = evaluatePhase();
  const state = civ.getState();
  const username = bot.username;
  const priorities = PHASE_SKILL_PRIORITY[phase] || PHASE_SKILL_PRIORITY.BOOTSTRAP;

  // 1. Combat darurat
  if (state.threats.hostileMobs && skills.combat?.isViable(bot)) return 'combat';

  // 2. Sleeping malam
  if (skills.sleeping?.isViable(bot)) return 'sleeping';

  // 3. Skill utama jika slot tersedia
  if (primarySkill && !UNLIMITED_SKILLS.has(primarySkill)) {
    if (skills[primarySkill]?.isViable(bot) && isSlotAvailable(primarySkill, username)) {
      return primarySkill;
    }
  }

  // 4. Pertahankan skill sekarang
  if (
    currentSkill &&
    !UNLIMITED_SKILLS.has(currentSkill) &&
    skills[currentSkill]?.isViable(bot) &&
    isSlotAvailable(currentSkill, username)
  ) {
    return currentSkill;
  }

  // 5. Load-balanced skill dari prioritas fase
  const balanced = spreadSkills(priorities, username, skills, bot);
  for (const skillName of balanced) {
    if (UNLIMITED_SKILLS.has(skillName) || DEDICATED_SKILLS.has(skillName)) continue;
    if (!skills[skillName]?.isViable(bot)) continue;
    if (!isSlotAvailable(skillName, username)) continue;
    return skillName;
  }

  // 6. Fallback: skill apapun yang viable (duplikat diizinkan)
  console.log(`[${username}] ⚠️ Semua slot penuh, paksa cari skill apapun...`);
  for (const skillName of priorities) {
    if (UNLIMITED_SKILLS.has(skillName) || DEDICATED_SKILLS.has(skillName)) continue;
    if (skills[skillName]?.isViable(bot)) return skillName;
  }

  return null;
}

/**
 * Sort skill berdasarkan load (sedikit bot = prioritas lebih tinggi)
 */
function spreadSkills(priorities, username, skills, bot) {
  const skillLoad = {};
  for (const sk of priorities) {
    skillLoad[sk] = countBotsOnSkill(sk, username);
  }

  return [...priorities].sort((a, b) => {
    const diff = (skillLoad[a] || 0) - (skillLoad[b] || 0);
    return diff !== 0 ? diff : priorities.indexOf(a) - priorities.indexOf(b);
  });
}

// ── Log distribusi ─────────────────────────────────────────────
function logDistribution() {
  const state = civ.getState();
  const dist = {};
  const now = Date.now();

  for (const [name, info] of Object.entries(state.bots)) {
    if (!info.skill) continue;
    const elapsed = info.lastSeen ? now - new Date(info.lastSeen).getTime() : Infinity;
    const status = elapsed > 15000 ? '(offline)' : isDedicatedBot(info) ? '🔒' : '';
    if (!dist[info.skill]) dist[info.skill] = [];
    dist[info.skill].push(`${name}${status}`);
  }

  const lines = Object.entries(dist)
    .map(([skill, bots]) => `${skill}(${bots.length}): ${bots.join(',')}`)
    .join(' | ');

  console.log(`[CIV] 📊 Distribusi: ${lines || 'kosong'}`);
  return dist;
}

module.exports = {
  decideSkill,
  generateTasks,
  evaluatePhase,
  logDistribution,
  countBotsOnSkill,
  isSlotAvailable,
  isDedicatedBot,
};
