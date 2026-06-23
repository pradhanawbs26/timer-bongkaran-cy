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
const FONNTE_API_KEY = process.env.FONNTE_API_KEY || process.env.VITE_FONNTE_API_KEY || "iNfrBRnqQj4izhPo4PKL";
const FONNTE_TARGET_GROUP = process.env.FONNTE_TARGET_GROUP || process.env.VITE_FONNTE_TARGET_GROUP || "628117882902-1623340497@g.us";

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

      let updatedCount = 0;

      // Iterasi setiap sesi yang sedang berjalan menggunakan transaksi atomik (Idempotent)
      for (const docSnapshot of snapshot.docs) {
        const sessionId = docSnapshot.id;
        const ref = db.collection("sessions").doc(sessionId);

        try {
          const messageToSend = await db.runTransaction(async (transaction) => {
            const freshDoc = await transaction.get(ref);
            if (!freshDoc.exists) return null;
            const session = freshDoc.data();

            // Sesi harus bernilai RUNNING, jika sudah diselesaikan JANGAN melanjutkan alarm!
            if (session.status !== "RUNNING") {
              return null;
            }

            const startTimestamp = session.start_timestamp;
            const logs = session.logs || [];
            const flags = session.flags || {};
            
            // Durasi kotor (gross)
            const elapsedGross = nowSeconds - startTimestamp;

            // Skenario Sesi Terbengkalai (> 8 jam)
            if (elapsedGross > 8 * 3600) {
              console.log(`[Timer Engine Web Function] Sesi ${sessionId} dideteksi terbengkalai > 8 jam. Auto-complete.`);
              transaction.update(ref, {
                status: "COMPLETED",
                "flags.notif_completed": true, // bypass notifikasi selesai agar tidak spamming
                gross_duration_seconds: elapsedGross,
                net_duration_seconds: session.net_duration_seconds || elapsedGross,
              });
              return null;
            }

            // Hitung total akumulasi durasi pause (dari tabulasi RESUME)
            let totalPausedSeconds = 0;
            logs.forEach((log) => {
              if (log.type === "RESUME" && log.duration_seconds) {
                totalPausedSeconds += log.duration_seconds;
              }
            });

            // Jika sedang PAUSED, tambahkan durasi pause yang sedang berjalan
            if (session.status === "PAUSED" && session.last_paused_timestamp) {
              totalPausedSeconds += (nowSeconds - session.last_paused_timestamp);
            }

            const elapsedNet = elapsedGross - totalPausedSeconds;
            const elapsedNetMinutes = Math.floor(elapsedNet / 60);

            const updatePayload = {
              net_duration_seconds: elapsedNet,
              gross_duration_seconds: elapsedGross,
            };

            let internalMessage = "";
            let flagKeyToSet = "";

            // A. Notifikasi Fase 1 (Sesi Dimulai)
            if (!flags.notif_start) {
              internalMessage = `📢 *Bongkaran KA Dimulai*\n\nKA Nomor: *${session.train_number}*\nChecker: *${session.checker_name}*\nGroup Leader: *${session.groupleader_name}*\nWaktu Mulai: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB\nTarget Target: *120 Menit* (122 Kontainer)`;
              flagKeyToSet = "notif_start";
            }
            // B. Notifikasi 60 Menit
            else if (elapsedNetMinutes >= 60 && !flags.notif_60m) {
              internalMessage = `⏳ *Info 60 Menit Bongkaran KA-${session.train_number}*\n\nSiklus bongkaran telah berjalan 60 menit bersih.\nKontainer Terbongkar: *${session.unloaded_containers || 0}/122*.\nChecker: ${session.checker_name}`;
              flagKeyToSet = "notif_60m";
            }
            // C. Notifikasi 100 Menit (Warning)
            else if (elapsedNetMinutes >= 100 && !flags.notif_100m) {
              internalMessage = `⚠️ *Peringatan 100 Menit (Sisa 20 Menit Target)!*\n\nBongkaran KA-${session.train_number} telah berjalan *100 Menit*.\nStatus Kontainer: *${session.unloaded_containers || 0}* Terbongkar, *${122 - (session.unloaded_containers || 0)}* Sisa.\nHarap optimalkan kecepatan pembongkaran!`;
              flagKeyToSet = "notif_100m";
            }
            // C2. Notifikasi 110 Menit (Warning 10 Menit Sisa Target)
            else if (elapsedNetMinutes >= 110 && !flags.notif_110m) {
              internalMessage = `⚠️ *Peringatan 110 Menit (Sisa 10 Menit Target)!*\n\nBongkaran KA-${session.train_number} mendekati batas target standar (Sisa 10 Menit).\nStatus Kontainer: *${session.unloaded_containers || 0}/122* Terbongkar.\nHarap optimalkan kecepatan pembongkaran!`;
              flagKeyToSet = "notif_110m";
            }
            // D. Notifikasi 120 Menit (Critical Overtime)
            else if (elapsedNetMinutes >= 120 && !flags.notif_120m) {
              internalMessage = `🚨 *CRITICAL! Waktu Target Melampaui 120 Menit!*\n\nBongkaran KA-${session.train_number} melebihi batas standar (120 Menit).\nDurasi Bersih saat ini: *${elapsedNetMinutes} Menit*.\nKontainer Terbongkar: *${session.unloaded_containers || 0}/122*.\nButuh eskalasi dan tindakan cepat di lapangan!`;
              flagKeyToSet = "notif_120m";
            }
            // E. Notifikasi 180 Menit (Batas Akhir / Redline)
            else if (elapsedNetMinutes >= 180 && !flags.notif_180m) {
              internalMessage = `🛑 *MERAH! Batas Akhir 180 Menit Dilanggar!*\n\nBongkaran KA-${session.train_number} berada di batas merah operasional.\nDurasi Bersih: *${elapsedNetMinutes} Menit*.\nStatus Kontainer: *${session.unloaded_containers || 0}/122*. Checker: *${session.checker_name}*`;
              flagKeyToSet = "notif_180m";
            }
            // F. Notifikasi Overtime Berkala Setiap 10 Menit Terlewat dari Target 120 Menit
            else if (elapsedNetMinutes >= 120) {
              const excessMinutes = elapsedNetMinutes - 120;
              const currentInterval = Math.floor(excessMinutes / 10);
              const lastInterval = session.last_overtime_interval !== undefined && session.last_overtime_interval !== null 
                ? session.last_overtime_interval 
                : 0;

              if (currentInterval > lastInterval) {
                internalMessage = `⚠️ *Eskalasi Overtime Berkala! (Setiap 10 Menit)*\n\nBongkaran KA-${session.train_number} telah berjalan *${elapsedNetMinutes} Menit* murni.\nStatus Kontainer: *${session.unloaded_containers || 0}* Terbongkar, *${122 - (session.unloaded_containers || 0)}* Sisa.\nGroup Leader: *${session.groupleader_name}*\nSegera selesaikan sisa pembongkaran!`;
                updatePayload.last_overtime_interval = currentInterval;
                updatePayload.last_overtime_notif = nowSeconds;
              }
            }

            if (flagKeyToSet) {
              updatePayload[`flags.${flagKeyToSet}`] = true;
            }

            transaction.update(ref, updatePayload);
            return internalMessage;
          });

          if (messageToSend) {
            await sendWhatsAppMessage(FONNTE_TARGET_GROUP, messageToSend);
            updatedCount++;
          }
        } catch (txnError) {
          console.error(`[Cloud Function] Transaksi gagal pada sesi ${sessionId}:`, txnError);
        }
      }

      console.log(`[Timer Engine] Evaluasi Cloud Function selesai. Berhasil meng-update & mengirim ${updatedCount} notifikasi.`);
    } catch (error) {
      console.error("[Timer Engine] Terjadi kesalahan saat memeriksa sesi:", error);
    }

    return null;
  });
