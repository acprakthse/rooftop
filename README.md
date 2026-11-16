# Ardian Candra · 3D Rooftop PV & BESS Engineering Suite

Aplikasi web interaktif untuk pemodelan geometri **3D Rooftop Solar PV**, simulasi lintasan matahari (*sun-path & shadow casting*), serta *co-sizing* **Battery Energy Storage System (BESS)** dengan estetika *dark engineering* dari **ardiancandra.com**.

## Struktur Folder
```text
rooftop-pv-3d/
├── index.html          # Struktur UI utama & dashboard KPI
├── css/
│   └── style.css       # Custom stylesheet tema ardiancandra.com
├── js/
│   ├── main.js         # State management, event listener & preset proyek
│   ├── scene3d.js      # Mesin 3D WebGL (Three.js), atap, panel & raycasting
│   └── energy-model.js # Kalkulasi energi PV, BESS & grafik dispatch 24 jam
└── README.md
```

## Cara Menjalankan di Visual Studio / VS Code
1. Ekstrak file `rooftop-pv-3d-ardiancandra.zip`.
2. Buka folder `rooftop-pv-3d` di **Visual Studio Code** atau **Microsoft Visual Studio**.
3. Klik dua kali `index.html` untuk membuka langsung di browser, atau jalankan menggunakan ekstensi **Live Server** di VS Code.
