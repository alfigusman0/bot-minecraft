/**
 * CIVILIZATION STATE
 * Shared memory antar semua bot (via file JSON di disk).
 * Setiap bot membaca & menulis state ini untuk koordinasi.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../logs/civilization.json');

const DEFAULT_STATE = {
  phase: 'BOOTSTRAP', // BOOTSTRAP → SURVIVAL → GROWTH → CIVILIZATION
  resources: {
    wood: 0,
    stone: 0,
    coal: 0,
    iron: 0,
    gold: 0,
    diamond: 0,
    wheat: 0,
    wheat_seeds: 0,
    food: 0,
    cobblestone: 0,
  },
  needs: {
    // Apa yang sedang dibutuhkan peradaban
    food: true,
    wood: true,
    stone: true,
    iron: false,
    shelter: false,
    defense: false,
  },
  structures: {
    // Apakah struktur sudah dibangun
    farm: false,
    storage: false,
    house: false,
    wall: false,
    mine: false,
  },
  threats: {
    // Ancaman aktif
    hostileMobs: false,
    lastThreatAt: null,
  },
  bots: {
    // Status tiap bot: { skill, status, lastSeen, pos }
  },
  tasks: [], // Antrian tugas global
  log: [], // Log aktivitas peradaban (max 50 baris)
  updatedAt: null,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (_) {}
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  try {
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[CIV] Gagal simpan state:', err.message);
  }
}

function getState() {
  return loadState();
}

function updateState(updater) {
  const state = loadState();
  updater(state);
  saveState(state);
  return state;
}

function addLog(message) {
  updateState(s => {
    s.log.unshift(`[${new Date().toLocaleTimeString('id-ID')}] ${message}`);
    if (s.log.length > 50) s.log = s.log.slice(0, 50);
  });
}

function updateBotStatus(username, info) {
  updateState(s => {
    s.bots[username] = {
      ...(s.bots[username] || {}),
      ...info,
      lastSeen: new Date().toISOString(),
    };
  });
}

function addResources(items) {
  updateState(s => {
    for (const [key, val] of Object.entries(items)) {
      if (s.resources[key] !== undefined) {
        s.resources[key] = Math.max(0, (s.resources[key] || 0) + val);
      }
    }
  });
}

function claimTask(botUsername) {
  let claimed = null;
  updateState(s => {
    const idx = s.tasks.findIndex(t => t.status === 'PENDING');
    if (idx !== -1) {
      s.tasks[idx].status = 'IN_PROGRESS';
      s.tasks[idx].assignedTo = botUsername;
      s.tasks[idx].startedAt = new Date().toISOString();
      claimed = s.tasks[idx];
    }
  });
  return claimed;
}

function completeTask(taskId) {
  updateState(s => {
    const t = s.tasks.find(t => t.id === taskId);
    if (t) t.status = 'DONE';
    // Bersihkan task DONE yang sudah lama
    s.tasks = s.tasks.filter(t => t.status !== 'DONE').slice(0, 30);
  });
}

function addTask(task) {
  updateState(s => {
    // Jangan duplikat task yang sama
    const exists = s.tasks.some(t => t.type === task.type && t.status === 'PENDING');
    if (!exists) {
      s.tasks.push({
        id: `${task.type}_${Date.now()}`,
        status: 'PENDING',
        priority: task.priority || 5,
        createdAt: new Date().toISOString(),
        ...task,
      });
      // Urutkan berdasarkan prioritas (1 = paling penting)
      s.tasks.sort((a, b) => a.priority - b.priority);
    }
  });
}

module.exports = {
  getState,
  updateState,
  addLog,
  updateBotStatus,
  addResources,
  claimTask,
  completeTask,
  addTask,
};
