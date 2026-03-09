// Fungsi-fungsi yang dipakai semua bot

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createReconnectHandler(botConfig, createBotFn) {
  return () => {
    console.log(`[${botConfig.username}] Koneksi terputus. Reconnect dalam 10 detik...`);
    setTimeout(() => createBotFn(), 10000);
  };
}

module.exports = { sleep, randomInt, createReconnectHandler };
