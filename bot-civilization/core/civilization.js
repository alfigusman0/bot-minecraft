const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../logs/civilization.json');

const DEFAULT_STATE = {
  phase: 'BOOTSTRAP',
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
  needs: { food: true, wood: true, stone: true, iron: false, shelter: false, defense: false },
  structures: { farm: false, storage: false, house: false, wall: false, mine: false },
  threats: { hostileMobs: false, lastThreatAt: null },
  bots: {},
  tasks: [],
  log: [],
  updatedAt: null,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
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
  const s = loadState();
  updater(s);
  saveState(s);
  return s;
}

function addLog(message) {
  updateState(s => {
    s.log.unshift(`[${new Date().toLocaleTimeString('id-ID')}] ${message}`);
    if (s.log.length > 50) s.log = s.log.slice(0, 50);
  });
}

function updateBotStatus(username, info) {
  updateState(s => {
    s.bots[username] = { ...(s.bots[username] || {}), ...info, lastSeen: new Date().toISOString() };
  });
}

function addResources(items) {
  updateState(s => {
    for (const [key, val] of Object.entries(items)) {
      if (s.resources[key] !== undefined)
        s.resources[key] = Math.max(0, (s.resources[key] || 0) + val);
    }
  });
}

function addTask(task) {
  updateState(s => {
    const exists = s.tasks.some(t => t.type === task.type && t.status === 'PENDING');
    if (!exists) {
      s.tasks.push({
        id: `${task.type}_${Date.now()}`,
        status: 'PENDING',
        priority: task.priority || 5,
        createdAt: new Date().toISOString(),
        ...task,
      });
      s.tasks.sort((a, b) => a.priority - b.priority);
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
    s.tasks = s.tasks.filter(t => t.status !== 'DONE').slice(0, 30);
  });
}

module.exports = {
  getState,
  updateState,
  addLog,
  updateBotStatus,
  addResources,
  addTask,
  claimTask,
  completeTask,
};
