# 🤖 Minecraft Bot — One Skill

Kumpulan 5 bot Minecraft yang masing-masing memiliki **satu skill khusus**, dijalankan secara paralel menggunakan **PM2**. Dibangun dengan [Mineflayer](https://github.com/PrismarineJS/mineflayer).

---

## 📋 Daftar Bot

| Bot             | Username    | Skill       | Deskripsi                               |
| --------------- | ----------- | ----------- | --------------------------------------- |
| `bot-petani`    | SiPetani    | 🌾 Farming  | Panen & tanam ulang gandum otomatis     |
| `bot-penebang`  | SiPenebang  | 🪓 Logging  | Tebang pohon & kumpulkan log kayu       |
| `bot-penambang` | SiPenambang | ⛏️ Mining   | Tambang ore berdasarkan prioritas nilai |
| `bot-penjaga`   | SiPenjaga   | ⚔️ Combat   | Serang mob hostile di sekitar area      |
| `bot-builder`   | SiBuilder   | 🧱 Building | Bangun platform/struktur otomatis       |

---

## 📁 Struktur Folder

```
bot-one-skill/
├── bots/
│   ├── bot-petani.js       # Bot farming wheat
│   ├── bot-penebang.js     # Bot menebang pohon
│   ├── bot-penambang.js    # Bot mining ore
│   ├── bot-penjaga.js      # Bot guard/combat
│   └── bot-builder.js      # Bot membangun struktur
├── shared/
│   └── utils.js            # Fungsi bersama (sleep, reconnect, dll)
├── logs/                   # Log output PM2 (auto-generated)
├── ecosystem.config.js     # Konfigurasi PM2
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
git clone https://github.com/username/bot-one-skill.git
cd bot-one-skill

# 2. Install dependencies
npm install

# 3. Install PM2
npm install -g pm2

# 4. Buat folder logs
mkdir logs
```

---

## ⚙️ Konfigurasi

Edit bagian `CONFIG` di masing-masing file bot di folder `bots/`:

```javascript
const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id', // ← IP/domain server
  port: 25565,
  username: 'NamaBot',
  auth: 'offline', // ganti 'microsoft' untuk server online mode
};
```

Untuk `bot-builder.js`, sesuaikan juga koordinat area build:

```javascript
const BUILD_ORIGIN = new Vec3(1150, 80, 28); // ← koordinat tujuan build
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

## 🛠️ Perintah PM2

```bash
pm2 status                        # Cek status semua bot
pm2 logs                          # Log semua bot
pm2 logs bot-petani               # Log bot tertentu
pm2 logs bot-petani --lines 100   # 100 baris terakhir
pm2 restart ecosystem.config.js   # Restart semua
pm2 stop ecosystem.config.js      # Stop semua
pm2 delete ecosystem.config.js    # Hapus dari PM2
pm2 monit                         # Dashboard real-time
```

---

## 🔄 Auto-Start Saat Reboot

```bash
pm2 save
pm2 startup
# Ikuti instruksi yang muncul di terminal
```

---

## 📝 Detail Setiap Bot

### 🌾 SiPetani

Mencari tanaman gandum mature (`age === 7`) dalam radius 32 blok, memanen, lalu menanam ulang benih.

**Item dibutuhkan:** `wheat_seeds`, `bone_meal` (opsional)

### 🪓 SiPenebang

Mencari log kayu terdekat dan menebang seluruh batang pohon dari bawah ke atas (max 15 log).

**Item dibutuhkan:** `iron_axe` atau lebih baik

**Kayu didukung:** oak, birch, spruce, jungle, acacia, dark_oak, mangrove, cherry

### ⛏️ SiPenambang

Mencari dan menambang ore dengan urutan prioritas tertinggi ke terendah.

**Prioritas:** ancient_debris → diamond → gold → iron → coal → stone

**Item dibutuhkan:** `diamond_pickaxe` atau lebih baik

### ⚔️ SiPenjaga

Mendeteksi mob hostile dalam radius 24 blok dan menyerang. Auto-makan jika food < 16.

**Mob diserang:** zombie, skeleton, spider, creeper, enderman, witch, pillager, husk, stray, drowned, phantom

**Item dibutuhkan:** `diamond_sword`, armor, makanan

### 🧱 SiBuilder

Membangun platform 5x5 di koordinat `BUILD_ORIGIN` yang ditentukan.

**Item dibutuhkan:** `cobblestone` / `stone` / `oak_planks`

---

## 🎮 Command Server (Minecraft)

Jalankan setelah semua bot online:

```
# Teleport semua bot ke area kerja
/tp SiPetani 1150 80 28
/tp SiPenebang 1150 80 28
/tp SiPenambang 1150 80 28
/tp SiPenjaga 1150 80 28
/tp SiBuilder 1150 80 28

# Set spawnpoint
/spawnpoint SiPetani 1150 83 28
/spawnpoint SiPenebang 1150 83 28
/spawnpoint SiPenambang 1150 83 28
/spawnpoint SiPenjaga 1150 83 28
/spawnpoint SiBuilder 1150 83 28

# Berikan item
/give SiPetani wheat_seeds 64
/give SiPenebang diamond_axe[enchantments={levels:{"minecraft:efficiency":5,"minecraft:unbreaking":3,"minecraft:fortune":3,"minecraft:mending":1}}] 1
/give SiPenambang diamond_pickaxe[enchantments={levels:{"minecraft:efficiency":5,"minecraft:unbreaking":3,"minecraft:fortune":3,"minecraft:mending":1}}] 1
/give SiPenjaga diamond_sword[enchantments={levels:{"minecraft:sharpness":5,"minecraft:unbreaking":3,"minecraft:looting":3,"minecraft:mending":1}}] 1
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

| Masalah                  | Solusi                                                  |
| ------------------------ | ------------------------------------------------------- |
| Bot tidak connect        | Cek IP/port di CONFIG, pastikan server aktif            |
| Bot di-kick whitelist    | `/whitelist add NamaBot` atau `/whitelist off`          |
| Bot diam tidak bergerak  | Cek area tidak terblok, restart: `pm2 restart nama-bot` |
| `Cannot read properties` | Update packages: `npm install mineflayer@latest`        |
| PM2 not found            | `npm install -g pm2`                                    |

---

## 📄 Lisensi

MIT License

---

## 🙏 Credits

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) — PrismarineJS
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) — PrismarineJS
- [PM2](https://pm2.keymetrics.io/) — Keymetrics
