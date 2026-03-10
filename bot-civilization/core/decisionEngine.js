/**
 * DECISION ENGINE + JOB COORDINATOR
 *
 * Aturan distribusi skill:
 * - Maksimal 2 bot boleh menjalankan skill yang sama bersamaan
 * - sleeping & combat dikecualikan (semua bot boleh sekaligus)
 * - Setiap bot dipaksa ambil skill yang BERBEDA jika sudah ada 2 bot di skill itu
 * - Skill utama (PRIMARY_SKILL) selalu dicoba duluan
 */

const civ = require('./civilization');

// ── Fase & threshold ──────────────────────────────────────────
const PHASE_THRESHOLDS = {
  BOOTSTRAP: { next: 'SURVIVAL', requires: { wood: 32, stone: 16 } },
  SURVIVAL: { next: 'GROWTH', requires: { food: 32, iron: 8, cobblestone: 64 } },
  GROWTH: { next: 'CIVILIZATION', requires: { diamond: 5, gold: 16, iron: 32 } },
  CIVILIZATION: { next: null, requires: {} },
};

// Prioritas skill per fase (urutan preferensi jika slot masih tersedia)
const PHASE_SKILL_PRIORITY = {
  BOOTSTRAP: ['logging', 'mining', 'crafting', 'farming', 'hunting', 'building'],
  SURVIVAL: ['farming', 'hunting', 'logging', 'mining', 'crafting', 'building'],
  GROWTH: ['mining', 'farming', 'hunting', 'logging', 'crafting', 'building'],
  CIVILIZATION: ['building', 'farming', 'mining', 'hunting', 'logging', 'crafting'],
};

// Skill yang TIDAK dibatasi (boleh semua bot sekaligus)
const UNLIMITED_SKILLS = new Set(['sleeping', 'combat']);

// Maksimal bot per skill
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

// ── Hitung berapa bot yang sedang aktif di skill tertentu ─────
function countBotsOnSkill(skillName, excludeUsername = null) {
  const state = civ.getState();
  return Object.entries(state.bots).filter(([name, info]) => {
    if (name === excludeUsername) return false;
    if (!info.lastSeen) return false;
    // Anggap online jika lastSeen dalam 15 detik terakhir (heartbeat setiap 5 detik)
    const elapsed = Date.now() - new Date(info.lastSeen).getTime();
    if (elapsed > 15000) return false;
    return info.skill === skillName && info.status === 'working';
  }).length;
}

// ── Cek apakah slot skill masih tersedia ─────────────────────
function isSlotAvailable(skillName, username) {
  if (UNLIMITED_SKILLS.has(skillName)) return true;
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

// ── MAIN: Tentukan skill terbaik untuk bot ini ────────────────
function decideSkill(bot, skills, currentSkill, primarySkill) {
  const phase = evaluatePhase();
  const state = civ.getState();
  const username = bot.username;
  const priorities = PHASE_SKILL_PRIORITY[phase] || PHASE_SKILL_PRIORITY.BOOTSTRAP;

  // ── 1. Combat darurat (tidak terbatas) ──
  if (state.threats.hostileMobs && skills.combat?.isViable(bot)) {
    return 'combat';
  }

  // ── 2. Sleeping (tidak terbatas, malam semua tidur) ──
  if (skills.sleeping?.isViable(bot)) {
    return 'sleeping';
  }

  // ── 3. Coba skill UTAMA dulu jika slot tersedia ──
  if (primarySkill && primarySkill !== 'combat' && primarySkill !== 'sleeping') {
    if (skills[primarySkill]?.isViable(bot) && isSlotAvailable(primarySkill, username)) {
      return primarySkill;
    }
  }

  // ── 4. Coba pertahankan skill sekarang jika masih viable & slot ──
  if (
    currentSkill &&
    !UNLIMITED_SKILLS.has(currentSkill) &&
    skills[currentSkill]?.isViable(bot) &&
    isSlotAvailable(currentSkill, username)
  ) {
    return currentSkill;
  }

  // ── 5. Cari skill lain berdasarkan prioritas fase ──
  // Buat salinan prioritas, acak sedikit agar bot tidak semua pilih yang sama
  const shuffledPriorities = spreadSkills(priorities, username, skills, bot);

  for (const skillName of shuffledPriorities) {
    if (UNLIMITED_SKILLS.has(skillName)) continue;
    if (!skills[skillName]?.isViable(bot)) continue;
    if (!isSlotAvailable(skillName, username)) continue;
    return skillName;
  }

  // ── 6. Tidak ada slot tersedia → paksa ambil skill apapun yang viable ──
  // (lebih baik duplikat daripada diam)
  console.log(`[${username}] ⚠️ Semua slot penuh, paksa cari skill apapun...`);
  for (const skillName of priorities) {
    if (UNLIMITED_SKILLS.has(skillName)) continue;
    if (skills[skillName]?.isViable(bot)) return skillName;
  }

  return null;
}

/**
 * Distribusikan pilihan skill agar bot tidak semua pilih skill #1.
 * Bot dengan index berbeda mendapat urutan prioritas yang sedikit digeser.
 */
function spreadSkills(priorities, username, skills, bot) {
  const state = civ.getState();
  const allBots = Object.keys(state.bots);
  const botIndex = allBots.indexOf(username);

  // Hitung berapa bot sudah di tiap skill
  const skillLoad = {};
  for (const sk of priorities) {
    skillLoad[sk] = countBotsOnSkill(sk, username);
  }

  // Sort: utamakan skill yang paling sedikit bot-nya (load balancing)
  // Tapi tetap hormati urutan prioritas fase sebagai tiebreaker
  const sorted = [...priorities].sort((a, b) => {
    const loadDiff = (skillLoad[a] || 0) - (skillLoad[b] || 0);
    if (loadDiff !== 0) return loadDiff;
    return priorities.indexOf(a) - priorities.indexOf(b);
  });

  return sorted;
}

// ── Log distribusi skill (untuk debug) ───────────────────────
function logDistribution() {
  const state = civ.getState();
  const dist = {};

  for (const [name, info] of Object.entries(state.bots)) {
    if (!info.skill) continue;
    if (!dist[info.skill]) dist[info.skill] = [];
    dist[info.skill].push(name);
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
};
