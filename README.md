# 🤖 Minecraft Multi-Bot

Kumpulan bot Minecraft otomatis yang dijalankan menggunakan **PM2**, dibangun dengan **Mineflayer**. Setiap bot memiliki skill masing-masing dan berjalan secara paralel.

---

## 📋 Daftar Bot

| Bot             | Username    | Skill       | Deskripsi                                                 |
| --------------- | ----------- | ----------- | --------------------------------------------------------- |
| `bot-petani`    | SiPetani    | 🌾 Farming  | Panen dan tanam ulang gandum secara otomatis              |
| `bot-penebang`  | SiPenebang  | 🪓 Logging  | Tebang pohon dan kumpulkan log kayu                       |
| `bot-penambang` | SiPenambang | ⛏️ Mining   | Tambang ore berdasarkan prioritas (diamond → iron → coal) |
| `bot-penjaga`   | SiPenjaga   | ⚔️ Guard    | Serang mob hostile di sekitar area                        |
| `bot-builder`   | SiBuilder   | 🧱 Building | Bangun platform/struktur secara otomatis                  |

---

## 📁 Struktur Folder

```
minecraft-bots/
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
- **PM2** (diinstall secara global)
- Akses ke server Minecraft (versi **1.21.1** atau kompatibel)

---

## 🚀 Instalasi

### 1. Clone repository

```bash
git clone https://github.com/username/minecraft-bots.git
cd minecraft-bots
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install PM2 secara global

```bash
npm install -g pm2
```

### 4. Buat folder logs

```bash
mkdir logs
```

### 5. Sesuaikan konfigurasi server

Edit bagian `CONFIG` di masing-masing file bot:

```javascript
const CONFIG = {
  host: 'minecraft.alfi-gusman.web.id', // ← ganti dengan IP/domain server kamu
  port: 25565, // ← ganti port jika berbeda
  username: 'NamaBot', // ← username bot
  auth: 'offline', // ← ganti ke 'microsoft' jika server online mode
};
```

---

## ▶️ Menjalankan Bot

### Jalankan semua bot sekaligus

```bash
pm2 start ecosystem.config.js
```

### Atau menggunakan npm script

```bash
npm start
```

---

## 🛠️ Perintah PM2

### Cek status semua bot

```bash
pm2 status
```

Contoh output:

```
┌─────┬──────────────────┬─────────────┬─────────┬─────────┬──────────┐
│ id  │ name             │ mode        │ status  │ cpu     │ memory   │
├─────┼──────────────────┼─────────────┼─────────┼─────────┼──────────┤
│ 0   │ bot-petani       │ fork        │ online  │ 0%      │ 45mb     │
│ 1   │ bot-penebang     │ fork        │ online  │ 0%      │ 43mb     │
│ 2   │ bot-penambang    │ fork        │ online  │ 0%      │ 44mb     │
│ 3   │ bot-penjaga      │ fork        │ online  │ 0%      │ 42mb     │
│ 4   │ bot-builder      │ fork        │ online  │ 0%      │ 46mb     │
└─────┴──────────────────┴─────────────┴─────────┴─────────┴──────────┘
```

### Lihat log semua bot

```bash
pm2 logs
```

### Lihat log bot tertentu

```bash
pm2 logs bot-petani
pm2 logs bot-penebang
pm2 logs bot-penambang
pm2 logs bot-penjaga
pm2 logs bot-builder
```

### Stop semua bot

```bash
pm2 stop ecosystem.config.js
# atau
npm run stop
```

### Restart semua bot

```bash
pm2 restart ecosystem.config.js
# atau
npm run restart
```

### Restart satu bot tertentu

```bash
pm2 restart bot-petani
```

### Hapus semua bot dari PM2

```bash
pm2 delete ecosystem.config.js
```

### Monitor real-time (dashboard)

```bash
pm2 monit
```

---

## 🔄 Auto-Start Saat Server Reboot

Agar bot otomatis berjalan kembali setelah VPS/server restart:

```bash
# Simpan daftar proses PM2 saat ini
pm2 save

# Generate startup script (ikuti instruksi yang muncul)
pm2 startup
```

---

## 📝 Detail Setiap Bot

### 🌾 Bot Petani (`bot-petani.js`)

Secara otomatis mencari tanaman gandum yang sudah dewasa (`age === 7`), memanen, lalu menanam ulang benih.

**Cara kerja:**

1. Scan area radius 16 blok untuk tanaman mature
2. Pathfind ke tanaman terdekat
3. Panen dengan `bot.dig()`
4. Cek inventory untuk benih (`wheat_seeds`)
5. Tanam ulang di atas `farmland`
6. Ulangi setiap 2 detik

**Yang dibutuhkan di inventory bot:**

- `wheat_seeds` (benih gandum)

**Kustomisasi:**

```javascript
// Ganti jenis tanaman di bot-petani.js
const cropId = mcData.blocksByName['wheat']?.id;
// Bisa diganti: 'carrot', 'potato', 'beetroot'
```

---

### 🪓 Bot Penebang (`bot-penebang.js`)

Mencari pohon terdekat dan menebang semua log dari bawah ke atas.

**Cara kerja:**

1. Scan area radius 32 blok untuk log kayu
2. Pathfind ke log terdekat
3. Tebang log dari bawah ke atas (max 10 blok)
4. Tunggu item drop
5. Ulangi setiap 3 detik

**Jenis kayu yang didukung:**

- `oak_log`, `birch_log`, `spruce_log`
- `jungle_log`, `acacia_log`, `dark_oak_log`

---

### ⛏️ Bot Penambang (`bot-penambang.js`)

Mencari dan menambang ore berdasarkan urutan prioritas nilai.

**Prioritas ore:**

1. 💎 Diamond Ore / Deepslate Diamond Ore
2. 🥇 Gold Ore / Deepslate Gold Ore
3. 🔩 Iron Ore / Deepslate Iron Ore
4. 🪨 Coal Ore / Deepslate Coal Ore
5. 🪨 Stone (fallback)

**Cara kerja:**

1. Cari ore dengan prioritas tertinggi dalam radius 16 blok
2. Auto-equip pickaxe terbaik yang ada di inventory
3. Pathfind ke ore, lalu tambang
4. Ulangi setiap 2.5 detik

**Yang dibutuhkan di inventory bot:**

- Minimal `wooden_pickaxe` atau lebih baik

---

### ⚔️ Bot Penjaga (`bot-penjaga.js`)

Mendeteksi dan menyerang mob hostile di sekitar area dalam radius 20 blok.

**Mob yang diserang:**

- `zombie`, `skeleton`, `spider`
- `creeper`, `enderman`, `witch`, `pillager`

**Cara kerja:**

1. Scan entitas setiap 1 detik
2. Temukan mob hostile terdekat dalam radius 20 blok
3. Auto-equip sword terbaik
4. Pathfind dan serang

**Fitur tambahan:**

- Auto makan jika `food < 16`
- Makanan yang dikenali: `bread`, `cooked_beef`, `cooked_chicken`, `apple`, `carrot`, `potato`

---

### 🧱 Bot Builder (`bot-builder.js`)

Membangun platform 5x5 di koordinat yang ditentukan.

**Cara kerja:**

1. Cek inventory untuk material bangunan
2. Iterasi blueprint (25 titik untuk platform 5x5)
3. Skip posisi yang sudah ada bloknya
4. Pathfind ke setiap posisi dan pasang blok
5. Cek ulang setiap 5 detik

**Material yang didukung:**

- `cobblestone`, `stone`, `dirt`, `oak_planks`

**Konfigurasi koordinat build:**

```javascript
// Di bot-builder.js, sesuaikan dengan lokasi server kamu
const BUILD_ORIGIN = new Vec3(100, 64, 100); // ← ubah koordinat ini
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

### Bot tidak bisa connect ke server

```
Error: connect ECONNREFUSED
```

- Pastikan IP/port di `CONFIG` sudah benar
- Pastikan server Minecraft sedang berjalan
- Cek firewall server

### Bot langsung disconnect / kicked

```
[BotName] Kicked: You are not whitelisted
```

- Tambahkan username bot ke whitelist server: `/whitelist add SiPetani`
- Atau nonaktifkan whitelist: `/whitelist off`

### Error `Cannot read properties of undefined`

- Biasanya karena versi `minecraft-data` tidak cocok dengan versi server
- Pastikan server berjalan di versi **1.21.1**
- Coba update semua package: `npm install mineflayer@latest`

### Bot stuck / tidak bergerak

- Pastikan area sekitar bot tidak diblok oleh struktur
- Periksa apakah `mineflayer-pathfinder` terinstall dengan benar
- Restart bot: `pm2 restart nama-bot`

### PM2 tidak ditemukan

```bash
# Install ulang PM2
npm install -g pm2

# Jika masih error, cek PATH Node.js
which pm2
```

---

## 🔧 Kustomisasi Lanjutan

### Menambah jenis tanaman (bot-petani)

```javascript
// Ganti 'wheat' dengan jenis lain
const cropId = mcData.blocksByName['carrot']?.id;
// Usia mature: carrot = 7, potato = 7, beetroot = 3
useExtraInfo: (b) => b.getProperties().age === 7,
```

### Menambah jenis ore (bot-penambang)

```javascript
const ORE_PRIORITY = [
  'ancient_debris', // ← tambahkan di paling atas untuk prioritas tertinggi
  'diamond_ore',
  'deepslate_diamond_ore',
  // ...
];
```

### Mengubah radius pencarian

```javascript
// Di setiap bot, ubah maxDistance
const block = bot.findBlock({
  matching: blockId,
  maxDistance: 32, // ← ubah sesuai kebutuhan
});
```

### Menambah bot baru ke PM2

Tambahkan entri baru di `ecosystem.config.js`:

```javascript
{
  name: 'bot-kustom',
  script: './bots/bot-kustom.js',
  watch: false,
  autorestart: true,
  max_restarts: 10,
  restart_delay: 10000,
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  out_file: './logs/kustom-out.log',
  error_file: './logs/kustom-err.log',
},
```

---

## 📄 Lisensi

MIT License — bebas digunakan dan dimodifikasi.

---

## 🙏 Credits

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) — PrismarineJS
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) — PrismarineJS
- [PM2](https://pm2.keymetrics.io/) — Keymetrics
