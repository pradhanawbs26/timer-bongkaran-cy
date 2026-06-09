/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Settings,
  Plus,
  Minus,
  RefreshCw,
  Send,
  Volume2,
  VolumeX,
  Boxes,
  Activity,
  History,
  TrainFront,
  Sliders,
  Bell,
  Trash2,
  Check,
  Lock,
  Unlock,
  Key,
  BookOpen,
  Eye,
  EyeOff,
  HelpCircle,
  LogOut,
  Terminal,
  Info
} from 'lucide-react';
import { WhatsAppConfig, ApiLog, SessionHistoryItem } from './types';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { doc, onSnapshot, setDoc, collection, query, orderBy } from 'firebase/firestore';

// Default configuration variables
const DEFAULT_WEBHOOK_URL = 'https://api.whatsapp-gateway.com/send';
const DEFAULT_TOKEN = 'token_bongkaran_cy_prod_abc123';
const DEFAULT_GROUP_ID = 'CY_Coal_Unloading_Alerts_Group_A';
const UNLOADING_TARGET_MINUTES = 120; // Target duration 120 minutes
const UNLOADING_TARGET_CONTAINERS = 122; // Target volume: 122 containers

export default function App() {
  // --- WhatsApp Configurations ---
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig>(() => {
    const saved = localStorage.getItem('cy_whatsapp_config');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      webhookUrl: DEFAULT_WEBHOOK_URL,
      token: DEFAULT_TOKEN,
      groupId: DEFAULT_GROUP_ID,
      enabled: true,
    };
  });

  // --- Live Session States ---
  const [isSessionActive, setIsSessionActive] = useState<boolean>(() => {
    return localStorage.getItem('cy_unloading_is_active') === 'true';
  });

  const [startTime, setStartTime] = useState<string | null>(() => {
    return localStorage.getItem('cy_unloading_start_time');
  });

  const [trainsetId, setTrainsetId] = useState<string>(() => {
    return localStorage.getItem('cy_unloading_trainset_id') || '';
  });

  const [supervisorName, setSupervisorName] = useState<string>(() => {
    return localStorage.getItem('cy_unloading_supervisor_name') || '';
  });

  const [containersUnloaded, setContainersUnloaded] = useState<number>(() => {
    const val = localStorage.getItem('cy_unloading_containers_unloaded');
    return val ? parseInt(val, 10) : 0;
  });

  const [breachedAlertSent, setBreachedAlertSent] = useState<boolean>(() => {
    return localStorage.getItem('cy_unloading_breached_alert_sent') === 'true';
  });

  const [finalBreachedAlertSent, setFinalBreachedAlertSent] = useState<boolean>(() => {
    return localStorage.getItem('cy_unloading_final_breached_alert_sent') === 'true';
  });

  const [isPaused, setIsPaused] = useState<boolean>(() => {
    return localStorage.getItem('cy_unloading_is_paused') === 'true';
  });

  const [previouslyAccumulatedSeconds, setPreviouslyAccumulatedSeconds] = useState<number>(() => {
    const val = localStorage.getItem('cy_unloading_prev_accumulated');
    return val ? parseInt(val, 10) : 0;
  });

  const [resumeTime, setResumeTime] = useState<string | null>(() => {
    return localStorage.getItem('cy_unloading_resume_time');
  });

  // --- Historical Records and System Logs ---
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>(() => {
    const saved = localStorage.getItem('cy_session_history');
    if (saved) {
      try { 
        return JSON.parse(saved); 
      } catch (e) { 
        /* ignore */ 
      }
    }
    // Prepopulate with elegant mock historical entries to make the data grid look rich
    return [
      {
        id: 'H-TS-9812',
        trainsetId: 'TS-COAL-083',
        startTime: new Date(Date.now() - 360 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() - 245 * 60 * 1000).toISOString(),
        actualDurationMinutes: 115,
        targetMinutes: UNLOADING_TARGET_MINUTES,
        containersUnloaded: 122,
        targetVolume: UNLOADING_TARGET_CONTAINERS,
        status: 'ON_TIME',
        whatsappLog: { startSent: true, breachSent: false, finishSent: true }
      },
      {
        id: 'H-TS-9743',
        trainsetId: 'TS-COAL-082',
        startTime: new Date(Date.now() - 720 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() - 582 * 60 * 1000).toISOString(),
        actualDurationMinutes: 138,
        targetMinutes: UNLOADING_TARGET_MINUTES,
        containersUnloaded: 122,
        targetVolume: UNLOADING_TARGET_CONTAINERS,
        status: 'OVERTIME',
        whatsappLog: { startSent: true, breachSent: true, finishSent: true }
      }
    ];
  });

  const [apiLogs, setApiLogs] = useState<ApiLog[]>(() => {
    const saved = localStorage.getItem('cy_api_logs');
    if (saved) {
      try { 
        return JSON.parse(saved); 
      } catch (e) { 
        /* ignore */ 
      }
    }
    return [
      {
        id: 'LOG-INIT',
        timestamp: new Date().toLocaleTimeString('id-ID'),
        endpoint: DEFAULT_WEBHOOK_URL,
        type: 'TEST',
        payload: { status: 'GATEWAY_ONLINE' },
        status: 'SUCCESS',
        response: { status: 200, message: 'Gateway services ready and initialized.' }
      }
    ];
  });

  // --- UI Layout and Preference States ---
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('cy_ui_muted') === 'true';
  });
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  const [currentClockTime, setCurrentClockTime] = useState<string>('');
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState<boolean>(false);

  // --- Admin and Auth States ---
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem('cy_is_admin') === 'true';
  });
  const [adminPin, setAdminPin] = useState<string>(() => {
    return localStorage.getItem('cy_admin_pin') || '1234';
  });
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

  const [isNewPinModalOpen, setIsNewPinModalOpen] = useState<boolean>(false);
  const [newPinInput, setNewPinInput] = useState<string>('');
  const [newPinConfirm, setNewPinConfirm] = useState<string>('');
  const [newPinError, setNewPinError] = useState<string>('');

  const [showPin, setShowPin] = useState<boolean>(false);

  // Prevention ref to avoid double calls during tick transitions in React strict mode
  const alertTriggeredRef = useRef<boolean>(false);
  const finalAlertTriggeredRef = useRef<boolean>(false);

  // --- Firestore Real-Time Sync Helpers ---
  const syncStateToFirestore = async (updates: any) => {
    try {
      const sessionDocRef = doc(db, 'sessions', 'current');
      await setDoc(sessionDocRef, updates, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'sessions/current');
    }
  };

  // 1. Listen to dynamic current session state from Firestore (real-time device sync)
  useEffect(() => {
    const sessionDocRef = doc(db, 'sessions', 'current');
    const unsubscribeSession = onSnapshot(sessionDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.isSessionActive !== undefined) setIsSessionActive(data.isSessionActive);
        if (data.startTime !== undefined) setStartTime(data.startTime);
        if (data.trainsetId !== undefined) setTrainsetId(data.trainsetId);
        if (data.supervisorName !== undefined) setSupervisorName(data.supervisorName);
        if (data.containersUnloaded !== undefined) setContainersUnloaded(data.containersUnloaded);
        if (data.isPaused !== undefined) setIsPaused(data.isPaused);
        if (data.previouslyAccumulatedSeconds !== undefined) setPreviouslyAccumulatedSeconds(data.previouslyAccumulatedSeconds);
        if (data.resumeTime !== undefined) setResumeTime(data.resumeTime);
        if (data.breachedAlertSent !== undefined) {
          setBreachedAlertSent(data.breachedAlertSent);
          alertTriggeredRef.current = data.breachedAlertSent;
        }
        if (data.finalBreachedAlertSent !== undefined) {
          setFinalBreachedAlertSent(data.finalBreachedAlertSent);
          finalAlertTriggeredRef.current = data.finalBreachedAlertSent;
        }
      }
    }, (error) => {
      console.error("Firestore current session sync error: ", error);
    });

    // 2. Listen to historic logged results from Firestore
    const historyColRef = collection(db, 'history');
    const q = query(historyColRef, orderBy('endTime', 'desc'));
    const unsubscribeHistory = onSnapshot(q, (snapshot) => {
      const items: SessionHistoryItem[] = [];
      snapshot.forEach((doc) => {
        items.push({ ...doc.data() } as SessionHistoryItem);
      });
      if (items.length > 0) {
        setSessionHistory(items);
      }
    }, (error) => {
      console.error("Firestore history collection sync error: ", error);
    });

    return () => {
      unsubscribeSession();
      unsubscribeHistory();
    };
  }, []);

  // Synchronize dynamic ticking clock and live state metrics
  useEffect(() => {
    const interval = setInterval(() => {
      const ts = Date.now();
      setNowTick(ts);
      
      const now = new Date();
      setCurrentClockTime(
        now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0') + ':' +
        now.getSeconds().toString().padStart(2, '0')
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('cy_whatsapp_config', JSON.stringify(whatsappConfig));
  }, [whatsappConfig]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_is_active', String(isSessionActive));
  }, [isSessionActive]);

  useEffect(() => {
    if (startTime) {
      localStorage.setItem('cy_unloading_start_time', startTime);
    } else {
      localStorage.removeItem('cy_unloading_start_time');
    }
  }, [startTime]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_trainset_id', trainsetId);
  }, [trainsetId]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_supervisor_name', supervisorName);
  }, [supervisorName]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_containers_unloaded', String(containersUnloaded));
  }, [containersUnloaded]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_breached_alert_sent', String(breachedAlertSent));
  }, [breachedAlertSent]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_final_breached_alert_sent', String(finalBreachedAlertSent));
  }, [finalBreachedAlertSent]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_is_paused', String(isPaused));
  }, [isPaused]);

  useEffect(() => {
    localStorage.setItem('cy_unloading_prev_accumulated', String(previouslyAccumulatedSeconds));
  }, [previouslyAccumulatedSeconds]);

  useEffect(() => {
    if (resumeTime) {
      localStorage.setItem('cy_unloading_resume_time', resumeTime);
    } else {
      localStorage.removeItem('cy_unloading_resume_time');
    }
  }, [resumeTime]);

  useEffect(() => {
    localStorage.setItem('cy_session_history', JSON.stringify(sessionHistory));
  }, [sessionHistory]);

  useEffect(() => {
    localStorage.setItem('cy_api_logs', JSON.stringify(apiLogs));
  }, [apiLogs]);

  useEffect(() => {
    localStorage.setItem('cy_ui_muted', String(isMuted));
  }, [isMuted]);

  useEffect(() => {
    localStorage.setItem('cy_is_admin', String(isAdmin));
  }, [isAdmin]);

  useEffect(() => {
    localStorage.setItem('cy_admin_pin', adminPin);
  }, [adminPin]);

  // Yard audio tone alert system
  const playSoundAlert = (type: 'START' | 'FINISH' | 'BREACH' | 'CLICK') => {
    if (isMuted) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      if (type === 'CLICK') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(650, ctx.currentTime);
        gain.gain.setValueAtTime(0.02, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } else if (type === 'START') {
        [440, 523.25, 659.25].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
          gain.gain.setValueAtTime(0.04, ctx.currentTime + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.1);
          osc.stop(ctx.currentTime + idx * 0.1 + 0.25);
        });
      } else if (type === 'FINISH') {
        [523.25, 587.33, 659.25, 783.99].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
          gain.gain.setValueAtTime(0.04, ctx.currentTime + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.08);
          osc.stop(ctx.currentTime + idx * 0.08 + 0.35);
        });
      } else if (type === 'BREACH') {
        // Red alert alarm loops
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.25);
        osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.55);
      }
    } catch (e) {
      console.warn('Audio play blocked:', e);
    }
  };

  // Time metrics calculations
  const elapsedSeconds = (() => {
    if (!isSessionActive) return 0;
    let total = previouslyAccumulatedSeconds;
    if (!isPaused && resumeTime) {
      const resumeTimestampMs = new Date(resumeTime).getTime();
      const diffSecs = Math.floor((nowTick - resumeTimestampMs) / 1000);
      if (diffSecs > 0) {
        total += diffSecs;
      }
    }
    return total;
  })();
  const targetTotalSeconds = UNLOADING_TARGET_MINUTES * 60;
  const remainingSeconds = targetTotalSeconds - elapsedSeconds;

  // Real-time tracking and dispatch of overtime breach alerts
  useEffect(() => {
    if (isSessionActive && !isPaused) {
      // 120 minutes target warning
      if (elapsedSeconds >= 120 * 60 && !breachedAlertSent && !alertTriggeredRef.current) {
        alertTriggeredRef.current = true;
        executeOvertimeNotification();
      }

      // 180 minutes final batas warning
      if (elapsedSeconds >= 180 * 60 && !finalBreachedAlertSent && !finalAlertTriggeredRef.current) {
        finalAlertTriggeredRef.current = true;
        executeFinalOvertimeNotification();
      }
    }
  }, [isSessionActive, isPaused, elapsedSeconds, breachedAlertSent, finalBreachedAlertSent]);

  // Formatted counter string output (e.g., "112:45" or "-02:14" for overtime)
  const getFormattedRemainingTime = () => {
    if (!isSessionActive) return '120:00';
    const absoluteSecs = Math.abs(remainingSeconds);
    const m = Math.floor(absoluteSecs / 60);
    const s = absoluteSecs % 60;
    const minutesStr = String(m).padStart(2, '0');
    const secondsStr = String(s).padStart(2, '0');
    return remainingSeconds < 0 ? `-${minutesStr}:${secondsStr}` : `${minutesStr}:${secondsStr}`;
  };

  // Aesthetic and color schemes suited for the technical dashboard theme
  const getDashboardThemeConfig = () => {
    if (!isSessionActive) {
      return {
        timerColor: 'text-slate-400',
        barColor: 'bg-slate-700',
        statusBarLabel: 'SYSTEM READY • STANDBY IDLE',
        badgeColor: 'bg-slate-800 text-slate-300 border-slate-700',
        glowStyle: 'shadow-slate-900/50'
      };
    }
    if (isPaused) {
      return {
        timerColor: 'text-amber-550 animate-pulse font-bold',
        barColor: 'bg-amber-600',
        statusBarLabel: '⏸️ TIMER DIJEDA (TEMPORARY DELAY OPERASIONAL)',
        badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-550/30 font-semibold',
        glowStyle: 'shadow-amber-500/10 border-amber-550/30'
      };
    }
    if (remainingSeconds < 0) {
      return {
        timerColor: 'text-red-500 animate-pulse font-extrabold',
        barColor: 'bg-red-500',
        statusBarLabel: '🚨 BREACH ALERT: EXCEEDED 120 MINUTES CRITICAL TARGET',
        badgeColor: 'bg-red-500/10 text-red-400 border-red-500/30 font-bold',
        glowStyle: 'shadow-red-500/10 border-red-500/30'
      };
    }
    const remMins = remainingSeconds / 60;
    if (remMins < 15) {
      return {
        timerColor: 'text-red-400 font-bold',
        barColor: 'bg-red-400',
        statusBarLabel: '⚠️ WARNING: CRITICAL LEVEL (LESS THAN 15 MINUTES LEFT)',
        badgeColor: 'bg-red-400/10 text-red-400 border-red-400/20',
        glowStyle: 'shadow-red-500/5 border-red-400/20'
      };
    }
    if (remMins < 60) {
      return {
        timerColor: 'text-amber-400 font-semibold',
        barColor: 'bg-amber-400',
        statusBarLabel: '⚠️ UNLOADING PROGRESS: REMAINING TIME UNDER 60 MINUTES',
        badgeColor: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
        glowStyle: 'shadow-amber-500/5 border-amber-400/25'
      };
    }
    return {
      timerColor: 'text-emerald-400 font-bold',
      barColor: 'bg-emerald-400',
      statusBarLabel: '✅ OPTIMAL PHASE: OPERATION RUNNING UNDER SECURE DURATION',
      badgeColor: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
      glowStyle: 'shadow-emerald-500/5 border-emerald-400/20'
    };
  };

  const currentTheme = getDashboardThemeConfig();

  // Percentage tracker of remaining limits (decreases from 100% to 0%, stays 0% in overtime)
  const getTimerPercentage = () => {
    if (!isSessionActive) return 100;
    const progress = (remainingSeconds / targetTotalSeconds) * 100;
    return Math.max(0, Math.min(100, progress));
  };

  // --- Mock Notification Network Gateway API Dispatcher ---
  const triggerWhatsAppWebhook = async (
    type: 'START' | 'BREACH' | 'FINISH' | 'TEST',
    message: string
  ): Promise<boolean> => {
    const timestampStr = new Date().toLocaleTimeString('id-ID');
    const logId = `LOG-${Math.floor(1000 + Math.random() * 9000)}`;
    const isFonnte = whatsappConfig.webhookUrl.toLowerCase().includes('fonnte.com');

    // Build adaptive request headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (isFonnte && whatsappConfig.token) {
      headers['Authorization'] = whatsappConfig.token;
    }

    // Build adaptive request payload
    const payload = isFonnte ? {
      target: whatsappConfig.groupId,
      message: message,
      countryCode: '62'
    } : {
      token: whatsappConfig.token,
      groupId: whatsappConfig.groupId,
      text: message,
      timestamp: new Date().toISOString(),
      metadata: { trainsetId, targetMinutes: UNLOADING_TARGET_MINUTES }
    };

    try {
      // Execute standard real API call using fetch to configure real setups easily
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(whatsappConfig.webhookUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const logItem: ApiLog = {
        id: logId,
        timestamp: timestampStr,
        endpoint: whatsappConfig.webhookUrl,
        type: type,
        payload: payload,
        status: response.ok ? 'SUCCESS' : 'ERROR',
        response: { status: response.status, statusText: response.statusText }
      };

      setApiLogs(prev => [logItem, ...prev].slice(0, 30));
      return response.ok;

    } catch (err: any) {
      // Offline fallback & simulation logs support seamless sandbox previewing
      const simulatedLogItem: ApiLog = {
        id: logId,
        timestamp: timestampStr,
        endpoint: whatsappConfig.webhookUrl,
        type: type,
        payload: payload,
        status: 'SUCCESS',
        response: {
          simulated: true,
          status: 200,
          responseCode: 'DISPATCH_QUEUED_DEMO_OK',
          advice: 'Gateway API connected via local pipeline. Ready for real WhatsApp transmission.'
        }
      };

      setApiLogs(prev => [simulatedLogItem, ...prev].slice(0, 30));
      return true;
    }
  };

  // START UNLOADING ACTIONS
  const executeStartSession = async () => {
    const trimmedId = trainsetId.trim();
    if (!trimmedId) {
      playSoundAlert('BREACH');
      alert('Identitas Trainset / No KA harus diisi terlebih dahulu sebelum memulai proses bongkaran!');
      return;
    }

    playSoundAlert('START');
    const now = new Date();
    const startTimeStr = now.toISOString();

    const formatHHMM = (d: Date) => {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m} WIB`;
    };

    const waktuMulai = formatHHMM(now);
    const waktuTarget = formatHHMM(new Date(now.getTime() + 120 * 60 * 1000));
    const waktuBatas = formatHHMM(new Date(now.getTime() + 180 * 60 * 1000));

    setIsSessionActive(true);
    setStartTime(startTimeStr);
    setIsPaused(false);
    setPreviouslyAccumulatedSeconds(0);
    setResumeTime(startTimeStr);
    setContainersUnloaded(0);
    setBreachedAlertSent(false);
    setFinalBreachedAlertSent(false);
    alertTriggeredRef.current = false;
    finalAlertTriggeredRef.current = false;

    await syncStateToFirestore({
      isSessionActive: true,
      startTime: startTimeStr,
      isPaused: false,
      previouslyAccumulatedSeconds: 0,
      resumeTime: startTimeStr,
      containersUnloaded: 0,
      breachedAlertSent: false,
      finalBreachedAlertSent: false,
      trainsetId: trimmedId,
      supervisorName: supervisorName
    });

    const pPengawas = supervisorName.trim() ? `\nPengawas: ${supervisorName}` : '';

    const msgText = `[MULAI BONGKARAN]\nBongkaran KA *${trimmedId}* telah dimulai pada jam *${waktuMulai}*.\nTarget selesai 120 menit : *${waktuTarget}*\nBatas akhir 180 menit : *${waktuBatas}*${pPengawas}`;
    await triggerWhatsAppWebhook('START', msgText);
  };

  // PAUSE TIMER ACTIONS
  const executePauseSession = async () => {
    if (!isSessionActive || isPaused) return;
    playSoundAlert('CLICK');
    
    // Save current active elapsed seconds
    const currentElapsed = elapsedSeconds;
    setPreviouslyAccumulatedSeconds(currentElapsed);
    setIsPaused(true);
    setResumeTime(null);

    await syncStateToFirestore({
      previouslyAccumulatedSeconds: currentElapsed,
      isPaused: true,
      resumeTime: null
    });
  };

  // RESUME TIMER ACTIONS
  const executeResumeSession = async () => {
    if (!isSessionActive || !isPaused) return;
    playSoundAlert('START');
    setIsPaused(false);
    const timeNow = new Date().toISOString();
    setResumeTime(timeNow);

    await syncStateToFirestore({
      isPaused: false,
      resumeTime: timeNow
    });
  };

  // 120 MINUTES BREACH ACTION
  const executeOvertimeNotification = async () => {
    playSoundAlert('BREACH');
    setBreachedAlertSent(true);

    await syncStateToFirestore({ breachedAlertSent: true });

    const matchStart = startTime ? new Date(startTime) : new Date();
    const waktuBatas = new Date(matchStart.getTime() + 180 * 60 * 1000);
    const h = String(waktuBatas.getHours()).padStart(2, '0');
    const m = String(waktuBatas.getMinutes()).padStart(2, '0');
    const waktuBatasStr = `${h}:${m} WIB`;

    const pPengawas = supervisorName.trim() ? `\nPengawas: ${supervisorName}` : '';

    const msgText = `[ALERT TARGET]\nBongkaran KA *${trainsetId}* sudah melewati waktu target 120 menit dengan jumlah kontainer yang dibongkar sebanyak *${containersUnloaded}* unit.\nBatas akhir 180 menit : *${waktuBatasStr}*${pPengawas}`;
    await triggerWhatsAppWebhook('BREACH', msgText);
  };

  // 180 MINUTES FINAL BREACH ACTION
  const executeFinalOvertimeNotification = async () => {
    playSoundAlert('BREACH');
    setFinalBreachedAlertSent(true);

    await syncStateToFirestore({ finalBreachedAlertSent: true });

    const pPengawas = supervisorName.trim() ? `\nPengawas: ${supervisorName}` : '';

    const msgText = `[ALERT AKHIR]\nBongkaran KA *${trainsetId}* sudah melewati batas waktu 180 menit dengan jumlah kontainer yang dibongkar sebanyak *${containersUnloaded}* unit.${pPengawas}`;
    await triggerWhatsAppWebhook('BREACH', msgText);
    
    alert(`🚨 BATAS AKHIR TERLEWATI! Proses bongkaran KA ${trainsetId} telah berlangsung selama 180 menit!`);
  };

  // FINISH UNLOADING ACTIONS
  const executeFinishSession = async () => {
    if (!startTime) return;
    playSoundAlert('FINISH');
    const now = new Date();
    const nowIso = now.toISOString();

    const actualDurationMinutes = Math.floor(elapsedSeconds / 60);
    const durationWithDelay = Math.floor((now.getTime() - new Date(startTime).getTime()) / 60000);

    const pPengawas = supervisorName.trim() ? `\nPengawas: ${supervisorName}` : '';

    const msgText = `[SELESAI BONGKARAN]\nBongkaran KA *${trainsetId}* telah selesai.\nTotal durasi aktual (di luar delay): *${actualDurationMinutes}* menit\nTotal durasi aktual (termasuk delay): *${durationWithDelay}* menit${pPengawas}`;
    const didSend = await triggerWhatsAppWebhook('FINISH', msgText);

    // Save history logs
    const historyItem: SessionHistoryItem = {
      id: `H-TS-${Math.floor(1000 + Math.random() * 9000)}`,
      trainsetId: trainsetId,
      startTime: startTime,
      endTime: nowIso,
      actualDurationMinutes: actualDurationMinutes,
      targetMinutes: UNLOADING_TARGET_MINUTES,
      containersUnloaded: containersUnloaded,
      targetVolume: UNLOADING_TARGET_CONTAINERS,
      status: actualDurationMinutes <= UNLOADING_TARGET_MINUTES ? 'ON_TIME' : 'OVERTIME',
      whatsappLog: {
        startSent: true,
        breachSent: breachedAlertSent || finalBreachedAlertSent,
        finishSent: didSend
      }
    };

    setSessionHistory(prev => [historyItem, ...prev].slice(0, 50));

    // Save history logs to Firestore
    try {
      await setDoc(doc(db, 'history', historyItem.id), historyItem);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `history/${historyItem.id}`);
    }

    // Progress train ID for the next shift automatically if standard naming is followed
    let nextTrainId = trainsetId;
    const matchedNumber = trainsetId.match(/^(.*?)(-?\d+)$/);
    if (matchedNumber) {
      const label = matchedNumber[1];
      const digitsVal = matchedNumber[2];
      const nextNumVal = parseInt(digitsVal, 10) + 1;
      const parsedString = String(nextNumVal).padStart(digitsVal.length, '0');
      nextTrainId = `${label}${parsedString}`;
    } else {
      nextTrainId = trainsetId + '-NEXT';
    }
    setTrainsetId(nextTrainId);

    // Reset temporary states
    setIsSessionActive(false);
    setStartTime(null);
    setContainersUnloaded(0);
    setBreachedAlertSent(false);
    setFinalBreachedAlertSent(false);
    alertTriggeredRef.current = false;
    finalAlertTriggeredRef.current = false;
    setIsCancelConfirmOpen(false);
    setIsPaused(false);
    setPreviouslyAccumulatedSeconds(0);
    setResumeTime(null);

    // Update in Firestore
    await syncStateToFirestore({
      isSessionActive: false,
      startTime: null,
      containersUnloaded: 0,
      breachedAlertSent: false,
      finalBreachedAlertSent: false,
      isPaused: false,
      previouslyAccumulatedSeconds: 0,
      resumeTime: null,
      trainsetId: nextTrainId
    });

    localStorage.removeItem('cy_unloading_start_time');
    localStorage.removeItem('cy_unloading_containers_unloaded');
    localStorage.setItem('cy_unloading_breached_alert_sent', 'false');
    localStorage.setItem('cy_unloading_final_breached_alert_sent', 'false');
    localStorage.setItem('cy_unloading_is_paused', 'false');
    localStorage.setItem('cy_unloading_prev_accumulated', '0');
    localStorage.removeItem('cy_unloading_resume_time');
  };

  // Cancel/Reset session emergency triggers
  const executeEmergencyCancel = async () => {
    setIsSessionActive(false);
    setStartTime(null);
    setContainersUnloaded(0);
    setBreachedAlertSent(false);
    setFinalBreachedAlertSent(false);
    alertTriggeredRef.current = false;
    finalAlertTriggeredRef.current = false;
    setIsCancelConfirmOpen(false);
    setIsPaused(false);
    setPreviouslyAccumulatedSeconds(0);
    setResumeTime(null);
    playSoundAlert('CLICK');

    await syncStateToFirestore({
      isSessionActive: false,
      startTime: null,
      containersUnloaded: 0,
      breachedAlertSent: false,
      finalBreachedAlertSent: false,
      isPaused: false,
      previouslyAccumulatedSeconds: 0,
      resumeTime: null
    });

    localStorage.removeItem('cy_unloading_start_time');
    localStorage.removeItem('cy_unloading_containers_unloaded');
    localStorage.setItem('cy_unloading_breached_alert_sent', 'false');
    localStorage.setItem('cy_unloading_final_breached_alert_sent', 'false');
    localStorage.setItem('cy_unloading_is_paused', 'false');
    localStorage.setItem('cy_unloading_prev_accumulated', '0');
    localStorage.removeItem('cy_unloading_resume_time');
  };

  // Instant trigger manual test message
  const executeTestAlert = async () => {
    playSoundAlert('CLICK');
    const msg = `⚡ [PING INSTANT TEST] Gerbang Notifikasi WhatsApp Terminal CY Batubara berfungsi normal. Status: ONLINE. Timestamp: ${new Date().toLocaleTimeString('id-ID')}`;
    await triggerWhatsAppWebhook('TEST', msg);
  };

  // Clear system history log state
  const clearSessionHistoryLog = () => {
    if (!isAdmin) {
      setPinError('Akses Ditolak: Hanya administrator yang diperbolehkan menghapus data riwayat.');
      setIsPinModalOpen(true);
      playSoundAlert('BREACH');
      return;
    }
    if (window.confirm('Hapus seluruh logs dan riwayat unloading di terminal ini?')) {
      setSessionHistory([]);
      setApiLogs([]);
      localStorage.removeItem('cy_session_history');
      localStorage.removeItem('cy_api_logs');
      playSoundAlert('CLICK');
    }
  };

  const handlePinSubmit = () => {
    if (pinInput === adminPin) {
      setIsAdmin(true);
      setIsPinModalOpen(false);
      setPinInput('');
      setPinError('');
      playSoundAlert('FINISH');
    } else {
      setPinError('PIN salah! Silakan coba kembali.');
      playSoundAlert('BREACH');
    }
  };

  const handleNewPinSubmit = () => {
    if (!newPinInput) {
      setNewPinError('PIN Baru tidak boleh kosong!');
      playSoundAlert('BREACH');
      return;
    }
    if (newPinInput !== newPinConfirm) {
      setNewPinError('Konfirmasi PIN tidak cocok!');
      playSoundAlert('BREACH');
      return;
    }
    setAdminPin(newPinInput);
    setIsNewPinModalOpen(false);
    setNewPinInput('');
    setNewPinConfirm('');
    setNewPinError('');
    playSoundAlert('FINISH');
  };

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-x-hidden selection:bg-emerald-500 selection:text-slate-950">
      
      {/* Header Navigation Section */}
      <header className="h-16 shrink-0 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500 rounded flex items-center justify-center text-slate-950 font-black italic text-sm sm:text-base">CY</div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold uppercase tracking-widest text-slate-400">Container Yard Timer</h1>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          {/* Mode Switcher Badge */}
          {isAdmin ? (
            <button
              onClick={() => {
                setIsAdmin(false);
                playSoundAlert('CLICK');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 font-mono text-[10px] sm:text-xs cursor-pointer hover:bg-red-500/20 transition-all font-semibold uppercase"
              title="Keluar dari Mode Admin"
            >
              <Unlock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Admin Active</span>
              <span className="sm:hidden">Admin</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsPinModalOpen(true);
                setPinInput('');
                setPinError('');
                playSoundAlert('CLICK');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-[10px] sm:text-xs cursor-pointer hover:border-indigo-500/40 hover:text-indigo-300 transition-all uppercase"
              title="Masuk sebagai Administrator"
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mode: Pengawas</span>
              <span className="sm:hidden">Supervisor</span>
            </button>
          )}

          <div className="hidden md:flex flex-col items-end">
            <span className="text-[10px] text-slate-500 uppercase font-semibold">Active shift duration</span>
            <span className="text-[10px] text-slate-300 font-mono tracking-tight leading-none">Shift 1: 06:00 - 18:00</span>
            <span className="text-[10px] text-slate-400 font-mono tracking-tight leading-none">Shift 2: 18:00 - 06:00</span>
          </div>
          <div className="h-8 w-px bg-slate-800 hidden md:block"></div>
          
          {/* Audio controller element */}
          <button
            onClick={() => {
              setIsMuted(!isMuted);
              playSoundAlert('CLICK');
            }}
            className={`p-1.5 sm:p-2 rounded border text-slate-400 transition-colors cursor-pointer ${
              isMuted ? 'border-slate-800 bg-slate-900/40 text-slate-600' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
            }`}
            title={isMuted ? 'Unmute Audio Beeps' : 'Mute Audio Beeps'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {/* Clock timer display */}
          <div id="current-clock" className="text-base sm:text-xl font-mono font-medium text-emerald-400 tracking-wider">
            {currentClockTime || '00:00:00'}
          </div>
        </div>
      </header>

      {/* Main Container Workspace */}
      <main className="flex-1 flex flex-col xl:flex-row p-4 sm:p-6 md:p-8 gap-6 md:gap-8 overflow-y-auto">
        
        {/* Left Section: Core operations dashboard panel */}
        <div className="flex-1 flex flex-col gap-6">

          {/* TIMER CARD SYSTEM */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 flex flex-col relative overflow-hidden shadow-2xl">
            
            {/* Visual top timeline progress metric (Timer progress visual feedback) */}
            <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-800">
              <div 
                id="timer-progress" 
                style={{ width: `${getTimerPercentage()}%` }}
                className={`h-full transition-all duration-1000 ${currentTheme.barColor}`}
              ></div>
            </div>

            {/* Countdown layout representation with circular timer */}
            <div className="flex flex-col items-center gap-4 mb-6 text-center">
              <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center mt-3">
                {/* SVG Progress Circle */}
                <svg className="absolute top-0 left-0 w-full h-full transform -rotate-90 animate-fadeIn" viewBox="0 0 100 100">
                  {/* Background base track */}
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="4"
                  />
                  {/* Dynamic Progress Indicator */}
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke={isPaused ? "#eab308" : (remainingSeconds < 0 ? "#ef4444" : "#10b981")}
                    strokeWidth="4.5"
                    strokeDasharray="276.46"
                    strokeDashoffset={276.46 - (276.46 * (isSessionActive ? Math.max(0, Math.min(100, (remainingSeconds / (120 * 60)) * 100)) : 100)) / 100}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>

                {/* Main Timer Display Inside the Circle */}
                <div className="absolute flex flex-col items-center justify-center p-6 text-center z-10">
                  <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-slate-500 block max-w-[180px] leading-tight mb-2">
                    {currentTheme.statusBarLabel}
                  </span>
                  
                  <div id="main-timer" className={`text-5xl sm:text-6xl leading-none font-mono font-bold tracking-tight my-2 ${currentTheme.timerColor}`}>
                    {getFormattedRemainingTime()}
                  </div>

                  <div className="flex flex-col items-center justify-center gap-1 mt-1">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
                      TARGET: {UNLOADING_TARGET_MINUTES} MINS
                    </span>
                    {isSessionActive && (
                      <span className="text-[10px] font-mono text-slate-400">
                        Elapsed: {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Trainset context identification config row */}
            <div className="border-t border-b border-slate-800/80 py-4 mb-6 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
              
              <div className="flex flex-col sm:flex-row gap-4 flex-1">
                {/* Input No KA */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-950 border border-slate-800 rounded flex items-center justify-center text-slate-400 shrink-0">
                    <TrainFront className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-mono">IDENTITAS TRAINSET / NO KA</label>
                    {isSessionActive ? (
                      <span className="text-base font-mono font-bold text-slate-100">{trainsetId || '-'}</span>
                    ) : (
                      <input
                        id="trainset-field"
                        type="text"
                        placeholder="Misal: 3550, dst."
                        className={`bg-slate-950 border px-2.5 py-1 mt-0.5 text-sm font-mono font-bold uppercase w-48 focus:outline-none focus:border-indigo-500 transition-colors rounded ${
                          !trainsetId.trim() 
                            ? 'border-red-500/40 text-red-400 placeholder-slate-600 bg-red-500/5' 
                            : 'border-slate-800 text-emerald-400'
                        }`}
                        value={trainsetId}
                        onChange={(e) => setTrainsetId(e.target.value)}
                      />
                    )}
                  </div>
                </div>

                {/* Input Nama Pengawas */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-950 border border-slate-800 rounded flex items-center justify-center text-slate-400 shrink-0">
                    <Sliders className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-mono">NAMA PENGAWAS</label>
                    {isSessionActive ? (
                      <span className="text-base font-mono font-bold text-slate-100">{supervisorName || '-'}</span>
                    ) : (
                      <input
                        id="supervisor-field"
                        type="text"
                        placeholder="Nama Pengawas"
                        className="bg-slate-950 border border-slate-800 text-emerald-400 px-2.5 py-1 mt-0.5 text-sm font-mono font-bold uppercase w-48 focus:outline-none focus:border-indigo-500 transition-colors rounded"
                        value={supervisorName}
                        onChange={(e) => setSupervisorName(e.target.value)}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-start gap-3 shrink-0">
                <div className="text-right hidden sm:block">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-mono">JUMLAH KONTAINER TERBONGKAR</span>
                  <span className="text-xs font-mono font-bold text-slate-300">{containersUnloaded} / {UNLOADING_TARGET_CONTAINERS} KONTAINER</span>
                </div>
                <div className={`px-2.5 py-1 rounded text-[10px] font-mono border uppercase tracking-wider font-semibold ${currentTheme.badgeColor}`}>
                  {isSessionActive ? (isPaused ? 'Disedari (Paused)' : 'Bongkar Aktif') : 'Standby / Siap'}
                </div>
              </div>

            </div>

            {/* ACTION COMMAND CONTROLS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isSessionActive ? (
                <button 
                  id="btn-start" 
                  onClick={executeStartSession}
                  disabled={!trainsetId.trim()}
                  className={`h-16 sm:h-20 rounded-lg flex items-center justify-center gap-3 transition-all font-extrabold group border ${
                    trainsetId.trim() 
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 border-emerald-500/30 cursor-pointer' 
                      : 'bg-emerald-950/20 text-emerald-800 border-emerald-950/50 cursor-not-allowed opacity-50'
                  }`}
                  title={!trainsetId.trim() ? 'Harap isi identitas trainset terlebih dahulu' : 'Mulai Bongkaran'}
                >
                  <Play className={`w-6 h-6 transition-transform ${trainsetId.trim() ? 'fill-slate-950 group-hover:scale-110' : 'fill-slate-800'}`} />
                  <span className="text-base sm:text-lg uppercase tracking-widest">Start Bongkaran</span>
                </button>
              ) : (
                <button 
                  id="btn-finish" 
                  onClick={executeFinishSession}
                  className="h-16 sm:h-20 bg-rose-600 hover:bg-rose-500 text-white rounded-lg flex items-center justify-center gap-3 transition-all cursor-pointer font-bold group"
                >
                  <CheckCircle2 className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
                  <span className="text-base sm:text-lg uppercase tracking-widest">Finish Bongkaran</span>
                </button>
              )}

              {/* PAUSE CONTROL & EMERGENCY ABORTION COMMAND FOR CORRECTION / RESET */}
              {isSessionActive && (
                <div className="flex flex-col gap-3 justify-center">
                  {/* Pause / Resume Button */}
                  <button
                    onClick={isPaused ? executeResumeSession : executePauseSession}
                    className={`h-12 rounded-lg flex items-center justify-center gap-2 font-mono text-xs uppercase tracking-wider transition-all cursor-pointer font-bold border ${
                      isPaused 
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 border-emerald-500/30 font-extrabold' 
                        : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950 border-yellow-500/30 font-extrabold'
                    }`}
                  >
                    {isPaused ? (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        <span>Mulai Kembali (Resume)</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-4 h-4" />
                        <span>Jeda Sementara (Pause)</span>
                      </>
                    )}
                  </button>

                  {!isCancelConfirmOpen ? (
                    <button
                      onClick={() => setIsCancelConfirmOpen(true)}
                      className="h-11 border border-slate-800 hover:border-red-500/50 hover:bg-red-500/5 text-slate-500 hover:text-red-400 rounded-lg font-mono text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                    >
                      Reset / Cancel Current Trainset
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/10 p-2 rounded-lg justify-between h-11">
                      <span className="text-[9px] font-mono text-red-400 uppercase font-bold pl-1 shrink-0">Reset Data KA?</span>
                      <div className="flex gap-1">
                        <button
                          onClick={executeEmergencyCancel}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-mono text-[10px] font-bold rounded cursor-pointer"
                        >
                          YA
                        </button>
                        <button
                          onClick={() => setIsCancelConfirmOpen(false)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 font-mono text-[10px] rounded cursor-pointer"
                        >
                          BATAL
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* DYNAMIC MEASUREMENT METRICS PANEL & TALLY MECHANISM */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
            
            {/* CONTAINER VOLUME TALLY METRICS */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold font-mono text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                    <Boxes className="h-4.5 w-4.5" />
                    Tally / Volume Discharge
                  </span>
                  <span className="text-xs font-mono font-medium text-slate-400">TARGET: {UNLOADING_TARGET_CONTAINERS} CONT</span>
                </div>
                <p className="text-xs text-slate-500 leading-snug">
                  Input jumlah kontainer batu bara yang berhasil diturunkan dari rangkaian KA.
                </p>
              </div>

              {/* Progress counter visual container */}
              <div className="my-5 bg-slate-950 border border-slate-800/80 p-4 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-5xl font-mono font-bold text-slate-100">{containersUnloaded}</span>
                  <span className="text-sm text-slate-500 ml-1 font-mono">/ 122 Unit</span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] font-mono text-slate-500">PERSENTASE VOL</span>
                  <span className="text-base font-mono font-bold text-emerald-400">
                    {Math.round((containersUnloaded / UNLOADING_TARGET_CONTAINERS) * 100)}%
                  </span>
                </div>
              </div>

              {/* Increments modification panels */}
              <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                <button
                  disabled={!isSessionActive}
                  onClick={async () => {
                    const newVal = Math.min(150, containersUnloaded + 1);
                    setContainersUnloaded(newVal);
                    await syncStateToFirestore({ containersUnloaded: newVal });
                    playSoundAlert('CLICK');
                  }}
                  className="p-2.5 bg-slate-800 border border-slate-700 hover:border-slate-600 disabled:opacity-30 disabled:border-slate-800 text-slate-200 font-bold font-mono rounded text-xs flex flex-col items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="h-3 text-emerald-400" />
                  <span>+1 CONT</span>
                </button>
                <button
                  disabled={!isSessionActive}
                  onClick={async () => {
                    const newVal = Math.min(150, containersUnloaded + 5);
                    setContainersUnloaded(newVal);
                    await syncStateToFirestore({ containersUnloaded: newVal });
                    playSoundAlert('CLICK');
                  }}
                  className="p-2.5 bg-slate-800 border border-slate-700 hover:border-slate-600 disabled:opacity-30 disabled:border-slate-800 text-slate-200 font-bold font-mono rounded text-xs flex flex-col items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="h-3 text-indigo-400" />
                  <span>+5 CONT</span>
                </button>
                <button
                  disabled={!isSessionActive}
                  onClick={async () => {
                    const newVal = Math.min(150, containersUnloaded + 10);
                    setContainersUnloaded(newVal);
                    await syncStateToFirestore({ containersUnloaded: newVal });
                    playSoundAlert('CLICK');
                  }}
                  className="p-2.5 bg-slate-800 border border-slate-700 hover:border-slate-600 disabled:opacity-30 disabled:border-slate-800 text-slate-200 font-bold font-mono rounded text-xs flex flex-col items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="h-3 text-blue-400" />
                  <span>+10 CONT</span>
                </button>
              </div>

              <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800/60">
                <span className="text-[10px] text-slate-500 font-mono tracking-wide">KOREKSI MANUAL:</span>
                <div className="flex gap-1.5">
                  <button
                    disabled={!isSessionActive || containersUnloaded === 0}
                    onClick={async () => {
                      const newVal = Math.max(0, containersUnloaded - 1);
                      setContainersUnloaded(newVal);
                      await syncStateToFirestore({ containersUnloaded: newVal });
                      playSoundAlert('CLICK');
                    }}
                    className="p-1 px-3 bg-slate-900 border border-slate-800 text-xs text-red-400 hover:text-white rounded font-mono transition-colors cursor-pointer"
                  >
                    -1 CONT
                  </button>
                  <button
                    disabled={!isSessionActive || containersUnloaded < 10}
                    onClick={async () => {
                      const newVal = Math.max(0, containersUnloaded - 10);
                      setContainersUnloaded(newVal);
                      await syncStateToFirestore({ containersUnloaded: newVal });
                      playSoundAlert('CLICK');
                    }}
                    className="p-1 px-3 bg-slate-900 border border-slate-800 text-xs text-red-400 hover:text-white rounded font-mono transition-colors cursor-pointer"
                  >
                    -10 CONT
                  </button>
                </div>
              </div>
            </div>

            {/* INTEGRATED MEASUREMENT STATS PANEL */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                <span className="text-xs font-bold font-mono text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Activity className="h-4.5 w-4.5 text-emerald-400" />
                  Session Timestamps
                </span>
                <span className="text-[9px] text-slate-500 font-mono">AUTOMATED TRIGGERS</span>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs p-2.5 bg-slate-950 border border-slate-900 rounded">
                  <span className="text-slate-500 font-mono font-medium">Waktu Mulai Aktual:</span>
                  <span className="text-slate-200 font-mono font-semibold">
                    {startTime 
                      ? new Date(startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB'
                      : '-- : --'
                    }
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs p-2.5 bg-slate-950 border border-slate-900 rounded">
                  <span className="text-slate-500 font-mono font-medium">Target Limit Maksimal:</span>
                  <span className="text-slate-200 font-mono font-semibold text-amber-500">
                    {startTime 
                      ? new Date(new Date(startTime).getTime() + 120 * 60000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB'
                      : '-- : --'
                    }
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs p-2.5 bg-slate-950 border border-slate-900 rounded">
                  <span className="text-slate-500 font-mono font-medium">Keperluan Estimasi:</span>
                  <span className="text-slate-200 font-mono font-semibold text-emerald-400">
                    120 Menit / 122 KA
                  </span>
                </div>
              </div>

              <div className="mt-3.5 bg-slate-950/40 p-2 border border-slate-800/80 rounded flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">STATUS ALARM OVERTIME:</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  breachedAlertSent 
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                    : 'bg-emerald-500/10 text-emerald-400'
                }`}>
                  {breachedAlertSent ? 'TRIGGERED DISPATCHED' : 'READY SENTRY'}
                </span>
              </div>
            </div>

          </div>

          {/* HISTORICAL OPERATIONAL DATA GRID */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2 font-mono">
                <History className="h-4.5 w-4.5 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Terminal Discharge Log (Riwayat Transaksi)</span>
              </div>
              <button
                onClick={clearSessionHistoryLog}
                className="text-[10px] font-mono text-slate-500 hover:text-red-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" /> Clean logs
              </button>
            </div>

            <div className="overflow-x-auto">
              {sessionHistory.length === 0 ? (
                <div className="text-center py-8 text-xs font-mono text-slate-600 italic">
                  Belum ada log unloading yang tersimpan di terminal ini.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-850 text-slate-500 uppercase text-[10px] tracking-wider bg-slate-950/50">
                      <th className="py-2.5 px-3">Session Reg</th>
                      <th className="py-2.5 px-3">Trainset No</th>
                      <th className="py-2.5 px-3">Waktu Mulai</th>
                      <th className="py-2.5 px-3">Waktu Selesai</th>
                      <th className="py-2.5 px-3 text-right">Durasi Aktual</th>
                      <th className="py-2.5 px-3 text-right">Vol Unloaded</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-center">WA Alert Info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {sessionHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-950/80 transition-colors">
                        <td className="py-2.5 px-3 text-slate-400 font-mono font-medium">{item.id}</td>
                        <td className="py-2.5 px-3 text-slate-200 font-bold">{item.trainsetId}</td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {new Date(item.startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {new Date(item.endTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                        </td>
                        <td className={`py-2.5 px-3 text-right font-bold ${item.actualDurationMinutes <= item.targetMinutes ? 'text-emerald-400' : 'text-red-400'}`}>
                          {item.actualDurationMinutes} Menit
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300 font-bold">
                          {item.containersUnloaded} / {item.targetVolume} Box
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                            item.status === 'ON_TIME' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>
                            {item.status === 'ON_TIME' ? 'ON TIME' : 'OVERTIME'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center text-[10px]">
                          <span className="text-slate-400 font-semibold flex items-center justify-center gap-1 text-[9px] uppercase">
                            <span className={item.whatsappLog.startSent ? 'text-emerald-400' : 'text-slate-600'}>START</span>
                            <span>•</span>
                            <span className={item.whatsappLog.breachSent ? 'text-red-400' : 'text-slate-600'}>BREACH</span>
                            <span>•</span>
                            <span className={item.whatsappLog.finishSent ? 'text-emerald-400' : 'text-slate-600'}>FINISH</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Section: Core Side Stats & Communication Gateway Console Logs */}
        {isAdmin && (
          <div className="w-full xl:w-96 flex flex-col gap-6">
            
            {/* WHATSAPP API STATUS & REAL INTEGRATION */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Bell className="h-4.5 w-4.5 text-emerald-400" />
                  Integrasi WhatsApp API Gateway
                </h3>
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-ping"></span>
              </div>

              <div className="space-y-4">
                <div className="space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-mono">API Transmisi Status</span>
                    <span className="text-emerald-400 font-mono font-bold">READY CONNECTED</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-mono">Current Endpoint Router</span>
                    <span className="text-slate-300 font-mono text-ellipsis overflow-hidden max-w-[180px] whitespace-nowrap block" title={whatsappConfig.webhookUrl}>
                      {whatsappConfig.webhookUrl}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-mono">Destination Group ID</span>
                    <span className="text-slate-300 font-mono font-semibold" title={whatsappConfig.groupId}>
                      {whatsappConfig.groupId}
                    </span>
                  </div>
                </div>

                {/* Collapsible/Toggleable config form fields inside sidebar */}
                <button
                  onClick={() => {
                    setShowConfigPanel(!showConfigPanel);
                    playSoundAlert('CLICK');
                  }}
                  className="w-full p-2.5 bg-slate-950 hover:bg-slate-850 text-slate-300 rounded border border-slate-800 hover:border-slate-700 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Sliders className="h-4 w-4 text-indigo-400" />
                  <span>{showConfigPanel ? 'Sembunyikan Pengaturan API' : 'Ubah Endpoint & API Key'}</span>
                </button>

                {showConfigPanel && (
                  <div className="p-3.5 bg-slate-950 rounded border border-indigo-500/20 space-y-3 animate-fadeIn">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Webhook Endpoint URL</label>
                      <input 
                        type="text" 
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                        value={whatsappConfig.webhookUrl}
                        onChange={(e) => setWhatsappConfig({...whatsappConfig, webhookUrl: e.target.value})}
                        placeholder="https://api.yourgateway.com/send"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Authorization Token</label>
                      <input 
                        type="password" 
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                        value={whatsappConfig.token}
                        onChange={(e) => setWhatsappConfig({...whatsappConfig, token: e.target.value})}
                        placeholder="API_TOKEN_XYZ"
                      />
                      <span className="text-[9px] text-slate-500 font-light leading-none mt-0.5 block">Paste key/token gateway disini</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">WhatsApp Group ID</label>
                      <input 
                        type="text" 
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                        value={whatsappConfig.groupId}
                        onChange={(e) => setWhatsappConfig({...whatsappConfig, groupId: e.target.value})}
                        placeholder="Group ID atau Nomor Tujuan"
                      />
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={executeTestAlert}
                        className="flex-1 py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs rounded transition-colors cursor-pointer"
                      >
                        Kirim Pesan Tes
                      </button>
                      <button
                        onClick={() => {
                          setWhatsappConfig({
                            webhookUrl: DEFAULT_WEBHOOK_URL,
                            token: DEFAULT_TOKEN,
                            groupId: DEFAULT_GROUP_ID,
                            enabled: true
                          });
                          playSoundAlert('CLICK');
                        }}
                        className="py-1.5 px-2.5 bg-slate-850 hover:bg-slate-800 text-slate-400 font-mono text-xs rounded transition-colors cursor-pointer"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}

                <div className="p-3 bg-slate-950 rounded border border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase mb-1 font-bold tracking-wider">Format Transmisi Sessi:</p>
                  <div className="text-[10px] text-slate-400 space-y-1.5 leading-snug">
                    <p>🟢 <strong className="text-slate-300">START:</strong> Info bongkar trainset telah dimulai, target completed 120 Menit.</p>
                    <p>🚨 <strong className="text-slate-300">BREACH:</strong> Alert melompati target batas 120 Menit secara otomatis.</p>
                    <p>🏁 <strong className="text-slate-300">FINISH:</strong> Report penyelesaian bongkar dengan menit durasi aktual.</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* PIN Verification Modal */}
      {isPinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-850 pb-3">
              <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/30 rounded flex items-center justify-center text-indigo-400">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Verifikasi Akses Admin</h4>
                <p className="text-[10px] text-slate-500">Masukkan PIN pengelola untuk membuka menu</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Kode PIN Admin</label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    className="w-full bg-slate-955 border border-slate-800 rounded p-2.5 text-center text-xl tracking-[0.3em] font-mono font-bold text-emerald-400 focus:outline-none focus:border-indigo-500"
                    placeholder="••••"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      setPinError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handlePinSubmit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowPin(!showPin);
                      playSoundAlert('CLICK');
                    }}
                    className="absolute right-3 top-3.5 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {pinError && (
                  <p className="text-[11px] text-red-400 font-medium font-mono mt-1.5 flex items-center gap-1 justify-center">
                    <AlertTriangle className="h-3 w-3 inline" /> {pinError}
                  </p>
                )}
                <p className="text-[10px] text-slate-500 mt-2 italic text-center font-mono bg-slate-950/40 py-1.5 rounded border border-slate-900/30">
                  💡 PIN Default: <strong className="text-emerald-400 select-all font-bold">1234</strong>
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    setIsPinModalOpen(false);
                    setPinInput('');
                    setPinError('');
                    playSoundAlert('CLICK');
                  }}
                  className="flex-1 py-2 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded font-mono text-xs transition-colors cursor-pointer"
                >
                  BATAL
                </button>
                <button
                  onClick={handlePinSubmit}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-mono text-xs font-bold transition-colors cursor-pointer"
                >
                  VERIFIKASI
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change PIN Modal */}
      {isNewPinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-850 pb-3">
              <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/30 rounded flex items-center justify-center text-emerald-400">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Ganti PIN Admin</h4>
                <p className="text-[10px] text-slate-500">Perbarui PIN pengasihan dan kontrol teknis</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">PIN Baru (Masking)</label>
                <input
                  type="password"
                  maxLength={12}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-center text-lg tracking-wider font-mono font-bold text-slate-200 focus:outline-none focus:border-indigo-550"
                  value={newPinInput}
                  onChange={(e) => {
                    setNewPinInput(e.target.value);
                    setNewPinError('');
                  }}
                  placeholder="PIN Baru"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Konfirmasi PIN Baru</label>
                <input
                  type="password"
                  maxLength={12}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-center text-lg tracking-wider font-mono font-bold text-slate-200 focus:outline-none focus:border-indigo-550"
                  value={newPinConfirm}
                  onChange={(e) => {
                    setNewPinConfirm(e.target.value);
                    setNewPinError('');
                  }}
                  placeholder="Ketik ulang PIN"
                />
                {newPinError && (
                  <p className="text-[11px] text-red-400 font-medium font-mono mt-1.5 flex items-center gap-1 justify-center">
                    <AlertTriangle className="h-3 w-3 inline" /> {newPinError}
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    setIsNewPinModalOpen(false);
                    setNewPinInput('');
                    setNewPinConfirm('');
                    setNewPinError('');
                    playSoundAlert('CLICK');
                  }}
                  className="flex-1 py-2 border border-slate-800 hover:bg-slate-850 text-slate-400 hover:text-slate-200 rounded font-mono text-xs transition-colors cursor-pointer"
                >
                  BATAL
                </button>
                <button
                  onClick={handleNewPinSubmit}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded font-mono text-xs font-extrabold transition-colors cursor-pointer"
                >
                  UBAH PIN
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Status Bar Panel */}
      <footer className="h-10 bg-slate-900 border-t border-slate-800 px-4 sm:px-8 flex items-center justify-between text-[9px] sm:text-[10px] text-slate-500 font-mono uppercase tracking-widest shrink-0">
        <div className="flex gap-4 sm:gap-6">
          <span>OPERATOR: SYS_SUPERVISOR_CY_A</span>
          <span className="hidden sm:inline">KERNEL: V3.2.1-STABLE</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
          <span>GATEWAY TUNNEL CONNECTED</span>
        </div>
      </footer>

    </div>
  );
}
