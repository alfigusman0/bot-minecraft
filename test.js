const mineflayer = require('mineflayer');

const bot = mineflayer.createBot({
  host: 'minecraft.alfi-gusman.web.id', // IP server kamu
  port: 25565, // Port server
  username: 'SiPetani', // Nama bot
  // password: 'pass_akun', // Hapus jika server offline mode atau pakai akun premium
  auth: 'offline', // 'microsoft' untuk akun premium, 'offline' untuk lokal/cracked
});

const mineflayer = require('mineflayer');

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  bot.chat(message);
});

// Log errors and kick reasons:
bot.on('kicked', console.log);
bot.on('error', console.log);
