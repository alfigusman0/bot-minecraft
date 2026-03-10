# 🏗️ Civilization Bot — Setup Guide

## Struktur Bot

Setiap instance bot dijalankan dengan environment variable:

```
BOT_USERNAME=<nama> PRIMARY_SKILL=<skill>
```

---

## 🔒 Dedicated Bots (Creative Mode)

Bot dengan `PRIMARY_SKILL=farming` atau `PRIMARY_SKILL=building` akan:

- **TIDAK pernah ganti job** — hanya jalankan skill utamanya
- **Berjalan dalam Creative Mode** — material selalu tersedia via `/give`
- **Auto-interrupt** hanya untuk combat darurat & tidur malam
- **Langsung kembali** ke skill utama setelah interrupt selesai

### Contoh PM2 / launch command:

```bash
# Bot Farming (dedicated + creative)
BOT_USERNAME=SiPetani PRIMARY_SKILL=farming node bot.js

# Bot Building (dedicated + creative)
BOT_USERNAME=SiPembangun PRIMARY_SKILL=building node bot.js

# Bot Mining (auto-mode, survival)
BOT_USERNAME=SiPenambang PRIMARY_SKILL=mining node bot.js

# Bot Logging (auto-mode, survival)
BOT_USERNAME=SiPenebang PRIMARY_SKILL=logging node bot.js
```

### PM2 Ecosystem (ecosystem.config.js):

```javascript
module.exports = {
  apps: [
    {
      name: 'SiPetani',
      script: 'bot.js',
      env: { BOT_USERNAME: 'SiPetani', PRIMARY_SKILL: 'farming' },
    },
    {
      name: 'SiPembangun',
      script: 'bot.js',
      env: { BOT_USERNAME: 'SiPembangun', PRIMARY_SKILL: 'building' },
    },
    {
      name: 'SiPenambang',
      script: 'bot.js',
      env: { BOT_USERNAME: 'SiPenambang', PRIMARY_SKILL: 'mining' },
    },
    {
      name: 'SiPenebang',
      script: 'bot.js',
      env: { BOT_USERNAME: 'SiPenebang', PRIMARY_SKILL: 'logging' },
    },
  ],
};
```

---

## 🎮 Syarat Server Minecraft

Untuk bot creative bisa `/give` sendiri, server harus:

1. **Op bot** di server: `/op SiPetani` dan `/op SiPembangun`
2. Atau aktifkan di `ops.json`
3. Atau gunakan plugin permission yang memberi bot akses `/give` dan `/gamemode`

Jika server tidak support op, bot creative tetap berjalan tapi material
diambil dari chest/storage normal.

---

## 📋 Chat Commands (hanya untuk OWNER = `aLG30`)

| Command                     | Fungsi                                             |
| --------------------------- | -------------------------------------------------- |
| `!help`                     | Daftar semua command                               |
| `!status`                   | Status bot saat ini + mode                         |
| `!civ`                      | Info sumber daya peradaban                         |
| `!bots`                     | Status semua bot online                            |
| `!jobs`                     | Distribusi skill semua bot                         |
| `!do <skill>`               | Paksa ganti skill (sementara)                      |
| `!stop`                     | Hentikan semua aktivitas                           |
| `!resume`                   | Lanjutkan aktivitas (dedicated kembali ke primary) |
| `!home`                     | Paksa kembali ke HOME_BASE                         |
| `!mode <creative/survival>` | Ganti gamemode                                     |
| `!give <item> [n]`          | /give item ke bot                                  |
| `!come`                     | Bot datang ke posisi kamu                          |
| `!follow [player]`          | Bot ikuti player                                   |
| `!unfollow`                 | Berhenti follow                                    |
| `!inv`                      | Lihat inventory bot                                |
| `!say <pesan>`              | Bot ucapkan pesan                                  |

---

## 🏗️ Arsitektur Alur Dedicated Bot

```
[SPAWN]
  ↓
ensureCreativeMode() → /gamemode creative
  ↓
goToHomeBase()
  ↓
startSkill(PRIMARY_SKILL)  ← hanya sekali
  ↓
startDedicatedLoop() setiap 5 detik:
  ├─ hostileMobs? → interrupt: combat → kembali
  ├─ malam? → interrupt: sleeping → kembali
  ├─ creative health/food? → /effect saturation/regen
  └─ ✅ skill utama tetap berjalan
```

---

## 🔄 Alur Auto-Mode Bot (mining, logging, dll)

```
[SPAWN]
  ↓
makeDecision() setiap 10 detik:
  ├─ hostileMobs? → combat
  ├─ malam? → sleeping
  ├─ primarySkill viable + slot tersedia? → primarySkill
  ├─ currentSkill masih viable + slot? → pertahankan
  └─ load-balance skill lain
```

---

## 📁 File yang Diubah

| File                | Perubahan                                             |
| ------------------- | ----------------------------------------------------- |
| `bot.js`            | Dedicated loop, creative mode helper, `/give` command |
| `decisionEngine.js` | Dedicated bot dilewati engine, tidak dihitung di slot |
| `storage.js`        | Creative bot `/give` langsung, bypass chest           |
| `civilization.js`   | Track primarySkill & mode per bot, `getSnapshot()`    |
