import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  query, 
  where, 
  doc, 
  updateDoc, 
  addDoc, 
  writeBatch 
} from "firebase/firestore";

// Load environment variables dari .env file
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Config: Personal Target Config dari User
const personalConfig = {
  apiKey: "AIzaSyAL3pqPuz4Mio-KUhckHzT50tmT_V99hvM",
  authDomain: "timer-bongkaran-ka.firebaseapp.com",
  projectId: "timer-bongkaran-ka",
  storageBucket: "timer-bongkaran-ka.firebasestorage.app",
  messagingSenderId: "160885925974",
  appId: "1:160885925974:web:53b47a6621d24c67ea73f7",
  measurementId: "G-QMZ9KRD4EE"
};

// Inisialisasi Apps & Databases tunggal eksklusif personal
const firebaseApp = initializeApp(personalConfig);
const db = getFirestore(firebaseApp);

// API Endpoint dummy untuk kompatibilitas frontend (agar tidak error)
app.post("/api/set-firebase-mode", (req, res) => {
  return res.json({ success: true, mode: "personal" });
});

app.get("/api/get-firebase-mode", (req, res) => {
  res.json({ mode: "personal" });
});

/**
 * Fonnte API Helper: Berfungsi mengirimkan payload asli ke Fonnte
 * dan sekaligus mencatat pengiriman ke Firestore di koleksi "fonnte_logs"
 * agar dapat dipantau di UI Dashboard secara langsung oleh user.
 */
async function sendFonnteMessage(message: string): Promise<void> {
  const apiKey = process.env.FONNTE_API_KEY || process.env.VITE_FONNTE_API_KEY || "iNfrBRnqQj4izhPo4PKL";
  const targetGroup = process.env.FONNTE_TARGET_GROUP || process.env.VITE_FONNTE_TARGET_GROUP || "628117882902-1623340497@g.us";

  console.log(`[Fonnte Service] Mengirim Pesan WhatsApp:\n--- START MESSAGE ---\n${message}\n--- END MESSAGE ---`);

  let dbLogStatus = "PENDING";
  let apiResponseData: any = null;

  // Mencoba pengiriman hingga 3 kali jika terjadi gangguan jaringan atau API error
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const params = new URLSearchParams();
      params.append("target", targetGroup);
      params.append("message", message);

      const response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Authorization": apiKey
        },
        body: params,
      });
      
      apiResponseData = await response.json();
      console.log(`[Fonnte Service] Hasil pengiriman API asli (Percobaan ke-${attempt}):`, apiResponseData);
      
      if (apiResponseData && (apiResponseData.status === true || apiResponseData.status === "true")) {
        dbLogStatus = "SUCCESS_SENT";
        break; // Berhasil, keluar dari loop retry
      } else {
        dbLogStatus = `FAILED_API_${apiResponseData?.reason || "unknown"}`;
      }
    } catch (apiErr: any) {
      console.error(`[Fonnte Service] Gagal menembak API Fonnte pada percobaan ke-${attempt}:`, apiErr);
      dbLogStatus = `FAILED_ERROR_${apiErr?.message || "unknown"}`;
    }

    if (attempt < maxAttempts) {
      // Tunggu 1.5 detik sebelum mencoba lagi
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Simpan catatan pesan ke database "fonnte_logs" untuk sinkronisasi UI live feed dengan status aktual
  try {
    const logsRef = collection(db, "fonnte_logs");
    await addDoc(logsRef, {
      message: message,
      target: targetGroup,
      timestamp: Date.now(),
      status: dbLogStatus,
      raw_response: apiResponseData || null
    });
  } catch (err) {
    console.error("Gagal menambahkan log Fonnte ke Firestore:", err);
  }
}

/**
 * Helper to ensure a train number starts with exactly one 'KA-' prefix, and matches "KA-[Nomor]" precisely.
 */
function formatTrainNumber(no: string): string {
  const norm = (no || "").trim();
  if (!norm) return "KA-UNKNOWN";
  // Remove any repeating "KA-" prefix from the beginning
  let cleaned = norm.replace(/^(KA-)+/gi, "");
  // Remove "KA" if it's attached directly without a dash, e.g., "KA3564" -> "3564"
  cleaned = cleaned.replace(/^KA/gi, "");
  return `KA-${cleaned.trim()}`;
}

// Set pencatatan untuk menghindari pengiriman pesan WhatsApp ganda/balapan secara in-memory
const activeSendingLocks = {
  start: new Set<string>(),
  completed: new Set<string>(),
  pauses: new Set<string>(), // Menyimpan string kombinasi id dan alasan: `${id}-${reason}`
  resumes: new Set<string>()   // Menyimpan string kombinasi id dan alasan: `${id}-${reason}`
};

let isRunningEngine = false;

/**
 * SIMULASI CLOUD FUNCTION UNTUK DEMO & TESTING INTERAKTIF
 * Fungsi ini berjalan setiap 5 DETIK di server backend untuk mendeteksi
 * perubahan waktu, durasi murni (net), mengevaluasi Idempotency Flags (Anti-Spam),
 * dan menembakkan Fonnte API secara real-time demi pengalaman testing terbaik.
 */
async function runTimerSimulationEngine() {
  if (isRunningEngine) {
    return;
  }
  isRunningEngine = true;

  try {
    const sessionsRef = collection(db, "sessions");
    const q = query(sessionsRef, where("status", "==", "RUNNING"));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const document of querySnapshot.docs) {
      const session = document.data();
      const sessionId = document.id;
      const ref = doc(db, "sessions", sessionId);

      const startTimestamp = session.start_timestamp;
      const logs = session.logs || [];
      const flags = session.flags || {
        notif_start: false,
        notif_60m: false,
        notif_100m: false,
        notif_120m: false,
        notif_180m: false
      };

      const trainNo = formatTrainNumber(session.train_number);

      // 1. Durasi kotor (gross)
      const elapsedGross = nowSeconds - startTimestamp;

      // 2. Akumulasi pause
      let totalPausedSeconds = 0;
      logs.forEach((log: any) => {
        if (log.type === "RESUME" && log.duration_seconds) {
          totalPausedSeconds += log.duration_seconds;
        }
      });

      // 3. Durasi bersih (net)
      const elapsedNet = elapsedGross - totalPausedSeconds;
      const elapsedNetMinutes = Math.floor(elapsedNet / 60);

      const updatePayload: any = {
        net_duration_seconds: elapsedNet,
        gross_duration_seconds: elapsedGross,
      };

      // --- FLAG TRIGGERS (ANTI-SPAM GATE) ---

      // A. Notifikasi Mulai (Fase 1)
      if (!flags.notif_start && !activeSendingLocks.start.has(sessionId)) {
        activeSendingLocks.start.add(sessionId);

        const formatJktTime = (timestampSeconds: number) => {
          return new Date(timestampSeconds * 1000).toLocaleTimeString("id-ID", {
            timeZone: "Asia/Jakarta",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          }) + " WIB";
        };
        const startTimeStr = formatJktTime(session.start_timestamp);
        const targetTimeStr = formatJktTime(session.start_timestamp + 120 * 60);
        const limitTimeStr = formatJktTime(session.start_timestamp + 180 * 60);

        const msg = `📢 *Bongkaran KA Dimulai*\n\n` +
          `KA Nomor: *${trainNo}*\n` +
          `Checker: *${session.checker_name}*\n` +
          `Group Leader: *${session.groupleader_name}*\n` +
          `Waktu Mulai: *${startTimeStr}*\n` +
          `Target Selesai: *${targetTimeStr}* (120 Menit / 122 Kontainer)\n` +
          `Batas Akhir: *${limitTimeStr}* (180 Menit)`;
        
        // Simpan flag "notif_start = true" ke Firestore SECEPAT MUNGKIN sebelum fetch API
        await updateDoc(ref, {
          ...updatePayload,
          "flags.notif_start": true
        });
        await sendFonnteMessage(msg);
        
        setTimeout(() => {
          activeSendingLocks.start.delete(sessionId);
        }, 30000);
        continue;
      }

      // B. Notifikasi 60 Menit
      if (elapsedNetMinutes >= 60 && !flags.notif_60m) {
        const msg = `⏳ *Info 60 Menit Bongkaran ${trainNo}*\n\nSiklus bongkaran telah berjalan 60 menit bersih.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nChecker: *${session.checker_name}*`;
        
        await updateDoc(ref, {
          ...updatePayload,
          "flags.notif_60m": true
        });
        await sendFonnteMessage(msg);
        continue;
      }

      // C. Notifikasi 100 Menit (Warning)
      if (elapsedNetMinutes >= 100 && !flags.notif_100m) {
        const msg = `⚠️ *Peringatan 100 Menit (Sisa 20 Menit Target)!*\n\nBongkaran ${trainNo} telah berjalan *100 Menit*.\nStatus Kontainer: *${session.unloaded_containers}* Terbongkar, *${122 - session.unloaded_containers}* Sisa.\nHarap tingkatkan koordinasi operasional!`;
        
        await updateDoc(ref, {
          ...updatePayload,
          "flags.notif_100m": true
        });
        await sendFonnteMessage(msg);
        continue;
      }

      // D. Notifikasi 120 Menit (Critical Overtime)
      if (elapsedNetMinutes >= 120 && !flags.notif_120m) {
        const msg = `🚨 *CRITICAL! Waktu Target Melampaui 120 Menit!*\n\nBongkaran ${trainNo} melebihi batas standar (120 Menit).\nDurasi Bersih saat ini: *${elapsedNetMinutes} Menit*.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nButuh eskalasi cepat di lapangan!`;
        
        await updateDoc(ref, {
          ...updatePayload,
          "flags.notif_120m": true
        });
        await sendFonnteMessage(msg);
        continue;
      }

      // E. Notifikasi 180 Menit (Batas Akhir / Redline)
      if (elapsedNetMinutes >= 180 && !flags.notif_180m) {
        const msg = `🛑 *MERAH! Batas Akhir 180 Menit Dilanggar!*\n\nBongkaran ${trainNo} berada di batas merah operasional.\nDurasi Bersih: *${elapsedNetMinutes} Menit*.\nStatus Kontainer: *${session.unloaded_containers}/122*. Checker: *${session.checker_name}*`;
        
        await updateDoc(ref, {
          ...updatePayload,
          "flags.notif_180m": true
        });
        await sendFonnteMessage(msg);
        continue;
      }

      // F. Notifikasi Overtime Berkala Setiap 10 Menit (600 Detik)
      if (elapsedNetMinutes >= 120) {
        const lastOvertimeNotif = session.last_overtime_notif; // detik
        const secondsSinceLastNotif = lastOvertimeNotif ? (nowSeconds - lastOvertimeNotif) : null;

        if (lastOvertimeNotif === null || (secondsSinceLastNotif !== null && secondsSinceLastNotif >= 600)) {
          const msg = `⚠️ *Eskalasi Overtime Berkala! (Keterlambatan)*\n\nBongkaran ${trainNo} telah berjalan *${elapsedNetMinutes} Menit* murni.\nStatus Kontainer: *${session.unloaded_containers}* Terbongkar, *${122 - session.unloaded_containers}* Sisa.\nGroup Leader: *${session.groupleader_name}*`;
          
          await updateDoc(ref, {
            ...updatePayload,
            "last_overtime_notif": nowSeconds
          });
          await sendFonnteMessage(msg);
          continue;
        }
      }

      // Jika tidak ada trigger notifikasi, update durasi murni biasa secara instant
      await updateDoc(ref, updatePayload);
    }
  } catch (error) {
    console.error("[Simulation Engine] Error:", error);
  } finally {
    isRunningEngine = false;
  }
}

// Jalankan engine pendeteksi status dan timer setiap 5 detik
setInterval(runTimerSimulationEngine, 5000);

// API Endpoint untuk memicu Notifikasi Mulai (Fase 1: Mulai)
app.post("/api/sessions/:id/start-notif", async (req, res) => {
  const { id } = req.params;
  try {
    if (activeSendingLocks.start.has(id)) {
      return res.json({ success: true, message: "Notifikasi mulai sedang diproses..." });
    }
    activeSendingLocks.start.add(id);

    const snapshot = await getDocs(query(collection(db, "sessions"), where("session_id", "==", id)));
    if (snapshot.empty) {
      activeSendingLocks.start.delete(id);
      return res.status(404).json({ error: "Sesi tidak ditemukan" });
    }
    const session = snapshot.docs[0].data();
    const docId = snapshot.docs[0].id;
    const ref = doc(db, "sessions", docId);

    // Kirim jika flag notif belum diset
    if (!session.flags?.notif_start) {
      // Set flag di Firestore secepatnya
      await updateDoc(ref, {
        "flags.notif_start": true
      });

      const trainNo = formatTrainNumber(session.train_number);
      const formatJktTime = (timestampSeconds: number) => {
        return new Date(timestampSeconds * 1000).toLocaleTimeString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }) + " WIB";
      };
      
      const startTimeStr = formatJktTime(session.start_timestamp);
      const targetTimeStr = formatJktTime(session.start_timestamp + 120 * 60);
      const limitTimeStr = formatJktTime(session.start_timestamp + 180 * 60);

      const msg = `📢 *Bongkaran KA Dimulai*\n\n` +
        `KA Nomor: *${trainNo}*\n` +
        `Checker: *${session.checker_name}*\n` +
        `Group Leader: *${session.groupleader_name}*\n` +
        `Waktu Mulai: *${startTimeStr}*\n` +
        `Target Selesai: *${targetTimeStr}* (120 Menit / 122 Kontainer)\n` +
        `Batas Akhir: *${limitTimeStr}* (180 Menit)`;

      await sendFonnteMessage(msg);
    }
    
    // Tahan kunci selama 30 detik untuk mengendapkan balapan ganda
    setTimeout(() => {
      activeSendingLocks.start.delete(id);
    }, 30000);

    res.json({ success: true, message: "Notifikasi mulai terkirim!" });
  } catch (error: any) {
    activeSendingLocks.start.delete(id);
    res.status(500).json({ error: error.message });
  }
});

// API Endpoint untuk memicu Notifikasi Akhir (Fase 4: Selesai)
app.post("/api/sessions/:id/complete-notif", async (req, res) => {
  const { id } = req.params;
  try {
    if (activeSendingLocks.completed.has(id)) {
      return res.json({ success: true, message: "Notifikasi penyelesaian sedang diproses..." });
    }
    activeSendingLocks.completed.add(id);

    const snapshot = await getDocs(query(collection(db, "sessions"), where("session_id", "==", id)));
    
    if (snapshot.empty) {
       activeSendingLocks.completed.delete(id);
       return res.status(404).json({ error: "Sesi tidak ditemukan" });
    }
    
    const docSnap = snapshot.docs[0];
    const session = docSnap.data();
    const docId = docSnap.id;
    const ref = doc(db, "sessions", docId);
    
    const flags = session.flags || {};
    if (flags.notif_completed) {
      activeSendingLocks.completed.delete(id);
      return res.json({ success: true, message: "Notifikasi penyelesaian sudah pernah dikirim sebelumnya." });
    }

    // Set flag ke Firestore secepatnya sebelum kita buat API call eksternal Fonnte
    await updateDoc(ref, {
      "flags.notif_completed": true
    });
    
    // Kirim notifikasi ringkasan penyelesaian via Fonnte
    const totalDelaySeconds = (session.gross_duration_seconds || 0) - (session.net_duration_seconds || 0);
    const totalDelayMinutes = Math.floor(totalDelaySeconds / 60);
    const netMinutes = Math.floor((session.net_duration_seconds || 0) / 60);
    const grossMinutes = Math.floor((session.gross_duration_seconds || 0) / 60);

    // Hitung rincian delay dari logs
    interface DelayBreakdown { [key: string]: number }
    const breakdown: DelayBreakdown = {};
    const logs = session.logs || [];
    
    // Identifikasi rincian delay
    for (let i = 0; i < logs.length; i++) {
       if (logs[i].type === "PAUSE" && logs[i].reason) {
          const reason = logs[i].reason;
          // Cari resume berikutnya untuk hitung durasi delay
          const resumeLog = logs.slice(i).find((l: any) => l.type === "RESUME");
          const duration = resumeLog?.duration_seconds || 0;
          const minutes = Math.floor(duration / 60);
          breakdown[reason] = (breakdown[reason] || 0) + minutes;
       }
    }

    const detailStrings = Object.entries(breakdown).map(([reason, minutes]) => `${reason} (${minutes} mnt)`);
    const delayDetails = detailStrings.length > 0 ? detailStrings.join(", ") : "Tidak Ada Delay";

    const trainNo = formatTrainNumber(session.train_number);
    const msg = `✅ *Bongkaran KA Selesai!*\n\nNomor KA: *${trainNo}*\nSelesai Pada: ${new Date().toLocaleDateString("id-ID", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} WIB\nTarget Target: *120 Menit*\n*Net Duration:* ${netMinutes} Menit\n*Gross Duration:* ${grossMinutes} Menit (Total Delay *${totalDelayMinutes} Menit*)\n\n*Rincian Delay:* ${delayDetails}\n\nChecker: *${session.checker_name}*\nGroup Leader: *${session.groupleader_name}*`;

    await sendFonnteMessage(msg);
    
    // Tahan kunci selama 30 detik untuk meredam pemanggilan simultan dari browser
    setTimeout(() => {
      activeSendingLocks.completed.delete(id);
    }, 30000);

    res.json({ success: true, message: "Notifikasi penyelesaian terkirim!" });
  } catch (error: any) {
    activeSendingLocks.completed.delete(id);
    res.status(500).json({ error: error.message });
  }
});

// API Endpoint untuk Notifikasi Mulai Delay (PAUSE)
app.post("/api/sessions/:id/pause-notif", async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const lockKey = `${id}-${reason}`;

  try {
    if (activeSendingLocks.pauses.has(lockKey)) {
      return res.json({ success: true, message: "Notifikasi delay mulai untuk alasan ini sudah diproses." });
    }
    activeSendingLocks.pauses.add(lockKey);

    const snapshot = await getDocs(query(collection(db, "sessions"), where("session_id", "==", id)));
    if (snapshot.empty) {
      activeSendingLocks.pauses.delete(lockKey);
      return res.status(404).json({ error: "Sesi tidak ditemukan" });
    }
    const session = snapshot.docs[0].data();
    
    const nowJkt = new Date().toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }) + " WIB";

    const trainNo = formatTrainNumber(session.train_number);
    const msg = `⏳ *Delay Bongkaran ${trainNo} Dimulai*\n\nAlasan Delay: *${reason}*\nWaktu Mulai Delay: *${nowJkt}*\nJumlah Terbongkar: *${session.unloaded_containers}/122*\nChecker: *${session.checker_name}*`;
    
    await sendFonnteMessage(msg);

    // Hapus dari lock setelah 20 detik untuk mengizinkan delay dengan alasan sama di lain waktu
    setTimeout(() => {
      activeSendingLocks.pauses.delete(lockKey);
    }, 20000);

    res.json({ success: true });
  } catch (error: any) {
    activeSendingLocks.pauses.delete(lockKey);
    res.status(500).json({ error: error.message });
  }
});

// API Endpoint untuk Notifikasi Delay Selesai (RESUME)
app.post("/api/sessions/:id/resume-notif", async (req, res) => {
  const { id } = req.params;
  const { duration_seconds, reason } = req.body;
  const lockKey = `${id}-${reason}`;

  try {
    if (activeSendingLocks.resumes.has(lockKey)) {
      return res.json({ success: true, message: "Notifikasi delay selesai untuk alasan ini sudah diproses." });
    }
    activeSendingLocks.resumes.add(lockKey);

    const snapshot = await getDocs(query(collection(db, "sessions"), where("session_id", "==", id)));
    if (snapshot.empty) {
      activeSendingLocks.resumes.delete(lockKey);
      return res.status(404).json({ error: "Sesi tidak ditemukan" });
    }
    const session = snapshot.docs[0].data();
    
    const durationMinutes = Math.floor((duration_seconds || 0) / 60);

    const trainNo = formatTrainNumber(session.train_number);
    const msg = `▶️ *Bongkaran ${trainNo} Dilanjutkan*\n\nHambatan Selesai: *${reason || "Delay selesai"}*\nDurasi Hambatan: *${durationMinutes} Menit*\nJumlah Terbongkar: *${session.unloaded_containers}/122*\nChecker: *${session.checker_name}*`;
    
    await sendFonnteMessage(msg);

    // Hapus dari lock setelah 20 detik
    setTimeout(() => {
      activeSendingLocks.resumes.delete(lockKey);
    }, 20000);

    res.json({ success: true });
  } catch (error: any) {
    activeSendingLocks.resumes.delete(lockKey);
    res.status(500).json({ error: error.message });
  }
});

// Mounting Vite middleware untuk melayani frontend React dalam mode dev dan prod
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
