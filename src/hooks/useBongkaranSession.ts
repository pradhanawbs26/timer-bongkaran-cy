import { useState, useEffect, useCallback, useRef } from "react";
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { db } from "../firebaseClient";
import { UnloadingSession, SessionStatus, DelayLog } from "../types";
import {
  formatTrainNumber,
  sendFonnteMessageClient,
  triggerPauseNotificationClient,
  triggerResumeNotificationClient,
  triggerCompleteNotificationClient,
  triggerRevisionNotificationClient
} from "../utils/whatsappNotification";

export function useBongkaranSession(sessionId: string | null) {
  const [session, setSession] = useState<UnloadingSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Lock untuk mencegah double-trigger di browser dalam rentang milidetik Firebase sync
  const clientPushedFlagsRef = useRef<Record<string, boolean>>({});

  // Perhitungan dinamis durasi murni (net) dan kotor (gross)
  // Untuk memastikan kebal terhadap device sleep atau refresh browser.
  const [liveNetSeconds, setLiveNetSeconds] = useState<number>(0);
  const [liveGrossSeconds, setLiveGrossSeconds] = useState<number>(0);

  // Subscribe ke dokumen sesi di Firestore secara real-time
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const docRef = doc(db, "sessions", sessionId);

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as UnloadingSession;
          setSession(data);
          setError(null);
        } else {
          setSession(null);
          setError("Sesi tidak ditemukan di database.");
        }
        setLoading(false);
      },
      (err) => {
        console.error("Gagal mendengarkan perubahan Firestore: ", err);
        setError("Koneksi bermasalah atau hak akses ditolak.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sessionId]);

  // Hook interval untuk meng-update live timer setiap detik secara lokal
  // berdasarkan single source of truth (start_timestamp dan riwayat delay)
  useEffect(() => {
    if (!session) {
      setLiveNetSeconds(0);
      setLiveGrossSeconds(0);
      return;
    }

    if (session.status === "INIT") {
      setLiveNetSeconds(0);
      setLiveGrossSeconds(0);
      return;
    }

    if (session.status === "COMPLETED") {
      setLiveNetSeconds(session.net_duration_seconds);
      setLiveGrossSeconds(session.gross_duration_seconds);
      return;
    }

    const interval = setInterval(() => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      
      // 1. Gross Duration: Selisih sejak mulai sampai sekarang
      const elapsedGross = nowSeconds - session.start_timestamp;
      
      // 2. Hitung total waktu hambatan (paused duration)
      let totalPausedDuration = 0;
      session.logs.forEach((log) => {
        if (log.type === "RESUME" && log.duration_seconds) {
          totalPausedDuration += log.duration_seconds;
        }
      });

      // Jika status saat ini sedang PAUSE, tambahkan durasi pause berjalan
      if (session.status === "PAUSED" && session.last_paused_timestamp) {
        totalPausedDuration += (nowSeconds - session.last_paused_timestamp);
      }

      // 3. Net Duration: Durasi kotor dikurangi total hambatan
      const elapsedNet = elapsedGross - totalPausedDuration;

      setLiveGrossSeconds(elapsedGross > 0 ? elapsedGross : 0);
      setLiveNetSeconds(elapsedNet > 0 ? elapsedNet : 0);

      // --- LOGIKA EVALUASI ALARM/NOTIFIKASI CLIENT-SIDE ---
      // Berguna jika server offline, dalam mode Serverless, atau dideploy di Vercel
      if (session.status === "RUNNING") {
        const elapsedNetMinutes = Math.floor(elapsedNet / 60);
        const flags = session.flags || {
          notif_start: false,
          notif_60m: false,
          notif_100m: false,
          notif_110m: false,
          notif_120m: false,
          notif_180m: false,
        };

        const docRef = doc(db, "sessions", sessionId);

        const triggerClientNotification = async (flagKey: string, messageText: string, additionalPayload: Record<string, any> = {}) => {
          const lockKey = `${session.session_id}-${flagKey}`;
          if (clientPushedFlagsRef.current[lockKey]) return;
          clientPushedFlagsRef.current[lockKey] = true;

          console.log(`[Client Evaluator] Memicu notifikasi alarm: ${flagKey}`);
          try {
            await updateDoc(docRef, {
              [`flags.${flagKey}`]: true,
              ...additionalPayload
            });
            await sendFonnteMessageClient(messageText);
          } catch (err) {
            console.error(`[Client Evaluator] Gagal mengirim alarm ${flagKey}:`, err);
            clientPushedFlagsRef.current[lockKey] = false;
          }
        };

        const trainNoStr = formatTrainNumber(session.train_number);

        // A. Notifikasi 60 Menit
        if (elapsedNetMinutes >= 60 && !flags.notif_60m) {
          const msg = `⏳ *Info 60 Menit Bongkaran ${trainNoStr}*\n\nSiklus bongkaran telah berjalan 60 menit bersih.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nChecker: *${session.checker_name}*`;
          triggerClientNotification("notif_60m", msg);
        }

        // B. Notifikasi 100 Menit
        if (elapsedNetMinutes >= 100 && !flags.notif_100m) {
          const msg = `⚠️ *Peringatan 100 Menit (Sisa 20 Menit Target)!*\n\nBongkaran ${trainNoStr} telah berjalan *100 Menit*.\nStatus Kontainer: *${session.unloaded_containers}* Terbongkar, *${122 - session.unloaded_containers}* Sisa.\nHarap optimalkan kecepatan pembongkaran!`;
          triggerClientNotification("notif_100m", msg);
        }

        // C. Notifikasi 110 Menit
        if (elapsedNetMinutes >= 110 && !flags.notif_110m) {
          const msg = `⚠️ *Peringatan 110 Menit (Sisa 10 Menit Target)!*\n\nBongkaran ${trainNoStr} mendekati batas target standar (Sisa 10 Menit).\nStatus Kontainer: *${session.unloaded_containers}/122* Terbongkar.\nHarap koordinasikan percepatan kerja!`;
          triggerClientNotification("notif_110m", msg);
        }

        // D. Notifikasi 120 Menit
        if (elapsedNetMinutes >= 120 && !flags.notif_120m) {
          const nowSec = Math.floor(Date.now() / 1000);
          const msg = `🚨 *CRITICAL! Waktu Target Melampaui 120 Menit!*\n\nBongkaran ${trainNoStr} melebihi batas standar (120 Menit).\nDurasi Bersih saat ini: *${elapsedNetMinutes} Menit*.\nKontainer Terbongkar: *${session.unloaded_containers}/122*.\nButuh eskalasi cepat di lapangan!`;
          triggerClientNotification("notif_120m", msg, { last_overtime_notif: nowSec });
        }

        // E. Notifikasi 180 Menit
        if (elapsedNetMinutes >= 180 && !flags.notif_180m) {
          const msg = `🛑 *MERAH! Batas Akhir 180 Menit Dilanggar!*\n\nBongkaran ${trainNoStr} berada di batas merah operasional.\nDurasi Bersih: *${elapsedNetMinutes} Menit*.\nStatus Kontainer: *${session.unloaded_containers}/122*. Checker: *${session.checker_name}*`;
          triggerClientNotification("notif_180m", msg);
        }

        // F. Overtime berkala setiap +10 menit setelah 120 menit
        if (elapsedNetMinutes >= 120) {
          const excessMinutes = elapsedNetMinutes - 120;
          const currentInterval = Math.floor(excessMinutes / 10);
          const lastInterval = session.last_overtime_interval || 0;
          if (currentInterval > lastInterval) {
            const nowSec = Math.floor(Date.now() / 1000);
            const lockKeyKey = `${session.session_id}-overtime-interval-${currentInterval}`;
            if (!clientPushedFlagsRef.current[lockKeyKey]) {
              clientPushedFlagsRef.current[lockKeyKey] = true;
              const msg = `⚠️ *Peringatan Overtime Berkala! Durasi Melebihi Target (+${currentInterval * 10} Menit)*\n\nBongkaran ${trainNoStr} telah melebihi target waktu standar.\nDurasi murni saat ini: *${elapsedNetMinutes} Menit* murni.\nStatus Kontainer: *${session.unloaded_containers}/122* Terbongkar.\nChecker: *${session.checker_name}*\nGroup Leader: *${session.groupleader_name}*`;
              
              (async () => {
                try {
                  await updateDoc(docRef, {
                    "last_overtime_interval": currentInterval,
                    "last_overtime_notif": nowSec
                  });
                  await sendFonnteMessageClient(msg);
                } catch (err) {
                  console.error("[Client Overtime] Gagal kirim:", err);
                  clientPushedFlagsRef.current[lockKeyKey] = false;
                }
              })();
            }
          }
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session]);

  // Pemicu periodik tick/ping ke backend untuk menjaga container tetap hangat
  // serta mengevaluasi status notifikasi standar di sisi server secara akurat
  useEffect(() => {
    if (!sessionId || !session || (session.status !== "RUNNING" && session.status !== "PAUSED")) return;

    const runBackendTick = () => {
      fetch(`/api/sessions/${sessionId}/tick`, {
        method: "POST"
      }).catch((err) => console.error("Gagal mengirim tick ke backend:", err));
    };

    // Trigger pertama saat inisialisasi / perubahan status
    runBackendTick();

    // Jalankan setiap 12 detik untuk keandalan maksimal tanpa spamming berlebih
    const tickInterval = setInterval(runBackendTick, 12000);

    return () => clearInterval(tickInterval);
  }, [sessionId, session?.status]);

  // Tambah jumlah kontainer (+)
  const incrementContainers = useCallback(async (amount: number = 1) => {
    if (!session || !sessionId) return;
    const currentUnloaded = session.unloaded_containers;
    if (currentUnloaded >= session.total_containers) return;

    const nextValue = Math.min(currentUnloaded + amount, session.total_containers);
    const isNowCompleted = nextValue === session.total_containers;

    const docRef = doc(db, "sessions", sessionId);
    
    // Update data di Firestore secara atomic
    const updatePayload: Partial<UnloadingSession> = {
      unloaded_containers: nextValue,
    };

    // Jika mencapai target 122kontainer secara otomatis ganti status ke COMPLETED
    if (isNowCompleted) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      // Hitung final durations
      const elapsedGross = nowSeconds - session.start_timestamp;
      let totalPausedDuration = 0;
      session.logs.forEach((l) => {
        if (l.type === "RESUME" && l.duration_seconds) {
          totalPausedDuration += l.duration_seconds;
        }
      });
      if (session.status === "PAUSED" && session.last_paused_timestamp) {
        totalPausedDuration += (nowSeconds - session.last_paused_timestamp);
      }
      const elapsedNet = elapsedGross - totalPausedDuration;

      updatePayload.status = "COMPLETED";
      updatePayload.net_duration_seconds = elapsedNet;
      updatePayload.gross_duration_seconds = elapsedGross;
    }

    await updateDoc(docRef, updatePayload);

    // Jika mencapai target, beralih langsung dan kirim notifikasi selesai
    if (isNowCompleted) {
      const payload = {
        net_duration_seconds: updatePayload.net_duration_seconds,
        gross_duration_seconds: updatePayload.gross_duration_seconds,
        unloaded_containers: nextValue,
        checker_name: session.checker_name,
        groupleader_name: session.groupleader_name,
        train_number: session.train_number,
        logs: session.logs
      };

      fetch(`/api/sessions/${sessionId}/complete-notif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
      })
      .catch(async (err) => {
        console.warn("Gagal mengirim notif autoselesai via API, mencoba client-side fallback:", err);
        const compiledSession = {
          ...session,
          net_duration_seconds: updatePayload.net_duration_seconds,
          gross_duration_seconds: updatePayload.gross_duration_seconds,
          unloaded_containers: nextValue
        };
        await triggerCompleteNotificationClient(compiledSession);
      });
    }
  }, [session, sessionId]);

  // Kurang jumlah kontainer (-)
  const decrementContainers = useCallback(async (amount: number = 1) => {
    if (!session || !sessionId) return;
    const currentUnloaded = session.unloaded_containers;
    if (currentUnloaded <= 0) return;

    const nextValue = Math.max(currentUnloaded - amount, 0);

    const docRef = doc(db, "sessions", sessionId);
    await updateDoc(docRef, {
      unloaded_containers: nextValue,
    });
  }, [session, sessionId]);

  // Pause Sesi (Pencatatan Hambatan)
  const pauseSession = useCallback(async (reason: string) => {
    if (!session || !sessionId || session.status !== "RUNNING") return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const docRef = doc(db, "sessions", sessionId);

    // Buat log baru untuk pause
    const newLog: DelayLog = {
      timestamp: nowSeconds,
      type: "PAUSE",
      reason: reason,
    };

    const updatedLogs = [...session.logs, newLog];

    await updateDoc(docRef, {
      status: "PAUSED",
      last_paused_timestamp: nowSeconds,
      logs: updatedLogs,
    });

    // Pemicu notifikasi WA untuk mulai delay
    fetch(`/api/sessions/${sessionId}/pause-notif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API returned ${res.status}`);
    })
    .catch(async (err) => {
      console.warn("Gagal mengirim pause notif via API, mencoba client-side fallback:", err);
      await triggerPauseNotificationClient(session, reason);
    });
  }, [session, sessionId]);

  // Resume Sesi setelah Pause
  const resumeSession = useCallback(async () => {
    if (!session || !sessionId || session.status !== "PAUSED" || !session.last_paused_timestamp) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const delayDuration = nowSeconds - session.last_paused_timestamp;
    const docRef = doc(db, "sessions", sessionId);

    // Buat log baru untuk resume, mencatat durasi delay yang baru selesai
    const newLog: DelayLog = {
      timestamp: nowSeconds,
      type: "RESUME",
      duration_seconds: delayDuration,
    };

    const updatedLogs = [...session.logs, newLog];

    await updateDoc(docRef, {
      status: "RUNNING",
      last_paused_timestamp: null,
      logs: updatedLogs,
    });

    // Cari reason delay terakhir yang baru saja selesai
    const lastPauseLog = [...session.logs].reverse().find(l => l.type === "PAUSE");
    const reason = lastPauseLog ? lastPauseLog.reason : "Delay selesai";

    // Pemicu notifikasi WA untuk selesainya delay
    fetch(`/api/sessions/${sessionId}/resume-notif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_seconds: delayDuration, reason })
    })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API returned ${res.status}`);
    })
    .catch(async (err) => {
      console.warn("Gagal mengirim resume notif via API, mencoba client-side fallback:", err);
      await triggerResumeNotificationClient(session, reason, delayDuration);
    });
  }, [session, sessionId]);

  // Selesaikan Sesi secara manual (Finish)
  const finishSession = useCallback(async () => {
    if (!session || !sessionId || session.status === "COMPLETED") return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const docRef = doc(db, "sessions", sessionId);

    // Hitung final durations
    const elapsedGross = nowSeconds - session.start_timestamp;
    let totalPausedDuration = 0;
    session.logs.forEach((l) => {
      if (l.type === "RESUME" && l.duration_seconds) {
        totalPausedDuration += l.duration_seconds;
      }
    });
    if (session.status === "PAUSED" && session.last_paused_timestamp) {
      totalPausedDuration += (nowSeconds - session.last_paused_timestamp);
    }
    const elapsedNet = elapsedGross - totalPausedDuration;

    await updateDoc(docRef, {
      status: "COMPLETED",
      net_duration_seconds: elapsedNet > 0 ? elapsedNet : 0,
      gross_duration_seconds: elapsedGross > 0 ? elapsedGross : 0,
      last_paused_timestamp: null,
    });
  }, [session, sessionId]);

  // Revisi Waktu Mulai (Start Time)
  const reviseStartTime = useCallback(async (newStartTimestamp: number, reason: string) => {
    if (!session || !sessionId) return;
    
    const docRef = doc(db, "sessions", sessionId);
    const oldStartTimestamp = session.start_timestamp;

    const elapsedGross = Math.floor(Date.now() / 1000) - newStartTimestamp;
    let totalPausedDuration = 0;
    session.logs.forEach((l) => {
      if (l.type === "RESUME" && l.duration_seconds) {
        totalPausedDuration += l.duration_seconds;
      }
    });
    if (session.status === "PAUSED" && session.last_paused_timestamp) {
      totalPausedDuration += (Math.floor(Date.now() / 1000) - session.last_paused_timestamp);
    }
    const elapsedNetMinutes = Math.floor((elapsedGross - totalPausedDuration) / 60);

    const updatedFlags = { ...(session.flags || {}) };
    if (elapsedNetMinutes < 60) updatedFlags.notif_60m = false;
    if (elapsedNetMinutes < 100) updatedFlags.notif_100m = false;
    if (elapsedNetMinutes < 110) updatedFlags.notif_110m = false;
    if (elapsedNetMinutes < 120) {
      updatedFlags.notif_120m = false;
    }
    if (elapsedNetMinutes < 180) updatedFlags.notif_180m = false;

    const excessMinutes = Math.max(0, elapsedNetMinutes - 120);
    const currentInterval = Math.floor(excessMinutes / 10);

    await updateDoc(docRef, {
      start_timestamp: newStartTimestamp,
      flags: updatedFlags,
      last_overtime_interval: currentInterval,
    });

    try {
      await triggerRevisionNotificationClient(session, oldStartTimestamp, newStartTimestamp, reason);
    } catch (err) {
      console.error("Gagal mengirim notif revisi WA:", err);
    }
  }, [session, sessionId]);

  // Inisialisasi Sesi Baru (Start Timer)
  const startSession = useCallback(async (
    customSessionId: string,
    trainNumber: string,
    checkerName: string,
    groupleaderName: string
  ): Promise<boolean> => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const newSessionDoc: UnloadingSession = {
      session_id: customSessionId,
      train_number: trainNumber,
      checker_name: checkerName,
      groupleader_name: groupleaderName,
      status: "RUNNING",
      total_containers: 122,
      unloaded_containers: 0,
      start_timestamp: nowSeconds,
      last_paused_timestamp: null,
      net_duration_seconds: 0,
      gross_duration_seconds: 0,
      flags: {
        notif_start: false, // akan dipicu pertama kali oleh backend/frontend
        notif_60m: false,
        notif_100m: false,
        notif_110m: false,
        notif_120m: false,
        notif_180m: false,
      },
      last_overtime_notif: null,
      last_overtime_interval: 0,
      logs: [],
      created_at: nowSeconds,
    };

    try {
      const docRef = doc(db, "sessions", customSessionId);
      await setDoc(docRef, newSessionDoc);
      return true;
    } catch (e) {
      console.error("Gagal membuat sesi baru: ", e);
      return false;
    }
  }, []);

  return {
    session,
    loading,
    error,
    liveNetSeconds,
    liveGrossSeconds,
    incrementContainers,
    decrementContainers,
    pauseSession,
    resumeSession,
    finishSession,
    startSession,
    reviseStartTime,
  };
}
