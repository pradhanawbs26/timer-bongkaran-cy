import { useState, useEffect, useCallback, useRef } from "react";
import { doc, onSnapshot, updateDoc, setDoc, getDoc, collection, query, where, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebaseClient";
import { UnloadingSession, SessionStatus, DelayLog } from "../types";
import {
  formatTrainNumber
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

  // Client-Side Active Milestone Trigger
  // Ketika browser dalam kondisi aktif menampilkan timer berjalan, ia akan memantau waktu murni (net) secara real-time.
  // Jika mendeteksi transisi milestone (60m, 100m, 110m, 120m, 180m, atau kelipatan overtime), browser langsung
  // menembak backend untuk mentransmisikan notifikasi WhatsApp Fonnte secara instan dan akurat.
  // Penggunaan write/lock transaksi terdistribusi di sisi server menjamin 100% bebas dari segala bentuk duplikasi pesan.
  useEffect(() => {
    if (!sessionId || !session || session.status !== "RUNNING" || liveNetSeconds <= 0) return;

    const netMinutes = Math.floor(liveNetSeconds / 60);
    const flags = session.flags || {};
    
    let milestoneToTrigger: string | null = null;
    let otInterval = 0;

    if (netMinutes >= 180 && !flags.notif_180m) {
      milestoneToTrigger = "180m";
    } else if (netMinutes >= 120 && !flags.notif_120m) {
      milestoneToTrigger = "120m";
    } else if (netMinutes >= 110 && !flags.notif_110m) {
      milestoneToTrigger = "110m";
    } else if (netMinutes >= 100 && !flags.notif_100m) {
      milestoneToTrigger = "100m";
    } else if (netMinutes >= 60 && !flags.notif_60m) {
      milestoneToTrigger = "60m";
    } else if (netMinutes >= 120) {
      // Hitung kelipatan interval overtime 10 menit bersih melampaui sisa target 120m
      const excessMinutes = netMinutes - 120;
      const currentInterval = Math.floor(excessMinutes / 10);
      const lastOvertimeInterval = session.last_overtime_interval !== undefined && session.last_overtime_interval !== null
        ? session.last_overtime_interval
        : 0;

      if (currentInterval > lastOvertimeInterval) {
        milestoneToTrigger = "overtime";
        otInterval = currentInterval;
      }
    }

    if (milestoneToTrigger) {
      const lockKey = milestoneToTrigger === "overtime" ? `overtime_${otInterval}` : milestoneToTrigger;
      
      // Cegah request ganda berturut-turut dari siklus render internal milik instance browser yang sama
      if (clientPushedFlagsRef.current[lockKey]) {
        return;
      }
      clientPushedFlagsRef.current[lockKey] = true;

      console.log(`[Client Trigger] Mendeteksi milestone ${lockKey} tercapai (${netMinutes} mnt murni), memicu API...`);
      fetch(`/api/sessions/${sessionId}/trigger-milestone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestone: milestoneToTrigger,
          currentInterval: milestoneToTrigger === "overtime" ? otInterval : undefined
        })
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API returned status ${res.status}`);
        const data = await res.json();
        console.log(`[Client Trigger] Hasil pemicuan milestone ${lockKey}:`, data);
      })
      .catch(async (err) => {
        console.warn(`[Client Trigger] Gagal pemicuan milestone ${lockKey} via API, menjalankan fallback client-side aman:`, err);
        try {
          const { 
            attemptSendNotificationWithLockClient, 
            attemptSendOvertimeIntervalNotificationWithLockClient 
          } = await import("../utils/whatsappNotification");

          if (milestoneToTrigger === "overtime") {
            const success = await attemptSendOvertimeIntervalNotificationWithLockClient(sessionId, otInterval);
            console.log(`[Client Fallback] Overtime milestone ${otInterval} success:`, success);
          } else if (milestoneToTrigger) {
            const flagKey = `notif_${milestoneToTrigger}`;
            const success = await attemptSendNotificationWithLockClient(sessionId, flagKey, milestoneToTrigger, netMinutes);
            console.log(`[Client Fallback] Milestone ${milestoneToTrigger} success:`, success);
          }
        } catch (fallbackErr) {
          console.error("[Client Fallback] Gagal memproses fallback milestone:", fallbackErr);
          // Lepas lock lokal agar dapat dicoba lagi di tick berikutnya jika gagal di sisi client juga
          clientPushedFlagsRef.current[lockKey] = false;
        }
      });
    }
  }, [sessionId, session, liveNetSeconds]);

  // Tambah jumlah kontainer (+)
  const incrementContainers = useCallback(async (amount: number = 1) => {
    if (!session || !sessionId) return;
    const currentUnloaded = session.unloaded_containers;
    if (currentUnloaded >= session.total_containers) return;

    const nextValue = Math.min(currentUnloaded + amount, session.total_containers);
    const docRef = doc(db, "sessions", sessionId);
    
    // Update data di Firestore secara atomic
    await updateDoc(docRef, {
      unloaded_containers: nextValue
    });
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
      body: JSON.stringify({ reason, timestamp: nowSeconds })
    })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API returned ${res.status}`);
    })
    .catch((err) => {
      console.warn("Gagal mengirim pause notif via API, mencoba fallback client-side:", err);
      import("../utils/whatsappNotification").then(({ triggerPauseNotificationClient }) => {
        triggerPauseNotificationClient(session, reason, nowSeconds);
      });
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
      body: JSON.stringify({ duration_seconds: delayDuration, reason, timestamp: nowSeconds })
    })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API returned ${res.status}`);
    })
    .catch((err) => {
      console.warn("Gagal mengirim resume notif via API, mencoba fallback client-side:", err);
      import("../utils/whatsappNotification").then(({ triggerResumeNotificationClient }) => {
        triggerResumeNotificationClient(session, reason, delayDuration, nowSeconds);
      });
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
      "flags.notif_completed": false,
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

    // Pemicu notifikasi WA untuk revisi waktu mulai melalui server backend
    fetch(`/api/sessions/${sessionId}/revise-notif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldStartTimestamp, newStartTimestamp, reason })
    })
    .then(async (res) => {
      if (!res.ok) throw new Error(`API returned ${res.status}`);
    })
    .catch((err) => {
      console.error("Gagal mengirim notif revisi WA via API, mencoba fallback client-side:", err);
      import("../utils/whatsappNotification").then(({ triggerRevisionNotificationClient }) => {
        triggerRevisionNotificationClient(session, oldStartTimestamp, newStartTimestamp, reason);
      });
    });
  }, [session, sessionId]);

  // Inisialisasi Sesi Baru (Start Timer)
  const startSession = useCallback(async (
    customSessionId: string,
    trainNumber: string,
    checkerName: string,
    groupleaderName: string
  ): Promise<boolean> => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Auto-complete sesi aktif sebelumnya agar tidak menimbulkan notifikasi double atau bertumpuk-tumpuk
    try {
      const activeQuery = query(
        collection(db, "sessions"),
        where("status", "in", ["RUNNING", "PAUSED"])
      );
      const activeSnapshot = await getDocs(activeQuery);
      if (!activeSnapshot.empty) {
        const batch = writeBatch(db);
        activeSnapshot.forEach((docSnap) => {
          // Jangan bersihkan dirinya sendiri jika ID kebetulan sama
          if (docSnap.id === customSessionId) return;

          const data = docSnap.data();
          const oldStart = data.start_timestamp || nowSeconds;
          const oldElapsedGross = nowSeconds - oldStart;
          
          batch.update(docSnap.ref, {
            status: "COMPLETED",
            "flags.notif_completed": true, // bypass notifikasi selesai agar tidak spamming
            gross_duration_seconds: oldElapsedGross,
            net_duration_seconds: data.net_duration_seconds || oldElapsedGross
          });
        });
        await batch.commit();
        console.log(`[startSession] Berhasil menghentikan secara bersih ${activeSnapshot.size} sesi aktif sebelumnya.`);
      }
    } catch (clearErr) {
      console.warn("Gagal membersihkan sesi aktif sebelumnya secara otomatis:", clearErr);
    }

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
        notif_completed: false,
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
