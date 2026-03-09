/**
 * TASK QUEUE
 * Antrian tugas bersama untuk semua bot.
 * Wrapper di atas fungsi task di civilization.js
 */

const civ = require('./civilization');

// Tipe task yang tersedia
const TASK_TYPES = {
  FARMING: 'farming',
  MINING: 'mining',
  LOGGING: 'logging',
  COMBAT: 'combat',
  BUILDING: 'building',
  CRAFTING: 'crafting',
};

/**
 * Tambah task baru ke antrian
 * Priority: 1 = paling penting, 10 = paling rendah
 */
function push(type, reason, priority = 5) {
  if (!Object.values(TASK_TYPES).includes(type)) {
    console.warn(`[TaskQueue] Unknown task type: ${type}`);
    return;
  }
  civ.addTask({ type, reason, priority });
}

/**
 * Bot mengklaim task pertama yang tersedia (PENDING)
 * Return task object atau null jika antrian kosong
 */
function claim(botUsername) {
  return civ.claimTask(botUsername);
}

/**
 * Tandai task sebagai selesai
 */
function complete(taskId) {
  civ.completeTask(taskId);
}

/**
 * Lihat semua task saat ini (tanpa mengklaim)
 */
function peek() {
  return civ.getState().tasks;
}

/**
 * Lihat task yang sedang dikerjakan bot tertentu
 */
function getByBot(botUsername) {
  return peek().filter(t => t.assignedTo === botUsername && t.status === 'IN_PROGRESS');
}

/**
 * Lihat task pending yang belum diklaim siapapun
 */
function getPending() {
  return peek().filter(t => t.status === 'PENDING');
}

/**
 * Cek apakah ada task pending untuk skill tertentu
 */
function hasPendingFor(skillType) {
  return getPending().some(t => t.type === skillType);
}

/**
 * Batalkan semua task IN_PROGRESS dari bot tertentu
 * (misalnya saat bot mati atau disconnect)
 */
function releaseBot(botUsername) {
  civ.updateState(s => {
    s.tasks.forEach(t => {
      if (t.assignedTo === botUsername && t.status === 'IN_PROGRESS') {
        t.status = 'PENDING';
        t.assignedTo = null;
        t.startedAt = null;
      }
    });
  });
}

/**
 * Bersihkan task yang sudah terlalu lama IN_PROGRESS (stuck)
 * Kembalikan ke PENDING agar bisa diklaim bot lain
 */
function cleanStuckTasks(timeoutMs = 5 * 60 * 1000) {
  // default 5 menit
  const now = Date.now();
  civ.updateState(s => {
    s.tasks.forEach(t => {
      if (t.status !== 'IN_PROGRESS' || !t.startedAt) return;
      const elapsed = now - new Date(t.startedAt).getTime();
      if (elapsed > timeoutMs) {
        console.log(`[TaskQueue] ♻️ Task stuck dikembalikan: ${t.type} (${t.assignedTo})`);
        t.status = 'PENDING';
        t.assignedTo = null;
        t.startedAt = null;
      }
    });
  });
}

// Jalankan cleaner setiap 2 menit
setInterval(cleanStuckTasks, 2 * 60 * 1000);

module.exports = {
  TASK_TYPES,
  push,
  claim,
  complete,
  peek,
  getByBot,
  getPending,
  hasPendingFor,
  releaseBot,
  cleanStuckTasks,
};
