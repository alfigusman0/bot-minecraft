/**
 * UTILS — Shared helpers untuk semua bot
 */

// Rename agar tidak konflik dengan bot.sleep() dari Mineflayer
function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * FIX BUG 2: Equip item terbaik dari daftar prioritas
 * Index terkecil = terbaik. Selalu pilih yang paling tinggi tier-nya.
 */
async function equipBest(bot, priorityList, slot = 'hand') {
  for (const itemName of priorityList) {
    const item = bot.inventory.items().find(i => i.name === itemName);
    if (item) {
      try {
        await bot.equip(item, slot);
        return item.name;
      } catch (_) {}
    }
  }
  return null;
}

/**
 * FIX BUG 1: Wrapper pathfinding dengan anti-stuck + timeout
 * Jika bot tidak bergerak selama 3 detik → paksa jump+forward
 * Jika total waktu melebihi timeoutMs → batalkan
 */
async function withUnstuck(bot, gotoFn, timeoutMs = 15000) {
  let lastPos = bot.entity?.position?.clone();
  let stuckCount = 0;

  const stuckChecker = setInterval(() => {
    if (!bot.entity) return;
    const cur = bot.entity.position;
    const dist = lastPos ? cur.distanceTo(lastPos) : 999;

    if (dist < 0.1) {
      stuckCount++;
      if (stuckCount >= 2) {
        console.log(`[${bot.username}] ⚠️ Stuck! Coba keluar...`);
        bot.setControlState('jump', true);
        setTimeout(() => {
          bot.setControlState('jump', false);
          bot.setControlState('forward', true);
          setTimeout(() => bot.setControlState('forward', false), 600);
        }, 200);
        stuckCount = 0;
      }
    } else {
      stuckCount = 0;
    }
    lastPos = cur.clone();
  }, 3000);

  try {
    await Promise.race([
      gotoFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: pathfinding terlalu lama')), timeoutMs)
      ),
    ]);
  } finally {
    clearInterval(stuckChecker);
    ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].forEach(s => {
      try {
        bot.setControlState(s, false);
      } catch (_) {}
    });
  }
}

function hasItem(bot, itemName, minCount = 1) {
  const item = bot.inventory.items().find(i => i.name === itemName);
  return !!(item && item.count >= minCount);
}

function countItem(bot, itemName) {
  return bot.inventory
    .items()
    .filter(i => i.name === itemName)
    .reduce((sum, i) => sum + i.count, 0);
}

module.exports = { waitMs, randomInt, equipBest, withUnstuck, hasItem, countItem };
