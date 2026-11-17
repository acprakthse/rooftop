// Firebase configuration for login (public client config, safe to ship
// in a public page: the apiKey identifies the project, it is not a secret).
//
// Diisi 17 Nov 2026 dari Firebase console (Project settings > Your apps >
// Web app), project plnyes. Login aktif di frontend; penegakan kuota di
// backend aktif setelah env FIREBASE_PROJECT_ID diset di Cloud Run.
// authDomain memakai domain kustom auth.ardiancandra.com (CNAME ke
// plnyes.firebaseapp.com + terdaftar di Firebase Hosting) supaya layar
// pilih akun Google menampilkan domain sendiri, bukan plnyes.firebaseapp.com.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBOLzNV08D71CrwOmYPYl7_Uw2OIG5R1RA",
  authDomain: "auth.ardiancandra.com",
  databaseURL: "https://plnyes.firebaseio.com",
  projectId: "plnyes",
  storageBucket: "plnyes.appspot.com",
  messagingSenderId: "451921864170",
  appId: "1:451921864170:web:3f3d01f00d55657e0dbe93",
  measurementId: "G-84Z4YGKHFH"
};
