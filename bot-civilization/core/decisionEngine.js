const civ = require('./civilization');

const PHASE_THRESHOLDS = {
  BOOTSTRAP: { next: 'SURVIVAL', requires: { wood: 32, stone: 16 } },
  SURVIVAL: { next: 'GROWTH', requires: { food: 32, iron: 8, cobblestone: 64 } },
  GROWTH: { next: 'CIVILIZATION', requires: { diamond: 5, gold: 16, iron: 32 } },
  CIVILIZATION: { next: null, requires: {} },
};

// Prioritas skill per fase — sleeping & survival selalu di atas
const PHASE_SKILL_PRIORITY = {
  BOOTSTRAP: [
    'sleeping',
    'combat',
    'logging',
    'mining',
    'hunting',
    'farming',
    'crafting',
    'building',
  ],
  SURVIVAL: [
    'sleeping',
    'combat',
    'hunting',
    'farming',
    'mining',
    'logging',
    'crafting',
    'building',
  ],
  GROWTH: ['sleeping', 'combat', 'mining', 'hunting', 'farming', 'logging', 'crafting', 'building'],
  CIVILIZATION: [
    'sleeping',
    'combat',
    'building',
    'farming',
    'hunting',
    'mining',
    'crafting',
    'logging',
  ],
};

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
    civ.addLog(`🏛️ Fase naik: ${current} → ${threshold.next}!`);
    return threshold.next;
  }
  return current;
}

function generateTasks() {
  const state = civ.getState();
  const r = state.resources;
  const phase = state.phase;

  if (state.threats.hostileMobs)
    civ.addTask({ type: 'combat', priority: 1, reason: 'Ada mob hostile' });

  if (r.food < 16) civ.addTask({ type: 'hunting', priority: 2, reason: 'Makanan menipis' });
  if (r.food < 8) civ.addTask({ type: 'farming', priority: 2, reason: 'Makanan kritis' });

  if (phase === 'BOOTSTRAP') {
    if (r.wood < 32) civ.addTask({ type: 'logging', priority: 2, reason: 'Butuh kayu bootstrap' });
    if (r.stone < 16) civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh batu bootstrap' });
  }

  if (phase !== 'BOOTSTRAP') {
    if (r.wood < 16) civ.addTask({ type: 'logging', priority: 4, reason: 'Stok kayu tipis' });
    if (r.iron < 8) civ.addTask({ type: 'mining', priority: 3, reason: 'Butuh iron' });
    if (r.cobblestone < 32)
      civ.addTask({ type: 'mining', priority: 4, reason: 'Butuh cobblestone' });
  }

  if (phase === 'GROWTH' || phase === 'CIVILIZATION') {
    if (r.diamond < 5) civ.addTask({ type: 'mining', priority: 2, reason: 'Butuh diamond' });
    if (!state.structures.farm)
      civ.addTask({ type: 'building', priority: 3, reason: 'Bangun farm' });
    if (!state.structures.storage)
      civ.addTask({ type: 'building', priority: 4, reason: 'Bangun storage' });
  }
}

function decideSkill(bot, skills, currentSkill) {
  const phase = evaluatePhase();
  const state = civ.getState();
  const priorities = PHASE_SKILL_PRIORITY[phase] || PHASE_SKILL_PRIORITY.BOOTSTRAP;

  // Combat selalu prioritas jika ada ancaman
  if (state.threats.hostileMobs && skills.combat?.isViable(bot)) return 'combat';

  // Sleeping prioritas jika malam
  if (skills.sleeping?.isViable(bot)) return 'sleeping';

  // Iterasi skill sesuai prioritas fase
  for (const skill of priorities) {
    if (skill === 'sleeping' || skill === 'combat') continue; // sudah dicek di atas
    if (skills[skill]?.isViable(bot)) {
      // Jika skill saat ini masih viable & prioritasnya sama/lebih tinggi, tetap di situ
      if (skill === currentSkill) return currentSkill;
      const curIdx = priorities.indexOf(currentSkill);
      const newIdx = priorities.indexOf(skill);
      if (currentSkill && skills[currentSkill]?.isViable(bot) && curIdx <= newIdx) {
        return currentSkill;
      }
      return skill;
    }
  }

  return null;
}

module.exports = { decideSkill, generateTasks, evaluatePhase };
