/**
 * DECISION ENGINE
 * Menentukan skill apa yang harus dijalankan bot
 * berdasarkan kondisi peradaban saat ini.
 *
 * Fase Peradaban:
 *  BOOTSTRAP    → Kumpulkan kayu & batu dasar
 *  SURVIVAL     → Buat farm, pertahanan, makanan
 *  GROWTH       → Mining, crafting, ekspansi
 *  CIVILIZATION → Bangun struktur besar, otomasi penuh
 */

const civ = require('./civilization');
const taskQueue = require('./taskQueue');

// Threshold resource per fase
const PHASE_THRESHOLDS = {
  BOOTSTRAP: {
    next: 'SURVIVAL',
    requires: { wood: 32, stone: 16 },
  },
  SURVIVAL: {
    next: 'GROWTH',
    requires: { food: 32, iron: 8, cobblestone: 64 },
  },
  GROWTH: {
    next: 'CIVILIZATION',
    requires: { diamond: 5, gold: 16, iron: 32 },
  },
  CIVILIZATION: {
    next: null,
    requires: {},
  },
};

// Skill priority per fase peradaban
const PHASE_SKILL_PRIORITY = {
  BOOTSTRAP: ['logging', 'mining', 'farming', 'combat', 'building'],
  SURVIVAL: ['farming', 'combat', 'mining', 'logging', 'building'],
  GROWTH: ['mining', 'farming', 'combat', 'logging', 'building'],
  CIVILIZATION: ['building', 'farming', 'mining', 'combat', 'logging'],
};

/**
 * Evaluasi fase peradaban dan upgrade jika syarat terpenuhi
 */
function evaluatePhase() {
  const state = civ.getState();
  const current = state.phase;
  const threshold = PHASE_THRESHOLDS[current];
  if (!threshold || !threshold.next) return current;

  const allMet = Object.entries(threshold.requires).every(
    ([res, min]) => (state.resources[res] || 0) >= min
  );

  if (allMet) {
    civ.updateState(s => {
      s.phase = threshold.next;
    });
    civ.addLog(`🏛️ PERADABAN NAIK FASE: ${current} → ${threshold.next}!`);
    console.log(`[CIV] 🏛️ Fase naik: ${current} → ${threshold.next}`);
    return threshold.next;
  }

  return current;
}

/**
 * Generate task-task yang dibutuhkan berdasarkan state peradaban
 */
function generateTasks() {
  const state = civ.getState();
  const r = state.resources;
  const phase = state.phase;

  // COMBAT selalu prioritas 1 jika ada ancaman
  if (state.threats.hostileMobs) {
    civ.addTask({ type: 'combat', priority: 1, reason: 'Ada mob hostile!' });
  }

  // BOOTSTRAP: butuh kayu & batu
  if (phase === 'BOOTSTRAP') {
    if (r.wood < 32)
      civ.addTask({ type: 'logging', priority: 2, reason: 'Butuh kayu untuk bootstrap' });
    if (r.stone < 16)
      civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh batu untuk bootstrap' });
  }

  // SURVIVAL: butuh makanan & pertahanan
  if (phase === 'SURVIVAL' || phase === 'GROWTH' || phase === 'CIVILIZATION') {
    if (r.food < 16) civ.addTask({ type: 'farming', priority: 2, reason: 'Stok makanan menipis' });
    if (r.wheat < 16) civ.addTask({ type: 'farming', priority: 3, reason: 'Butuh gandum' });
    if (r.wood < 16) civ.addTask({ type: 'logging', priority: 4, reason: 'Stok kayu menipis' });
    if (r.iron < 8) civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh iron' });
    if (r.cobblestone < 32)
      civ.addTask({ type: 'mining', priority: 4, reason: 'Butuh cobblestone' });
  }

  // GROWTH & CIVILIZATION: mining & building
  if (phase === 'GROWTH' || phase === 'CIVILIZATION') {
    if (r.diamond < 5) civ.addTask({ type: 'mining', priority: 2, reason: 'Butuh diamond' });
    if (r.iron < 32)
      civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh lebih banyak iron' });
    if (!state.structures.farm)
      civ.addTask({ type: 'building', priority: 3, reason: 'Bangun farm' });
    if (!state.structures.storage)
      civ.addTask({ type: 'building', priority: 4, reason: 'Bangun storage' });
    if (!state.structures.house)
      civ.addTask({ type: 'building', priority: 5, reason: 'Bangun rumah' });
  }

  // CIVILIZATION: bangun wall
  if (phase === 'CIVILIZATION') {
    if (!state.structures.wall)
      civ.addTask({ type: 'building', priority: 3, reason: 'Bangun tembok pertahanan' });
  }
}

/**
 * Tentukan skill terbaik untuk satu bot
 * berdasarkan: fase, ancaman, resource, apa yang bot bisa lakukan
 */
function decideSkill(bot, skills, currentSkill) {
  // 0. Cek apakah ada task pending untuk skill ini
  const pending = taskQueue.getPending();
  for (const task of pending) {
    if (skills[task.type]?.isViable(bot)) {
      taskQueue.claim(bot.username);
      return task.type;
    }
  }

  const state = civ.getState();
  const phase = evaluatePhase();
  const priorities = PHASE_SKILL_PRIORITY[phase] || PHASE_SKILL_PRIORITY.BOOTSTRAP;

  // 1. COMBAT selalu menang jika ada ancaman di dekat bot
  if (state.threats.hostileMobs) {
    if (skills.combat?.isViable(bot)) return 'combat';
  }

  // 2. Cek apakah skill saat ini masih viable
  if (currentSkill && skills[currentSkill]?.isViable(bot)) {
    // Skill masih bisa jalan, tapi cek apakah ada yang lebih penting
    const currentPriority = priorities.indexOf(currentSkill);
    for (const skill of priorities) {
      const idx = priorities.indexOf(skill);
      if (idx < currentPriority && skills[skill]?.isViable(bot)) {
        // Ada skill dengan prioritas lebih tinggi
        return skill;
      }
    }
    return currentSkill; // Tetap di skill sekarang
  }

  // 3. Skill saat ini tidak viable, cari skill lain yang bisa
  for (const skill of priorities) {
    if (skills[skill]?.isViable(bot)) {
      return skill;
    }
  }

  // 4. Fallback: tidak ada yang bisa, tunggu
  return null;
}

module.exports = { decideSkill, generateTasks, evaluatePhase };
