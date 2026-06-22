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
  getDoc,
  query, 
  where, 
  doc, 
  updateDoc, 
  addDoc, 
  writeBatch,
  runTransaction
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
  const activeApiKey = "iNfrBRnqQj4izhPo4PKL";
  const activeTargetGroup = "628117882902-1623340497@g.us";

  console.log(`[Fonnte Service] Mengirim Pesan WhatsApp:\nTarget: ${activeTargetGroup}\n--- START MESSAGE ---\n${message}\n--- END MESSAGE ---`);

  let dbLogStatus = "PENDING";
  let apiResponseData: any = null;

  // Mencoba 3 tingkat protokol berbeda (JSON POST, Form URL-Encoded, GET Request) demi keandalan mutlak
  const protocols = ["JSON_POST", "URL_ENCODED_POST", "GET_REQUEST"];
  let success = false;

  for (const protocol of protocols) {
    try {
      console.log(`[Fonnte Service] Mencoba pengiriman menggunakan protokol: ${protocol}`);
      let response;

      if (protocol === "JSON_POST") {
        response = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            "Authorization": activeApiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            target: activeTargetGroup,
            message: message
          }),
        });
      } else if (protocol === "URL_ENCODED_POST") {
        const params = new URLSearchParams();
        params.append("target", activeTargetGroup);
        params.append("message", message);

        response = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            "Authorization": activeApiKey
          },
          body: params,
        });
      } else {
        const getUrl = `https://api.fonnte.com/send/?token=${encodeURIComponent(activeApiKey)}&target=${encodeURIComponent(activeTargetGroup)}&message=${encodeURIComponent(message)}`;
        response = await fetch(getUrl, {
          method: "GET"
        });
      }

      apiResponseData = await response.json();
      console.log(`[Fonnte Service] Hasil pengiriman (${protocol}):`, apiResponseData);

      if (apiResponseData && (apiResponseData.status === true || apiResponseData.status === "true" || apiResponseData.status === "success" || apiResponseData.status === "sent")) {
        dbLogStatus = "SUCCESS_SENT";
        success = true;
        break; // Berhasil! Keluar dari loop protokol
      } else {
        dbLogStatus = `FAILED_${protocol}_API_${apiResponseData?.reason || apiResponseData?.message || "rejected"}`;
      }
    } catch (apiErr: any) {
      console.error(`[Fonnte Service] Gagal menembak protokol ${protocol}:`, apiErr);
      dbLogStatus = `FAILED_${protocol}_ERR_${apiErr?.message || "network_error"}`;
    }

    // Berikan jeda rintangan pendek sebelum beralih ke protokol alternatif berikutnya
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Simpan catatan pesan ke database "fonnte_logs" untuk sinkronisasi UI live feed dengan status aktual
  try {
    const logsRef = collection(db, "fonnte_logs");
    await addDoc(logsRef, {
      message: message,
      target: activeTargetGroup,
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

/**
 * Mengirim notifikasi dengan penguncian atomik berbasis transaksi Firestore (Idempotency).
 * Menjamin 1 pemicu hanya dikirim tepat 1 kali di seluruh platform (Client, Server, Cloud Functions).
 */
async function attemptSendNotificationWithLock(
  sessionId: string, 
  flagKey: string, 
  messageBuilder: (data: any) => string | Promise<string>,
  additionalUpdates?: Record<string, any>
): Promise<boolean> {
  const ref = doc(db, "sessions", sessionId);
  try {
    let messageToSend = "";
    const success = await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(ref);
      if (!docSnap.exists()) {
        return false;
      }
      const data = docSnap.data();
      const flags = data.flags || {};
      
      // Jika flag sudah bernilai true, berarti proses lain sudah mengirimkan pesan ini
      if (flags[flagKey]) {
        return false;
      }

      // Khusus: Jika status sesi dibilang sudah "COMPLETED" dan notifikasi yang dicoba dikirim
      // adalah notifikasi perjalanan (overtime, 60m, 180m, dll), JANGAN kirim!
      if (data.status === "COMPLETED" && flagKey !== "notif_completed") {
        return false;
      }

      messageToSend = await messageBuilder(data);
      
      // Update flag di database secara atomik dalam transaksi sebelum memicu API luar
      transaction.update(ref, {
        [`flags.${flagKey}`]: true,
        ...(additionalUpdates || {})
      });
      return true;
    });

    if (success && messageToSend) {
      console.log(`[Transaction Lock] Mengunci flag: ${flagKey} untuk sesi: ${sessionId}`);
      await sendFonnteMessage(messageToSend);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Transaction Lock] Kesalahan memproses lock flag ${flagKey}:`, err);
    return false;
  }
}

/**
 * Mengirim notifikasi berkala (Overtime) dengan penguncian atomik level interval.
 */
async function attemptSendOvertimeIntervalNotificationWithLock(
  sessionId: string,
  currentInterval: number,
  messageBuilder: () => string | Promise<string>
): Promise<boolean> {
  const ref = doc(db, "sessions", sessionId);
  try {
    let messageToSend = "";
    const success = await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(ref);
      if (!docSnap.exists()) {
        return false;
      }
      const data = docSnap.data();
      
      // Sesi harus bernilai RUNNING, jika sudah diselesaikan JANGAN mengirim alarm jam tambahan!
      if (data.status !== "RUNNING") {
        return false;
      }

      const lastInterval = data.last_overtime_interval !== undefined && data.last_overtime_interval !== null
        ? data.last_overtime_interval 
        : 0;
      
      if (lastInterval >= currentInterval) {
        return false;
      }

      messageToSend = await messageBuilder();
      
      transaction.update(ref, {
        last_overtime_interval: currentInterval,
        last_overtime_notif: Math.floor(Date.now() / 1000)
      });
      return true;
    });

    if (success && messageToSend) {
      console.log(`[Transaction Lock] Mengunci interval berkala (+${currentInterval * 10} mnt) untuk sesi: ${sessionId}`);
      await sendFonnteMessage(messageToSend);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Transaction Lock] Kesalahan memproses lock interval ${currentInterval}:`, err);
    return false;
  }
}

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
    const q = query(sessionsRef, where("status", "in", ["RUNNING", "PAUSED", "COMPLETED"]));
    const querySnapshot = await getDocs(q);

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (querySnapshot.empty) {
      if (nowSeconds % 30 < 5) {
        console.log(`[Simulation Engine] Engine is active. 0 active/paused/completed sessions currently found.`);
      }
      isRunningEngine = false;
      return;
    }

    console.log(`[Simulation Engine] Running. Found ${querySnapshot.size} session(s) in active monitoring.`);

    for (const document of querySnapshot.docs) {
      const session = document.data();
      const sessionId = document.id;
      const ref = doc(db, "sessions", sessionId);

      // Skenario Sesi Terbengkalai: Jika durasi gross melebihi 8 jam (28800 detik), auto-set COMPLETED secara senyap
      const elapsedGrossCheck = nowSeconds - session.start_timestamp;
      if (session.status !== "COMPLETED" && elapsedGrossCheck > 8 * 3600) {
        console.log(`[Simulation Engine] Sesi ${sessionId} (${session.train_number}) dideteksi terbengkalai > 8 jam. Auto-complete secara senyap.`);
        try {
          await updateDoc(ref, {
            status: "COMPLETED",
            "flags.notif_completed": true, // bypass agar tidak spamming pesan selesai
            net_duration_seconds: session.net_duration_seconds || 0,
            gross_duration_seconds: elapsedGrossCheck
          });
        } catch (err) {
          console.error("[Simulation Engine] Gagal menutup sesi terbengkalai:", err);
        }
        continue;
      }

      // Jika status sesi sudah COMPLETED, periksa apakah notifikasi penyelesaian sudah terkirim atau belum
      if (session.status === "COMPLETED") {
        const flags = session.flags || {};
        if (!flags.notif_completed) {
          const finalNetSec = session.net_duration_seconds || 0;
          const finalGrossSec = session.gross_duration_seconds || 0;
          const finalChecker = session.checker_name || "";
          const finalGroupLeader = session.groupleader_name || "";
          const finalTrainNo = formatTrainNumber(session.train_number || "");
          const finalLogs = session.logs || [];

          const totalDelaySeconds = finalGrossSec - finalNetSec;
          const totalDelayMinutes = Math.max(0, Math.floor(totalDelaySeconds / 60));
          const netMinutes = Math.floor(finalNetSec / 60);
          const grossMinutes = Math.floor(finalGrossSec / 60);

          interface DelayBreakdown { [key: string]: number }
          const breakdown: DelayBreakdown = {};
          
          for (let i = 0; i < finalLogs.length; i++) {
             if (finalLogs[i].type === "PAUSE" && finalLogs[i].reason) {
                const reason = finalLogs[i].reason;
                const resumeLog = finalLogs.slice(i).find((l: any) => l.type === "RESUME");
                const duration = resumeLog?.duration_seconds || 0;
                const minutes = Math.floor(duration / 60);
                breakdown[reason] = (breakdown[reason] || 0) + minutes;
             }
          }

          const detailStrings = Object.entries(breakdown).map(([reason, minutes]) => `${reason} (${minutes} mnt)`);
          const delayDetails = detailStrings.length > 0 ? detailStrings.join(", ") : "Tidak Ada Delay";

          const msg = `✅ *Bongkaran KA Selesai!*\n\nNomor KA: *${finalTrainNo}*\nSelesai Pada: ${new Date().toLocaleDateString("id-ID", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} WIB\nTarget Waktu: *120 Menit*\n*Net Duration:* ${netMinutes} Menit\n*Gross Duration:* ${grossMinutes} Menit (Total Delay *${totalDelayMinutes} Menit*)\n\n*Rincian Delay:* ${delayDetails}\n\nChecker: *${finalChecker}*\nGroup Leader: *${finalGroupLeader}*`;

          await attemptSendNotificationWithLock(sessionId, "notif_completed", () => msg);
        }
        continue;
      }

      const startTimestamp = session.start_timestamp;
      const logs = session.logs || [];
      
      // Menggunakan dynamic fallback spread pattern agar kebal terhadap properti flags historikal yang belum terisi
      const flags = {
        notif_start: false,
        notif_60m: false,
        notif_100m: false,
        notif_110m: false,
        notif_120m: false,
        notif_180m: false,
        ...(session.flags || {})
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

      // Jika status saat ini sedang PAUSED, tambahkan durasi pause yang sedang berjalan
      if (session.status === "PAUSED" && session.last_paused_timestamp) {
        totalPausedSeconds += (nowSeconds - session.last_paused_timestamp);
      }

      // 3. Durasi bersih (net)
      const elapsedNet = elapsedGross - totalPausedSeconds;
      const elapsedNetMinutes = Math.floor(elapsedNet / 60);

      console.log(`[Simulation Engine] Session ${sessionId} (${trainNo}): status=${session.status}, Gross=${elapsedGross}s, Net=${elapsedNet}s (${elapsedNetMinutes} mins). Flags: start=${flags.notif_start}, 60m=${flags.notif_60m}, 100m=${flags.notif_100m}`);

      const updatePayload: any = {
        net_duration_seconds: elapsedNet > 0 ? elapsedNet : 0,
        gross_duration_seconds: elapsedGross > 0 ? elapsedGross : 0,
      };

      // Hanya evaluasi pemicu notifikasi WhatsApp jika status sesi aktif "RUNNING"
      if (session.status === "RUNNING") {
        // --- FLAG TRIGGERS (ANTI-SPAM GATE) ---

        // A. Notifikasi Mulai (Fase 1)
        if (!flags.notif_start) {
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
          
          await attemptSendNotificationWithLock(sessionId, "notif_start", () => msg);
          continue;
        }

        // B. Notifikasi 60 Menit
        if (elapsedNetMinutes >= 60 && !flags.notif_60m) {
          const msg = `⏳ *Info 60 Menit Bongkaran ${trainNo}*\n\nSiklus bongkaran telah berjalan 60 menit bersih.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nChecker: *${session.checker_name}*`;
          
          await attemptSendNotificationWithLock(sessionId, "notif_60m", () => msg);
          continue;
        }

        // C. Notifikasi 100 Menit (Warning)
        if (elapsedNetMinutes >= 100 && !flags.notif_100m) {
          const msg = `⚠️ *Peringatan 100 Menit (Sisa 20 Menit Target)!*\n\nBongkaran ${trainNo} telah berjalan *100 Menit*.\nStatus Kontainer: *${session.unloaded_containers}* Terbongkar, *${122 - session.unloaded_containers}* Sisa.\nHarap tingkatkan koordinasi operasional!`;
          
          await attemptSendNotificationWithLock(sessionId, "notif_100m", () => msg);
          continue;
        }

        // C2. Notifikasi 110 Menit (Warning 10 Menit Sebelum Batas Target 120 Menit)
        if (elapsedNetMinutes >= 110 && !flags.notif_110m) {
          const msg = `⚠️ *Peringatan 110 Menit (Sisa 10 Menit Target)!*\n\nBongkaran ${trainNo} mendekati batas target standar (Sisa 10 Menit).\nStatus Kontainer: *${session.unloaded_containers}/122* Terbongkar.\nHarap optimalkan kecepatan pembongkaran!`;
          
          await attemptSendNotificationWithLock(sessionId, "notif_110m", () => msg);
          continue;
        }

        // D. Notifikasi 120 Menit (Critical Overtime)
        if (elapsedNetMinutes >= 120 && !flags.notif_120m) {
          const msg = `🚨 *CRITICAL! Waktu Target Melampaui 120 Menit!*\n\nBongkaran ${trainNo} melebihi batas standar (120 Menit).\nDurasi Bersih saat ini: *${elapsedNetMinutes} Menit*.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nButuh eskalasi cepat di lapangan!`;
          
          await attemptSendNotificationWithLock(sessionId, "notif_120m", () => msg);
          try {
            await updateDoc(ref, { last_overtime_notif: nowSeconds });
          } catch (e) {}
          continue;
        }

        // E. Notifikasi 180 Menit (Batas Akhir / Redline)
        if (elapsedNetMinutes >= 180 && !flags.notif_180m) {
          const msg = `🛑 *MERAH! Batas Akhir 180 Menit Dilanggar!*\n\nBongkaran ${trainNo} berada di batas merah operasional.\nDurasi Bersih: *${elapsedNetMinutes} Menit*.\nStatus Kontainer: *${session.unloaded_containers}/122*. Checker: *${session.checker_name}*`;
          
          await attemptSendNotificationWithLock(sessionId, "notif_180m", () => msg);
          continue;
        }

        // F. Notifikasi Overtime Berkala Setiap 10 Menit Terlewat dari Target 120 Menit (Net Duration)
        if (elapsedNetMinutes >= 120) {
          const excessMinutes = elapsedNetMinutes - 120;
          const currentInterval = Math.floor(excessMinutes / 10); // 1 untuk 130m, 2 untuk 140m, dst.
          const lastOvertimeInterval = (session.last_overtime_interval !== undefined && session.last_overtime_interval !== null) 
            ? session.last_overtime_interval 
            : 0;

          if (currentInterval > lastOvertimeInterval) {
            const msg = `⚠️ *Peringatan Overtime Berkala! Durasi Melebihi Target (+${currentInterval * 10} Menit)*\n\nBongkaran ${trainNo} telah melebihi target waktu standar.\nDurasi murni saat ini: *${elapsedNetMinutes} Menit* murni.\nStatus Kontainer: *${session.unloaded_containers}/122* Terbongkar.\nChecker: *${session.checker_name}*\nGroup Leader: *${session.groupleader_name}*`;
            
            await attemptSendOvertimeIntervalNotificationWithLock(sessionId, currentInterval, () => msg);
            continue;
          }
        }

        // Jika tidak ada trigger notifikasi, update durasi murni biasa secara instant
        await updateDoc(ref, updatePayload);
      } else {
        // Sesi sedang PAUSED: update durasi secara berkala tanpa evaluasi trigger alarm
        await updateDoc(ref, updatePayload);
      }
    }
  } catch (error) {
    console.error("[Simulation Engine] Error:", error);
  } finally {
    isRunningEngine = false;
  }
}

// Jalankan engine pendeteksi status dan timer setiap 5 detik
setInterval(runTimerSimulationEngine, 5000);

// API Endpoint untuk memproses pembaruan timer (tick/ping) dari client (browser) secara real-time
app.post("/api/sessions/:id/tick", async (req, res) => {
  try {
    // Jalankan kalkulasi timer dan evaluasi alarm notifikasi di sisi server secara instan
    await runTimerSimulationEngine();
    return res.json({ success: true, message: "Server-side tick processed, container warmed" });
  } catch (error: any) {
    console.error("[Tick Error] Gagal memproses tick:", error);
    return res.status(500).json({ error: error.message || "Gagal memproses tick" });
  }
});

// API Endpoint untuk memicu jalannya simulasi/evaluasi timer dari cron job luar gratis (misalnya cron-job.org atau vercel cron)
app.get("/api/cron-evaluate", async (req, res) => {
  try {
    console.log("[Cron API] Menerima trigger eksternal untuk pemindaian sesi aktif...");
    const wasRunning = isRunningEngine;
    if (wasRunning) {
      return res.json({ 
        success: true, 
        message: "Evaluasi timer sedang berjalan di latar belakang (simulasi aktif).",
        was_running: true 
      });
    }
    await runTimerSimulationEngine();
    return res.json({ 
      success: true, 
      message: "Evaluasi timer berhasil dipicu dan diselesaikan.", 
      was_running: false 
    });
  } catch (error: any) {
    console.error("[Cron API] Gagal memproses evaluasi timer:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/cron-evaluate", async (req, res) => {
  try {
    const wasRunning = isRunningEngine;
    if (wasRunning) {
      return res.json({ 
        success: true, 
        message: "Evaluasi timer sedang berjalan di latar belakang (simulasi aktif).",
        was_running: true 
      });
    }
    await runTimerSimulationEngine();
    return res.json({ 
      success: true, 
      message: "Evaluasi timer berhasil dipicu dan diselesaikan.", 
      was_running: false 
    });
  } catch (error: any) {
    console.error("[Cron API] Gagal memproses evaluasi timer:", error);
    return res.status(500).json({ error: error.message });
  }
});

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

    const success = await attemptSendNotificationWithLock(docId, "notif_start", () => msg);
    
    // Tahan kunci selama 30 detik untuk mengendapkan balapan ganda
    setTimeout(() => {
      activeSendingLocks.start.delete(id);
    }, 30000);

    if (success) {
      return res.json({ success: true, message: "Notifikasi mulai terkirim!" });
    } else {
      return res.json({ success: true, message: "Notifikasi mulai sudah pernah terkirim sebelumnya atau digagalkan oleh pengunci transaksi." });
    }
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

    // Ambil dokumen secara mandiri/langsung demi konsistensi maksimal
    let session: any = null;
    let docId = id;
    let ref = doc(db, "sessions", id);
    let docSnap = await getDoc(ref);

    if (docSnap.exists()) {
      session = docSnap.data();
    } else {
      const snapshot = await getDocs(query(collection(db, "sessions"), where("session_id", "==", id)));
      if (!snapshot.empty) {
        docSnap = snapshot.docs[0];
        session = docSnap.data();
        docId = docSnap.id;
        ref = doc(db, "sessions", docId);
      }
    }

    if (!session) {
      activeSendingLocks.completed.delete(id);
      return res.status(404).json({ error: "Sesi tidak ditemukan" });
    }

    const payloadNetSec = (req.body.net_duration_seconds !== undefined) ? req.body.net_duration_seconds : (session.net_duration_seconds || 0);
    const payloadGrossSec = (req.body.gross_duration_seconds !== undefined) ? req.body.gross_duration_seconds : (session.gross_duration_seconds || 0);
    
    const success = await attemptSendNotificationWithLock(docId, "notif_completed", (transactionData) => {
      const freshData = transactionData || session;
      
      // Gunakan request body sebagai fallback utama jika Firestore belum tuntas saat trigger dipanggil
      const finalNetSec = (req.body.net_duration_seconds !== undefined) ? req.body.net_duration_seconds : (freshData.net_duration_seconds || 0);
      const finalGrossSec = (req.body.gross_duration_seconds !== undefined) ? req.body.gross_duration_seconds : (freshData.gross_duration_seconds || 0);
      const finalChecker = req.body.checker_name || freshData.checker_name || "";
      const finalGroupLeader = req.body.groupleader_name || freshData.groupleader_name || "";
      const finalTrainNo = formatTrainNumber(req.body.train_number || freshData.train_number || "");
      const finalLogs = req.body.logs || freshData.logs || [];

      // Kirim notifikasi ringkasan penyelesaian via Fonnte
      const totalDelaySeconds = finalGrossSec - finalNetSec;
      const totalDelayMinutes = Math.max(0, Math.floor(totalDelaySeconds / 60));
      const netMinutes = Math.floor(finalNetSec / 60);
      const grossMinutes = Math.floor(finalGrossSec / 60);

      // Hitung rincian delay dari logs
      interface DelayBreakdown { [key: string]: number }
      const breakdown: DelayBreakdown = {};
      
      // Identifikasi rincian delay
      for (let i = 0; i < finalLogs.length; i++) {
         if (finalLogs[i].type === "PAUSE" && finalLogs[i].reason) {
            const reason = finalLogs[i].reason;
            // Cari resume berikutnya untuk hitung durasi delay
            const resumeLog = finalLogs.slice(i).find((l: any) => l.type === "RESUME");
            const duration = resumeLog?.duration_seconds || 0;
            const minutes = Math.floor(duration / 60);
            breakdown[reason] = (breakdown[reason] || 0) + minutes;
         }
      }

      const detailStrings = Object.entries(breakdown).map(([reason, minutes]) => `${reason} (${minutes} mnt)`);
      const delayDetails = detailStrings.length > 0 ? detailStrings.join(", ") : "Tidak Ada Delay";

      return `✅ *Bongkaran KA Selesai!*\n\nNomor KA: *${finalTrainNo}*\nSelesai Pada: ${new Date().toLocaleDateString("id-ID", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} WIB\nTarget Waktu: *120 Menit*\n*Net Duration:* ${netMinutes} Menit\n*Gross Duration:* ${grossMinutes} Menit (Total Delay *${totalDelayMinutes} Menit*)\n\n*Rincian Delay:* ${delayDetails}\n\nChecker: *${finalChecker}*\nGroup Leader: *${finalGroupLeader}*`;
    }, {
      status: "COMPLETED",
      net_duration_seconds: payloadNetSec,
      gross_duration_seconds: payloadGrossSec,
      last_paused_timestamp: null
    });
    
    // Tahan kunci selama 30 detik untuk meredam pemanggilan simultan dari browser
    setTimeout(() => {
      activeSendingLocks.completed.delete(id);
    }, 30000);

    if (success) {
      return res.json({ success: true, message: "Notifikasi penyelesaian terkirim!" });
    } else {
      return res.json({ success: true, message: "Notifikasi penyelesaian sudah pernah dikirim sebelumnya atau dibatalkan oleh pengunci transaksi." });
    }
  } catch (error: any) {
    activeSendingLocks.completed.delete(id);
    res.status(500).json({ error: error.message });
  }
});

// API Endpoint untuk Revisi Waktu Mulai
app.post("/api/sessions/:id/revise-notif", async (req, res) => {
  const { id } = req.params;
  const { oldStartTimestamp, newStartTimestamp, reason } = req.body;

  try {
    let session: any = null;
    const snapshot = await getDocs(query(collection(db, "sessions"), where("session_id", "==", id)));
    if (!snapshot.empty) {
      session = snapshot.docs[0].data();
    } else {
      const docSnap = await getDoc(doc(db, "sessions", id));
      if (docSnap.exists()) {
        session = docSnap.data();
      }
    }

    if (!session) {
      return res.status(404).json({ error: "Sesi tidak ditemukan" });
    }

    const trainNo = formatTrainNumber(session.train_number);

    const formatJktTime = (timestampSeconds: number) => {
      return new Date(timestampSeconds * 1000).toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }) + " WIB";
    };

    const oldTimeStr = formatJktTime(oldStartTimestamp);
    const newTimeStr = formatJktTime(newStartTimestamp);

    const msg = `✏️ *Revisi Waktu Mulai Bongkaran KA ${trainNo}*\n\n` +
      `Checker: *${session.checker_name}*\n` +
      `Waktu Semula: ${oldTimeStr}\n` +
      `Waktu Baru: *${newTimeStr}*\n` +
      `Alasan Revisi: *${reason || "Penyesuaian waktu operasional"}*`;

    await sendFonnteMessage(msg);
    res.json({ success: true });
  } catch (error: any) {
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
