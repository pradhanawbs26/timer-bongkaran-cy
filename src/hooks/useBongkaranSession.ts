import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { db } from "../firebaseClient";
import { UnloadingSession, SessionStatus, DelayLog } from "../types";

export function useBongkaranSession(sessionId: string | null) {
  const [session, setSession] = useState<UnloadingSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
      fetch(`/api/sessions/${sessionId}/complete-notif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          net_duration_seconds: updatePayload.net_duration_seconds,
          gross_duration_seconds: updatePayload.gross_duration_seconds,
          unloaded_containers: nextValue,
          checker_name: session.checker_name,
          groupleader_name: session.groupleader_name,
          train_number: session.train_number,
          logs: session.logs
        })
      }).catch((err) => console.error("Gagal mengirim notif autoselesai:", err));
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
    }).catch(err => console.error("Gagal kirim pause notif:", err));
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
    }).catch(err => console.error("Gagal kirim resume notif:", err));
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
        notif_120m: false,
        notif_180m: false,
      },
      last_overtime_notif: null,
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
  };
}
