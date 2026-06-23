import { db } from "../firebaseClient";
import { collection, addDoc, doc, getDoc } from "firebase/firestore";
import { UnloadingSession } from "../types";

/**
 * Ambil konfigurasi Fonnte secara dinamis dari dokumen Firestore (sessions/settings_fonnte).
 */
async function getFonnteCredentialsClient(): Promise<{ apiKey: string; targetGroup: string }> {
  try {
    const docSnap = await getDoc(doc(db, "sessions", "settings_fonnte"));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.apiKey && data.targetGroup) {
        return {
          apiKey: data.apiKey,
          targetGroup: data.targetGroup
        };
      }
    }
  } catch (err) {
    console.warn("[Client Fonnte credentials] Gagal mengambil dari Firestore:", err);
  }
  const apiKey = (import.meta as any).env.VITE_FONNTE_API_KEY || "iNfrBRnqQj4izhPo4PKL";
  const targetGroup = (import.meta as any).env.VITE_FONNTE_TARGET_GROUP || "628117882902-1623340497@g.us";
  return { apiKey, targetGroup };
}

/**
 * Helper to ensure a train number starts with exactly one 'KA-' prefix.
 */
export function formatTrainNumber(no: string): string {
  const norm = (no || "").trim();
  if (!norm) return "KA-UNKNOWN";
  let cleaned = norm.replace(/^(KA-)+/gi, "");
  cleaned = cleaned.replace(/^KA/gi, "");
  return `KA-${cleaned.trim()}`;
}

/**
 * Sends a WhatsApp message directly via Fonnte API from the client-side.
 * Logs the output to Firestore "fonnte_logs" so it updates the web UI feed in real-time.
 */
export async function sendFonnteMessageClient(message: string): Promise<boolean> {
  const creds = await getFonnteCredentialsClient();
  const activeApiKey = creds.apiKey;
  const activeTargetGroup = creds.targetGroup;

  console.log(`[Client Fonnte Service] Mengirim Pesan WhatsApp:\nTarget: ${activeTargetGroup}\n--- START MESSAGE ---\n${message}\n--- END MESSAGE ---`);

  // Try 3 protocol levels for absolute reliability (JSON, URL encoded, or GET)
  const protocols = ["JSON_POST", "URL_ENCODED_POST", "GET_REQUEST"];
  let success = false;
  let lastError = "Gagal di seluruh protokol";
  let apiResponseData: any = null;

  for (const protocol of protocols) {
    try {
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
        response = await fetch(getUrl, { method: "GET" });
      }

      apiResponseData = await response.json();
      console.log(`[Client Fonnte] Protokol ${protocol} respon:`, apiResponseData);

      if (apiResponseData && (apiResponseData.status === true || apiResponseData.status === "true" || apiResponseData.status === "success" || apiResponseData.status === "sent")) {
        success = true;
        break; 
      } else {
        lastError = apiResponseData?.reason || apiResponseData?.message || `Ditolak oleh API (${protocol})`;
      }
    } catch (err: any) {
      lastError = err.message || `Kendala jaringan (${protocol})`;
    }
  }

  // Register real-time log into Firestore
  try {
    const dbLogStatus = success ? "SUCCESS_SENT" : `FAILED_API_${lastError}`;
    await addDoc(collection(db, "fonnte_logs"), {
      message: message,
      target: activeTargetGroup,
      timestamp: Date.now(),
      status: dbLogStatus,
      raw_response: apiResponseData || { error: lastError }
    });
  } catch (err) {
    console.error("[Client Fonnte Log] Gagal mencatat log ke Firestore:", err);
  }

  return success;
}

export async function triggerStartNotificationClient(session: UnloadingSession | any): Promise<void> {
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

  await sendFonnteMessageClient(msg);
}

export async function triggerPauseNotificationClient(session: UnloadingSession | any, reason: string): Promise<void> {
  const nowJkt = new Date().toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }) + " WIB";

  const trainNo = formatTrainNumber(session.train_number);
  const msg = `⏳ *Delay Bongkaran ${trainNo} Dimulai*\n\nAlasan Delay: *${reason}*\nWaktu Mulai Delay: *${nowJkt}*\nJumlah Terbongkar: *${session.unloaded_containers}/122*\nChecker: *${session.checker_name}*`;
  
  await sendFonnteMessageClient(msg);
}

export async function triggerResumeNotificationClient(session: UnloadingSession | any, reason: string, durationSeconds: number): Promise<void> {
  const durationMinutes = Math.floor((durationSeconds || 0) / 60);
  const trainNo = formatTrainNumber(session.train_number);
  const msg = `▶️ *Bongkaran ${trainNo} Dilanjutkan*\n\nHambatan Selesai: *${reason || "Delay selesai"}*\nDurasi Hambatan: *${durationMinutes} Menit*\nJumlah Terbongkar: *${session.unloaded_containers}/122*\nChecker: *${session.checker_name}*`;
  
  await sendFonnteMessageClient(msg);
}

export async function triggerCompleteNotificationClient(session: UnloadingSession | any): Promise<void> {
  const finalNetSec = session.net_duration_seconds || 0;
  const finalGrossSec = session.gross_duration_seconds || 0;
  const finalChecker = session.checker_name;
  const finalGroupLeader = session.groupleader_name;
  const finalTrainNo = formatTrainNumber(session.train_number);
  const finalLogs = session.logs || [];

  const totalDelaySeconds = finalGrossSec - finalNetSec;
  const totalDelayMinutes = Math.max(0, Math.floor(totalDelaySeconds / 60));
  const netMinutes = Math.floor(finalNetSec / 60);
  const grossMinutes = Math.floor(finalGrossSec / 60);

  const breakdown: Record<string, number> = {};
  
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

  await sendFonnteMessageClient(msg);
}

export async function triggerRevisionNotificationClient(
  session: UnloadingSession | any,
  oldStartTimestamp: number,
  newStartTimestamp: number,
  reason: string
): Promise<void> {
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
  const newTargetTimeStr = formatJktTime(newStartTimestamp + 120 * 60);
  const newLimitTimeStr = formatJktTime(newStartTimestamp + 180 * 60);

  const msg = `✏️ *Revisi Waktu Mulai Bongkaran*\n\n` +
    `KA Nomor: *${trainNo}*\n` +
    `Checker: *${session.checker_name}*\n` +
    `Group Leader: *${session.groupleader_name || "-"}*\n\n` +
    `Waktu Mulai Lama: *${oldTimeStr}*\n` +
    `Waktu Mulai Baru: *${newTimeStr}*\n` +
    `Target Selesai Baru: *${newTargetTimeStr}* (120 Menit / 122 Kontainer)\n` +
    `Batas Akhir Baru: *${newLimitTimeStr}* (180 Menit)\n\n` +
    `Alasan Revisi: *${reason || "Terlewat start timer"}*`;

  await sendFonnteMessageClient(msg);
}

