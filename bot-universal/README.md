# 🤖 Minecraft Bot — Universal (Multi-Skill)

5 bot Minecraft dengan **skill utama masing-masing** yang bisa otomatis berpindah ke skill lain jika kondisi tidak memadai. Dikendalikan via **chat in-game** oleh owner, dijalankan dengan **PM2**.

---

## 📋 Daftar Bot & Skill Utama

| Bot           | Username    | Skill Utama | Auto-Switch Ke                 |
| ------------- | ----------- | ----------- | ------------------------------ |
| `SiPetani`    | SiPetani    | 🌾 Farming  | Mining jika tidak ada wheat    |
| `SiPenebang`  | SiPenebang  | 🪓 Logging  | Mining jika tidak ada pohon    |
| `SiPenambang` | SiPenambang | ⛏️ Mining   | Logging jika tidak ada ore     |
| `SiPenjaga`   | SiPenjaga   | ⚔️ Combat   | Farming jika tidak ada mob     |
| `SiBuilder`   | SiBuilder   | 🧱 Building | Mining jika tidak ada material |

> **Auto-Switch:** Jika skill utama tidak bisa dijalankan (tidak ada target, habis material, dll), bot otomatis pindah ke skill fallback. Combat selalu menjadi prioritas tertinggi jika ada mob hostile di dekat bot manapun.

---

## 📁 Struktur Folder

```
bot-universal/
├── bots/
│   └── universal-bot.js    # File bot utama (dipakai semua instance)
├── skills/
│   ├── farming.js          # Skill bertani
│   ├── mining.js           # Skill menambang
│   ├── logging.js          # Skill menebang pohon
│   ├── combat.js           # Skill bertarung
│   └── building.js         # Skill membangun
├── shared/
│   └── utils.js            # Fungsi bersama
├── logs/                   # Log output PM2 (auto-generated)
├── ecosystem.config.js     # Konfigurasi PM2 (5 instance)
├── package.json
├── .gitignore
└── README.md
```

---

## ⚙️ Requirements

- **Node.js** >= v18.x
- **npm** >= v9.x
- **PM2** (global)
- Server Minecraft versi **1.21.1**

---

## 🚀 Instalasi

```bash
# 1. Clone repository
git clone https://github.com/username/bot-universal.git
cd bot-universal

# 2. Install dependencies
npm install

# 3. Install PM2
npm install -g pm2

# 4. Buat folder logs
mkdir logs
```

---

## ⚙️ Konfigurasi

Edit bagian `CONFIG` di `bots/universal-bot.js`:

```javascript
const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id', // ← IP/domain server
  port: 25565,
  auth: 'offline',
  version: '1.21.1',
};
```

Edit daftar owner yang boleh memberi perintah:

```javascript
const OWNERS = ['aLG30']; // ← hanya aLG30 yang bisa kasih perintah
```

---

## ▶️ Menjalankan Bot

```bash
# Jalankan semua bot
pm2 start ecosystem.config.js

# Atau via npm
npm start
```

---

## 🎮 Perintah In-Game (Chat)

Ketik di chat Minecraft. **Hanya `aLG30` yang bisa memberi perintah.**

### Perintah Dasar

| Perintah  | Fungsi                              |
| --------- | ----------------------------------- |
| `!help`   | Tampilkan semua perintah            |
| `!status` | Cek posisi, HP, skill aktif, mode   |
| `!skills` | Daftar skill tersedia & skill aktif |

### Mengatur Skill

| Perintah       | Fungsi                                         |
| -------------- | ---------------------------------------------- |
| `!do farming`  | Paksa aktifkan skill farming                   |
| `!do mining`   | Paksa aktifkan skill mining                    |
| `!do logging`  | Paksa aktifkan skill logging                   |
| `!do combat`   | Paksa aktifkan skill combat                    |
| `!do building` | Paksa aktifkan skill building                  |
| `!stop`        | Hentikan skill saat ini                        |
| `!auto`        | Toggle mode otomatis (bot pilih skill sendiri) |
| `!main`        | Kembali ke skill utama bot                     |

### Pergerakan

| Perintah           | Fungsi                    |
| ------------------ | ------------------------- |
| `!come`            | Bot datang ke posisimu    |
| `!follow <player>` | Bot mengikuti player      |
| `!unfollow`        | Berhenti mengikuti        |
| `!tp <x> <y> <z>`  | Teleport bot ke koordinat |

### Inventory & Item

| Perintah       | Fungsi                     |
| -------------- | -------------------------- |
| `!inv`         | Lihat isi inventory        |
| `!drop <item>` | Buang item dari inventory  |
| `!eat`         | Bot makan jika ada makanan |

### Building

| Perintah     | Fungsi                                      |
| ------------ | ------------------------------------------- |
| `!build set` | Set titik awal build di posisi bot sekarang |

### Lainnya

| Perintah       | Fungsi                |
| -------------- | --------------------- |
| `!say <pesan>` | Bot berbicara di chat |

---

## 🔄 Sistem Auto-Switch

Bot memiliki sistem **auto-switch** yang berjalan di background setiap 10 detik:

```
Prioritas Auto-Switch:
1. ⚔️  Combat    — jika ada mob hostile dalam radius 16 blok (SELALU prioritas utama)
2. 🌾 Farming   — jika ada wheat / punya seeds (skill utama SiPetani)
3. 🪓 Logging   — jika ada pohon di sekitar (skill utama SiPenebang)
4. ⛏️  Mining    — jika ada ore di sekitar (skill utama SiPenambang)
5. 🧱 Building  — jika ada material di inventory (skill utama SiBuilder)
```

Setiap skill memiliki fungsi `isViable()` yang mengecek apakah kondisi saat ini mendukung skill tersebut. Jika skill utama tidak viable, bot akan mencoba skill lain secara berurutan berdasarkan prioritas di atas.

Gunakan `!auto` untuk mengaktifkan/menonaktifkan mode ini, atau `!main` untuk paksa kembali ke skill utama.

---

## 🛠️ Perintah PM2

```bash
pm2 status                        # Status semua bot
pm2 logs                          # Log semua bot
pm2 logs SiPetani                 # Log bot tertentu
pm2 logs SiPetani --lines 100     # 100 baris terakhir
pm2 restart ecosystem.config.js   # Restart semua
pm2 stop ecosystem.config.js      # Stop semua
pm2 restart SiPetani              # Restart satu bot
pm2 monit                         # Dashboard real-time
```

---

## 🔄 Auto-Start Saat Reboot

```bash
pm2 save
pm2 startup
# Ikuti instruksi yang muncul
```

---

## 🎮 Setup Awal di Server Minecraft

Jalankan setelah semua bot online:

```
# Set world spawn
/setworldspawn 1150 83 28

# Teleport semua bot
/tp @a 1150 80 28

# Set spawnpoint personal
/spawnpoint @a 1150 83 28

# Berikan item lengkap dengan enchantment
/give SiPetani wheat_seeds 64
/give SiPetani bone_meal 64
/give SiPenebang diamond_axe[enchantments={levels:{"minecraft:efficiency":5,"minecraft:unbreaking":3,"minecraft:fortune":3,"minecraft:mending":1}}] 1
/give SiPenambang diamond_pickaxe[enchantments={levels:{"minecraft:efficiency":5,"minecraft:unbreaking":3,"minecraft:fortune":3,"minecraft:mending":1}}] 1
/give SiPenjaga diamond_sword[enchantments={levels:{"minecraft:sharpness":5,"minecraft:unbreaking":3,"minecraft:looting":3,"minecraft:mending":1,"minecraft:fire_aspect":2,"minecraft:sweeping_edge":3}}] 1
/give SiPenjaga diamond_helmet[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1
/give SiPenjaga diamond_chestplate[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1
/give SiPenjaga diamond_leggings[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}] 1
/give SiPenjaga diamond_boots[enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1,"minecraft:feather_falling":4}}] 1
/give SiBuilder cobblestone 64
/give SiBuilder cobblestone 64
/give SiBuilder cobblestone 64
```

---

## 📦 Dependencies

| Package                 | Versi   | Fungsi                    |
| ----------------------- | ------- | ------------------------- |
| `mineflayer`            | ^4.23.0 | Core bot library          |
| `mineflayer-pathfinder` | ^2.4.5  | Navigasi & pathfinding    |
| `minecraft-data`        | ^3.68.0 | Data item/block Minecraft |
| `vec3`                  | ^0.1.10 | Operasi koordinat 3D      |

---

## 🐛 Troubleshooting

| Masalah                       | Solusi                                               |
| ----------------------------- | ---------------------------------------------------- |
| Bot tidak connect             | Cek IP/port di CONFIG, pastikan server aktif         |
| Perintah tidak direspon       | Pastikan username di `OWNERS = ['aLG30']`            |
| Bot diam / tidak switch skill | Ketik `!auto` untuk aktifkan auto-switch             |
| Bot stuck tidak bisa jalan    | `pm2 restart NamaBot`                                |
| Skill tidak berjalan          | Cek `!inv` — pastikan bot punya item yang dibutuhkan |
| Bot di-kick whitelist         | `/whitelist add NamaBot` atau `/whitelist off`       |

---

## 🔧 Menambah Owner

Edit `bots/universal-bot.js`:

```javascript
const OWNERS = ['aLG30', 'NamaOwnerBaru']; // ← tambahkan username di sini
```

---

## 🔧 Menambah Skill Baru

1. Buat file baru di `skills/namaSkill.js` dengan struktur:

```javascript
module.exports = function namaSkill(bot, mcData) {
  let active = false;
  let interval = null;

  function isViable() {
    // return true jika kondisi mendukung skill ini
    return true;
  }

  async function run() {
    if (active) return;
    active = true;
    try {
      // logika skill di sini
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }
    active = false;
  }

  return {
    name: 'namaSkill',
    label: '🔧 Nama Skill',
    isViable,
    start() {
      interval = setInterval(run, 2000);
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
      active = false;
    },
  };
};
```

2. Daftarkan di `bots/universal-bot.js`:

```javascript
const namaSkill = require('../skills/namaSkill');

// Di dalam fungsi createBot, setelah spawn:
skills['namaSkill'] = namaSkill(bot, mcData);
```

---

## 📄 Lisensi

MIT License

---

## 🙏 Credits

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) — PrismarineJS
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) — PrismarineJS
- [PM2](https://pm2.keymetrics.io/) — Keymetrics
