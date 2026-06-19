import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Personal Target Config dari User
export const personalConfig = {
  apiKey: "AIzaSyAL3pqPuz4Mio-KUhckHzT50tmT_V99hvM",
  authDomain: "timer-bongkaran-ka.firebaseapp.com",
  projectId: "timer-bongkaran-ka",
  storageBucket: "timer-bongkaran-ka.firebasestorage.app",
  messagingSenderId: "160885925974",
  appId: "1:160885925974:web:53b47a6621d24c67ea73f7",
  measurementId: "G-QMZ9KRD4EE"
};

// Pastikan tidak re-init jika app sudah dibuat
const app = getApps().length === 0 ? initializeApp(personalConfig) : getApp();

// Inisialisasi Firestore Database (menggunakan default database bawaan)
export const db = getFirestore(app);

export function getFirebaseMode(): "sandbox" | "personal" {
  return "personal";
}

export function setFirebaseMode(mode: "sandbox" | "personal") {
  // Fitur sandbox sudah dihapus sepenuhnya sesuai permintaan user
  localStorage.setItem("firebase_db_mode", "personal");
}

export default app;
