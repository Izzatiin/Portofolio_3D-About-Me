# 🌍 Nawfal's World — Portfolio Mohammad Nawfal Arfa

Portofolio interaktif berbentuk **planet mini 3D**. Pengunjung bisa berjalan-jalan dengan karakter kecil,
mampir ke tiap bangunan, dan membaca cerita, keterampilan, karya, serta kontak saya.

🔗 **Live Demo:** [Lihat Portfolio Saya](https://izzatiin.github.io/Portofolio-Mohammad-Nawfal-Arfa/)

---

## 🕹️ Cara Bermain

| Aksi | Desktop | HP / Tablet |
| --- | --- | --- |
| Jalan | `W` `A` `S` `D` / tombol panah | Joystick kiri bawah |
| Lari | Tahan `Shift` | Dorong joystick sampai penuh |
| Lompat | `Space` | Tombol ⤒ |
| Putar kamera | Seret layar | Seret layar |
| Zoom | Scroll | Cubit (pinch) |
| Masuk bangunan | Dekati (panel terbuka otomatis) atau `E` | Ketuk tombol "Masuk …" |

Menu di atas (**About Me, Skills, My Work, IZZA, Contact**) langsung membuka isi tanpa perlu bermain.

| Bangunan | Isi |
| --- | --- |
| 🏠 Rumah Nawfal | About Me |
| 🛠️ Bengkel Kreatif | Skills |
| 🔭 Observatorium IZZA | **Proyek terbaru:** IZZA, asisten AI lokal dari laptop ke ponsel (video promo diputar di ponsel raksasa) |
| 🎬 Bioskop Mini | My Work (IZZA, film *Simpang Kisah* & web pertama) |
| 📮 Kantor Pos | Contact + form pesan |

Ada juga satu tempat rahasia di sisi lain planet. 🔥

### 🤖 Tentang IZZA

[IZZA](https://github.com/Izzatiin/izza) adalah asisten AI lokal buatan saya: berjalan tanpa internet,
gratis, dan data tidak pernah meninggalkan perangkat. Berawal sebagai aplikasi web di laptop
(Python + Flask, model GGUF lewat LM Studio / llama.cpp, 450 uji otomatis), kini hadir di ponsel
dengan 16 model AI.

---

## 🛠️ Teknologi

* **HTML5, CSS3, JavaScript (ES Modules)**, tanpa proses build
* **[Three.js](https://threejs.org/) r169** (disimpan di `vendor/`), semua model dibuat secara prosedural di kode
* **EmailJS** untuk form kontak (dimuat saat panel Contact dibuka)

---

## 📁 Struktur Folder

* `index.html` — halaman utama (dunia 3D + panel konten)
* `world.js` — logika dunia 3D: planet, bangunan, karakter, kontrol, kamera, panel
* `world.css` — gaya tampilan (tema kertas krem & langit biru)
* `vendor/three.module.min.js` — library Three.js
* `assets/` — gambar yang sudah dikompres untuk versi 3D
* `assets/izza/` — logo, sampul, dan video promo IZZA (MP4 + WebM)
* `icon.jpg` — ikon tab browser

Jalankan secara lokal dengan server sederhana (ES module tidak bisa dibuka lewat `file://`):

```bash
python3 -m http.server 8000
# lalu buka http://localhost:8000
```

---

## 👤 Kontak

* **GitHub:** [@Izzatiin](https://github.com/Izzatiin)
* **Email:** nawfalarfa14@gmail.com
* **LinkedIn:** [Nawfal Arfa](https://www.linkedin.com/in/nawfal-arfa-496b3930b/)
