/**
 * FILE: /functions/index.js
 * 
 * BANYAK KOMENTAR PENJELASAN UNTUK MEMBANTU IMPLEMENTASI DI LINGKUNGAN FIREBASE ASLI.
 * Kode di bawah ini adalah implementasi murni Firebase Cloud Functions (Node.js) 
 * menggunakan Firebase Functions SDK v1 dan Axios untuk memanggil API Fonnte.
 * 
 * Fungsi ini dijadwalkan berjalan setiap menit (Cron Job: * * * * *) untuk mengevaluasi
 * sesi bongkaran aktif, menghitung durasi murni (net), mengecek Idempotency Flags (Anti-Spam),
 * dan mengirim WhatsApp via Fonnte secara server-side.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

// Pastikan firebase-admin terinisialisasi
if (admin.apps.length === 0) {
  admin.initializeApp();
}

/**
 * Konfigurasi Fonnte API (Disarankan menggunakan Firebase Functions Config atau Secrets Manager)
 * Contoh perintah CLI Firebase untuk set:
 * firebase functions:secrets:set FONNTE_API_KEY=KunciAndaDisini
 * firebase functions:secrets:set FONNTE_TARGET_GROUP=NomorGrupWhatsApp
 */
const FONNTE_API_KEY = process.env.FONNTE_API_KEY || "SAMPLE_FONNTE_API_KEY_123456";
const FONNTE_TARGET_GROUP = process.env.FONNTE_TARGET_GROUP || "6281234567890-group";

/**
 * Fungsi Pembantu untuk Mengirim WhatsApp menggunakan Fonnte API
 */
async function sendWhatsAppMessage(target, message) {
  try {
    const response = await axios.post(
      "https://api.fonnte.com/send",
      {
        target: target,
        message: message,
      },
      {
        headers: {
          Authorization: FONNTE_API_KEY,
        },
      }
    );

    console.log(`Fonnte API Success: Send to ${target}, response:`, response.data);
    return true;
  } catch (error) {
    console.error(`Fonnte API Failed: Send to ${target}, error:`, error.response ? error.response.data : error.message);
    return false;
  }
}

/**
 * Cloud Function: monitoringBongkaranKA
 * Berjalan setiap 1 Menit sekali untuk mengevaluasi sesi RUNNING
 */
exports.monitoringBongkaranKA = functions.pubsub
  .schedule("* * * * *") // Cron Job: Setiap Menit
  .timeZone("Asia/Jakarta") // Zona waktu operasional
  .onRun(async (context) => {
    const db = admin.firestore();
    const nowSeconds = Math.floor(Date.now() / 1000);

    console.log(`[Timer Engine] Memulai evaluasi berkala pada timestamp detik: ${nowSeconds}`);

    try {
      // Ambil seluruh dokumen dengan status RUNNING
      const snapshot = await db
        .collection("sessions")
        .where("status", "==", "RUNNING")
        .get();

      if (snapshot.empty) {
        console.log("[Timer Engine] Tidak ada sesi bongkaran KA yang sedang aktif (RUNNING).");
        return null;
      }

      const batch = db.batch();
      let updatedCount = 0;

      // Iterasi setiap sesi yang sedang berjalan
      for (const doc of snapshot.docs) {
        const sessionRef = doc.ref;
        const session = doc.data();

        const sessionId = session.session_id;
        const trainNumber = session.train_number;
        const startTimestamp = session.start_timestamp;
        const logs = session.logs || [];
        const flags = session.flags || {
          notif_start: false,
          notif_60m: false,
          notif_100m: false,
          notif_120m: false,
          notif_180m: false,
        };

        // --- 1. HITUNG DURASI MURNI & DURASI KOTOR ---
        
        // Durasi Kotor (Gross): Dari start_timestamp hingga sekarang
        const elapsedGross = nowSeconds - startTimestamp;

        // Skenario Sesi Terbengkalai (> 8 jam): auto-complete secara senyap
        if (elapsedGross > 8 * 3600) {
          console.log(`[Timer Engine Web Function] Sesi ${sessionId} (${trainNumber}) dideteksi terbengkalai > 8 jam. Auto-complete.`);
          batch.update(sessionRef, {
            status: "COMPLETED",
            "flags.notif_completed": true, // bypass notifikasi selesai agar tidak spamming
            gross_duration_seconds: elapsedGross,
            net_duration_seconds: session.net_duration_seconds || elapsedGross,
          });
          continue;
        }

        // Hitung total akumulasi durasi pause (dari tabulasi RESUME)
        let totalPausedSeconds = 0;
        logs.forEach((log) => {
          if (log.type === "RESUME" && log.duration_seconds) {
            totalPausedSeconds += log.duration_seconds;
          }
        });

        // Durasi Bersih (Net): Gross dikurangi waktu tunda
        const elapsedNet = elapsedGross - totalPausedSeconds;
        const elapsedNetMinutes = Math.floor(elapsedNet / 60);

        console.log(
          `[KA-${trainNumber}] ID: ${sessionId} -> Gross: ${elapsedGross}s, Paused: ${totalPausedSeconds}s, Net: ${elapsedNet}s (${elapsedNetMinutes} mnt)`
        );

        const updatePayload = {
          net_duration_seconds: elapsedNet,
          gross_duration_seconds: elapsedGross,
        };

        // --- 2. LOGIKA IDEMPOTENCY FLAGS & NOTIFIKASI ANTI-SPAM ---
        
        // Notifikasi Fase 1 (Sesi Dimulai) - Jika belum dikirim
        if (!flags.notif_start) {
          const msg = `📢 *Bongkaran KA Dimulai*\n\nKA Nomor: *${trainNumber}*\nChecker: *${session.checker_name}*\nGroup Leader: *${session.groupleader_name}*\nWaktu Mulai: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\nTarget Target: *120 Menit* (122 Kontainer)`;
          
          flags.notif_start = true;
          updatePayload["flags.notif_start"] = true;
          
          await sendWhatsAppMessage(FONNTE_TARGET_GROUP, msg);
          updatedCount++;
        }

        // Notifikasi T waktu 60 Menit
        if (elapsedNetMinutes >= 60 && !flags.notif_60m) {
          const msg = `⏳ *Info 60 Menit Bongkaran KA-${trainNumber}*\n\nSiklus bongkaran telah berjalan 60 menit bersih.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nChecker: ${session.checker_name}`;
          
          flags.notif_60m = true;
          updatePayload["flags.notif_60m"] = true;
          
          await sendWhatsAppMessage(FONNTE_TARGET_GROUP, msg);
          updatedCount++;
        }

        // Notifikasi T waktu 100 Menit (Warning)
        if (elapsedNetMinutes >= 100 && !flags.notif_100m) {
          const msg = `⚠️ *Peringatan 100 Menit (Sisa 20 Menit Target)!*\n\nBongkaran KA-${trainNumber} telah berjalan *100 Menit*.\nStatus Kontainer: *${session.unloaded_containers}* Terbongkar, *${122 - session.unloaded_containers}* Sisa.\nHarap optimalkan kecepatan pembongkaran!`;
          
          flags.notif_100m = true;
          updatePayload["flags.notif_100m"] = true;
          
          await sendWhatsAppMessage(FONNTE_TARGET_GROUP, msg);
          updatedCount++;
        }

        // Notifikasi T waktu 120 Menit (Target Terlampaui - Critical)
        if (elapsedNetMinutes >= 120 && !flags.notif_120m) {
          const msg = `🚨 *CRITICAL! Waktu Target Melampaui 120 Menit!*\n\nBongkaran KA-${trainNumber} melebihi batas standar (120 Menit).\nDurasi Bersih saat ini: *${elapsedNetMinutes} Menit*.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nButuh eskalasi dan tindakan cepat di lapangan!`;
          
          flags.notif_120m = true;
          updatePayload["flags.notif_120m"] = true;
          
          await sendWhatsAppMessage(FONNTE_TARGET_GROUP, msg);
          updatedCount++;
        }

        // Notifikasi T waktu 180 Menit (Batas Akhir / Redline)
        if (elapsedNetMinutes >= 180 && !flags.notif_180m) {
          const msg = `🛑 *MERAH! Batas Akhir 180 Menit Dilanggar!*\n\nBongkaran KA-${trainNumber} berada di batas merah operasional.\nDurasi Bersih: *${elapsedNetMinutes} Menit*.\nStatus Kontainer: *${session.unloaded_containers}/122*. Checker: ${session.checker_name}`;
          
          flags.notif_180m = true;
          updatePayload["flags.notif_180m"] = true;
          
          await sendWhatsAppMessage(FONNTE_TARGET_GROUP, msg);
          updatedCount++;
        }

        // --- 3. LOGIKA NOTIFIKASI OVERTIME (INTERVAL 10 MENIT) ---
        if (elapsedNetMinutes >= 120) {
          const lastOvertimeNotif = session.last_overtime_notif; // dalam detik
          const secondsSinceLastNotif = lastOvertimeNotif ? (nowSeconds - lastOvertimeNotif) : null;

          // Jika belum pernah dikirim ATAU selisih >= 10 menit (600 detik)
          if (lastOvertimeNotif === null || (secondsSinceLastNotif !== null && secondsSinceLastNotif >= 600)) {
            const msg = `⚠️ *Eskalasi Overtime Berkala! (Setiap 10 Menit)*\n\nBongkaran KA-${trainNumber} telah berjalan *${elapsedNetMinutes} Menit* murni.\nStatus Kontainer: *${session.unloaded_containers}* Terbongkar, *${122 - session.unloaded_containers}* Sisa.\nGroup Leader: *${session.groupleader_name}*\nSegera selesaikan sisa pembongkaran!`;
            
            updatePayload.last_overtime_notif = nowSeconds;
            
            await sendWhatsAppMessage(FONNTE_TARGET_GROUP, msg);
            updatedCount++;
          }
        }

        // Jalankan update parsial ke Firebase Firestore
        batch.update(sessionRef, updatePayload);
      }

      await batch.commit();
      console.log(`[Timer Engine] Evaluasi selesai. Berhasil meng-update status/notif untuk ${updatedCount} trigger.`);
    } catch (error) {
      console.error("[Timer Engine] Terjadi kesalahan saat memeriksa sesi:", error);
    }

    return null;
  });
