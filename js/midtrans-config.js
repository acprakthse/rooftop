// midtrans-config.js
// Konfigurasi Midtrans Snap (kunci CLIENT, aman tampil di browser karena
// hanya dipakai snap.js untuk menampilkan popup pembayaran).
// Isi clientKey dengan Client Key dari dashboard Midtrans (Access Keys).
// isProduction: false = sandbox (uji coba, tanpa uang asli),
// true = produksi (uang asli). Backend membaca env
// MIDTRANS_IS_PRODUCTION sendiri; kedua sisi harus sama.
window.MidtransConfig = {
  clientKey: 'PASTE-CLIENT-KEY',
  isProduction: false
};
