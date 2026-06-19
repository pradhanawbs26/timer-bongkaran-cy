import { useState } from "react";
import { UnloadingSession } from "../types";
import { 
  Play, 
  Pause, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Hourglass, 
  User, 
  TrendingUp, 
  AlertOctagon,
  ChevronRight,
  Settings,
  X,
  Plus,
  Minus
} from "lucide-react";

interface UnloadingMonitorProps {
  session: UnloadingSession;
  liveNetSeconds: number;
  liveGrossSeconds: number;
  onIncrement: (amount?: number) => Promise<void>;
  onDecrement: (amount?: number) => Promise<void>;
  onPause: (reason: string) => Promise<void>;
  onResume: () => Promise<void>;
  onFinish: () => Promise<void>;
}

export default function UnloadingMonitor({
  session,
  liveNetSeconds,
  liveGrossSeconds,
  onIncrement,
  onDecrement,
  onPause,
  onResume,
  onFinish
}: UnloadingMonitorProps) {
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [customReason, setCustomReason] = useState("");
  const [completing, setCompleting] = useState(false);

  // Batas 120 Menit Target dalam detik
  const TARGET_SECONDS = 120 * 60; 

  // Selisih waktu target dengan durasi bersih berjalan (net)
  const remainingSeconds = TARGET_SECONDS - liveNetSeconds;
  const isOvertime = remainingSeconds < 0;

  // Format durasi agar rapih (HH:MM:SS atau MM:SS)
  const formatTime = (totalSecs: number) => {
    const absSecs = Math.abs(totalSecs);
    const hrs = Math.floor(absSecs / 3600);
    const mins = Math.floor((absSecs % 3600) / 60);
    const secs = absSecs % 60;

    const pad = (val: number) => String(val).padStart(2, "0");
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  // Tentukan warna tema berdasarkan menit bersih operasional
  const netMinutes = Math.floor(liveNetSeconds / 60);
  let statusColor = "emerald"; // 0-100 mnt: Hijau
  let statusText = "OPERASIONAL NORMAL";

  if (netMinutes >= 100 && netMinutes < 120) {
    statusColor = "amber"; // 100-120 mnt: Kuning
    statusText = "WARNING: MENDEKATI TARGET";
  } else if (netMinutes >= 120) {
    statusColor = "red"; // >120 mnt: Merah
    statusText = "CRITICAL: MELEBIHI TARGET 120 MIN";
  }

  const textColors = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    red: "text-rose-600 dark:text-rose-400"
  }[statusColor];

  const bgColors = {
    emerald: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-150 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400",
    amber: "bg-amber-50 dark:bg-amber-950/40 border-amber-150 dark:border-amber-900 text-amber-700 dark:text-amber-400",
    red: "bg-rose-50 dark:bg-rose-950/40 border-rose-150 dark:border-rose-900 text-rose-700 dark:text-rose-400"
  }[statusColor];

  const ringColors = {
    emerald: "stroke-emerald-500 dark:stroke-emerald-400",
    amber: "stroke-amber-500 dark:stroke-amber-400",
    red: "stroke-rose-500 dark:stroke-rose-400"
  }[statusColor];

  // List of standard delay reasons
  const delayReasons = [
    "Rest Time",
    "Change Shift",
    "Hujan di CY",
    "Hujan di Stockpile",
    "CY Berdebu",
    "Jalan hauling terhambat",
    "Stockpile terhambat",
    "Timbangan breakdown"
  ];

  const handlePauseSelect = async (reason: string) => {
    await onPause(reason);
    setShowPauseModal(false);
  };

  const handleCustomPause = async () => {
    if (!customReason.trim()) return;
    await onPause(customReason.trim());
    setCustomReason("");
    setShowPauseModal(false);
  };

  const handleFinishConfirm = async () => {
    setCompleting(true);
    try {
      await onFinish();
      await fetch(`/api/sessions/${session.session_id}/complete-notif`, {
        method: "POST"
      });
    } catch (e) {
      console.error("Gagal menyelesaikan sesi:", e);
    } finally {
      setCompleting(false);
      setShowFinishConfirm(false);
    }
  };

  // Hitung persentase progress lingkaran countdown (ke arah 120 menit)
  const progressPercent = Math.min((liveNetSeconds / TARGET_SECONDS) * 100, 100);

  // Formatter untuk jam target cetak
  const formatJktHours = (timestampSeconds: number) => {
    return new Date(timestampSeconds * 1000).toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }) + " WIB";
  };

  // Jam targets computed
  const jamMulai = formatJktHours(session.start_timestamp);
  const jamTargetSelesai = formatJktHours(session.start_timestamp + 120 * 60);
  const jamBatasAkhir = formatJktHours(session.start_timestamp + 180 * 60);

  return (
    <div className={`space-y-4 sm:space-y-5 max-w-xl mx-auto pb-10 transition-all duration-500 ${netMinutes >= 120 ? 'ring-4 ring-rose-500/20 dark:ring-rose-500/10 rounded-3xl p-1 bg-rose-50/10' : ''}`}>
      
      {/* 3.1. GAUGES & TIMER RING - GLOSSY INSPIRED */}
      <div className="flex flex-col items-center justify-center py-5 sm:py-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-md relative overflow-hidden transition-colors duration-200">
        
        {/* Detail Kereta Aktif */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 bg-slate-50 dark:bg-slate-950 px-3 sm:px-4 py-1.5 sm:py-2 border border-slate-150 dark:border-slate-800/80 rounded-full text-[11px] sm:text-xs text-slate-700 dark:text-slate-300 font-bold mb-4 sm:mb-5 shadow-inner">
          <Clock size={12} className="text-blue-500 flex-shrink-0" />
          <span className="text-blue-600 dark:text-blue-400 font-black">{session.train_number}</span>
          <span className="text-slate-300 dark:text-slate-700 font-light">|</span>
          <span className="text-slate-600 dark:text-slate-400">CK: <strong className="text-slate-800 dark:text-slate-200 font-extrabold">{session.checker_name}</strong></span>
          <span className="text-slate-300 dark:text-slate-700 font-light">|</span>
          <span className="text-slate-600 dark:text-slate-400">GL: <strong className="text-slate-800 dark:text-slate-200 font-extrabold">{session.groupleader_name}</strong></span>
        </div>

        {/* Lingkaran Countdown Super Besar - Glossy Style */}
        <div className="relative flex items-center justify-center my-1 sm:my-2">
          {/* SVG ring progress meter */}
          <svg viewBox="0 0 224 224" className="w-44 h-44 sm:w-56 sm:h-56 transform -rotate-90 filter drop-shadow">
            <defs>
              <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <linearGradient id="amberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#d97706" />
              </linearGradient>
              <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#dc2626" />
              </linearGradient>
            </defs>
            <circle
              cx="112"
              cy="112"
              r="94"
              className="stroke-slate-100 dark:stroke-slate-800 fill-transparent"
              strokeWidth="11"
            />
            <circle
              cx="112"
              cy="112"
              r="94"
              className="fill-transparent transition-all duration-1000"
              strokeWidth="11"
              stroke={statusColor === "emerald" ? "url(#emeraldGrad)" : statusColor === "amber" ? "url(#amberGrad)" : "url(#redGrad)"}
              strokeDasharray={2 * Math.PI * 94}
              strokeDashoffset={2 * Math.PI * 94 * (1 - progressPercent / 100)}
              strokeLinecap="round"
            />
          </svg>

          {/* Teks didalam lingkaran */}
          <div className="absolute inset-x-0 inset-y-0 flex flex-col items-center justify-center text-center px-4">
            <span className="text-[8px] sm:text-[9px] font-extrabold tracking-wider text-slate-500 dark:text-slate-450 uppercase">
              {isOvertime ? "KETERLAMBATAN (OVERTIME)" : "SISA WAKTU UNTUK TARGET"}
            </span>
            <h1 className={`text-2xl sm:text-4xl font-extrabold tracking-tight my-1 sm:my-1.5 ${textColors} font-mono flex items-baseline`}>
              {formatTime(remainingSeconds)}
            </h1>
            <span className={`text-[8px] sm:text-[9px] font-bold px-2.5 py-0.5 sm:py-1 rounded-full border ${bgColors} shadow-sm uppercase tracking-wide`}>
              {statusText}
            </span>
          </div>
        </div>

        {/* TARGET CLOCK SCHEDULE PANELS (Informasi Jam Mulai, Selesai, Batas Akhir)  */}
        <div className="w-full mt-4 sm:mt-6 grid grid-cols-3 gap-1.5 sm:gap-2 border-t border-slate-100 dark:border-slate-800 pt-4 sm:pt-5 text-center">
          <div className="bg-slate-50/50 dark:bg-slate-950/40 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl border border-slate-150 dark:border-slate-800/80">
            <p className="text-[8px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-extrabold uppercase tracking-wider">Jam Mulai</p>
            <p className="text-[10px] sm:text-xs font-black text-slate-800 dark:text-slate-200 mt-1">{jamMulai}</p>
          </div>
          <div className="bg-emerald-50/20 dark:bg-emerald-950/20 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl border border-emerald-150/60 dark:border-emerald-900/60">
            <p className="text-[8px] sm:text-[10px] text-emerald-600 dark:text-emerald-400 font-extrabold uppercase tracking-wider">Target Selesai</p>
            <p className="text-[10px] sm:text-xs font-black text-emerald-700 dark:text-emerald-305 mt-1">{jamTargetSelesai}</p>
          </div>
          <div className="bg-rose-50/20 dark:bg-rose-950/20 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl border border-rose-150/60 dark:border-rose-900/60">
            <p className="text-[8px] sm:text-[10px] text-rose-600 dark:text-rose-400 font-extrabold uppercase tracking-wider">Batas Akhir</p>
            <p className="text-[10px] sm:text-xs font-black text-rose-700 dark:text-rose-355 mt-1">{jamBatasAkhir}</p>
          </div>
        </div>

        {/* Info Durasi Tambahan (Net vs Gross) */}
        <div className="grid grid-cols-2 gap-2 sm:gap-4 w-full mt-3 sm:mt-4">
          <div className="bg-slate-50 dark:bg-slate-950 p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-150 dark:border-slate-800/85 text-center shadow-inner">
            <p className="text-[8px] sm:text-[9px] text-slate-500 dark:text-slate-405 uppercase tracking-widest font-black">Durasi Murni (Net)</p>
            <p className={`text-md sm:text-[22px] font-extrabold font-mono mt-0.5 ${textColors}`}>{formatTime(liveNetSeconds)}</p>
            <p className="text-[8px] sm:text-[9px] text-slate-500 dark:text-slate-405 mt-0.5 font-bold">Waktu Bongkar Bersih</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 p-2 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-150 dark:border-slate-800/85 text-center shadow-inner">
            <p className="text-[8px] sm:text-[9px] text-slate-500 dark:text-slate-450 uppercase tracking-widest font-black">Durasi Total (Gross)</p>
            <p className="text-md sm:text-[22px] font-extrabold font-mono text-slate-850 dark:text-slate-200 mt-0.5">{formatTime(liveGrossSeconds)}</p>
            <p className="text-[8px] sm:text-[9px] text-slate-500 dark:text-slate-450 mt-0.5 font-bold">Total Waktu di Lapangan</p>
          </div>
        </div>
      </div>

      {/* 3.2. INTERAKSI PENGGUNA - PENGHITUNG KONTAINER PLASTIK GLOSSY */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 md:p-6 shadow-md flex flex-col items-center justify-center transition-colors duration-200">
        <div className="flex items-center justify-between w-full mb-4">
          <div className="text-left">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-extrabold font-sans">Indikator Bongkaran</p>
            <h3 className="text-md sm:text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5">Kontainer Terbongkar</h3>
          </div>
          <span className="text-md sm:text-lg font-black font-mono text-emerald-600 dark:text-emerald-450 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-1.5 rounded-2xl border border-emerald-150 dark:border-emerald-800 shadow-sm transition-colors duration-250">
            {session.unloaded_containers} <span className="text-slate-500 dark:text-slate-400 font-sans text-xs">/ {session.total_containers}</span>
          </span>
        </div>

        {/* Progress Bar Kontainer */}
        <div className="w-full h-3.5 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-200 dark:border-slate-850 mb-6 flex shadow-inner">
          <div 
            className="bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full h-full transition-all duration-300"
            style={{ width: `${(session.unloaded_containers / session.total_containers) * 100}%` }}
          ></div>
        </div>

        {/* Tombol Tap Plus [+] Ekstra Gede */}
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5 w-full mb-3">
          <button
            onClick={() => onIncrement(1)}
            disabled={session.unloaded_containers >= session.total_containers || session.status !== "RUNNING"}
            className="h-14 sm:h-16 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-150 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-650 disabled:shadow-none text-xs sm:text-sm font-black text-white transition shadow-md shadow-emerald-500/10 rounded-2xl flex flex-col items-center justify-center select-none cursor-pointer border-t border-white/20"
          >
            <Plus size={15} fill="none" className="stroke-[3] mb-1" />
            <span>+1 CT</span>
          </button>
          
          <button
            onClick={() => onIncrement(5)}
            disabled={session.unloaded_containers >= session.total_containers || session.status !== "RUNNING"}
            className="h-14 sm:h-16 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-slate-150 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-650 disabled:shadow-none text-xs sm:text-sm font-black text-white transition shadow-md shadow-emerald-600/10 rounded-2xl flex flex-col items-center justify-center select-none cursor-pointer border-t border-white/20"
          >
            <Plus size={15} fill="none" className="stroke-[3] mb-1" />
            <span>+5 CT</span>
          </button>

          <button
            onClick={() => onIncrement(10)}
            disabled={session.unloaded_containers >= session.total_containers || session.status !== "RUNNING"}
            className="h-14 sm:h-16 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:bg-slate-150 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-650 disabled:shadow-none text-xs sm:text-sm font-black text-white transition shadow-md shadow-emerald-700/10 rounded-2xl flex flex-col items-center justify-center select-none cursor-pointer border-t border-white/20"
          >
            <Plus size={15} fill="none" className="stroke-[3] mb-1" />
            <span>+10 CT</span>
          </button>
        </div>

        {/* Tombol Tap Minus [-] */}
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5 w-full">
          <button
            onClick={() => onDecrement(1)}
            disabled={session.unloaded_containers <= 0 || session.status !== "RUNNING"}
            className="h-11 sm:h-12 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-35 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 dark:text-slate-300 dark:disabled:bg-slate-950 dark:disabled:text-slate-600 rounded-xl text-[10px] sm:text-xs font-bold text-slate-700 transition shadow-inner flex items-center justify-center gap-1 select-none cursor-pointer"
          >
            <Minus size={11} className="text-rose-500" />
            <span>-1 CT</span>
          </button>
          
          <button
            onClick={() => onDecrement(5)}
            disabled={session.unloaded_containers <= 0 || session.status !== "RUNNING"}
            className="h-11 sm:h-12 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-35 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 dark:text-slate-300 dark:disabled:bg-slate-950 dark:disabled:text-slate-600 rounded-xl text-[10px] sm:text-xs font-bold text-slate-700 transition shadow-inner flex items-center justify-center gap-1 select-none cursor-pointer"
          >
            <Minus size={11} className="text-rose-500" />
            <span>-5 CT</span>
          </button>

          <button
            onClick={() => onDecrement(10)}
            disabled={session.unloaded_containers <= 0 || session.status !== "RUNNING"}
            className="h-11 sm:h-12 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-35 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 dark:text-slate-300 dark:disabled:bg-slate-950 dark:disabled:text-slate-600 rounded-xl text-[10px] sm:text-xs font-bold text-slate-700 transition shadow-inner flex items-center justify-center gap-1 select-none cursor-pointer"
          >
            <Minus size={11} className="text-rose-500" />
            <span>-10 CT</span>
          </button>
        </div>

        {session.status !== "RUNNING" && (
          <p className="text-xs text-amber-800 dark:text-amber-400 font-extrabold mt-4 flex items-center gap-1.5 justify-center bg-amber-50 dark:bg-amber-950/40 px-3.5 py-1.5 rounded-xl border border-amber-100/60 dark:border-amber-900/60 leading-relaxed">
            <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
            <span>Aktifkan timer (RESUME) terlebih dahulu untuk menambah kontainer.</span>
          </p>
        )}
      </div>

      {/* FOOTER CONTROLS - INTERACTIVE PANEL */}
      <div className="grid grid-cols-2 gap-4">
        {session.status === "RUNNING" ? (
          <button
            onClick={() => setShowPauseModal(true)}
            className="flex h-16 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-extrabold items-center justify-center gap-2 rounded-2xl cursor-pointer transition shadow-md shadow-amber-500/20"
          >
            <Pause size={18} fill="currentColor" className="stroke-none" />
            <span className="text-xs sm:text-sm">CATAT DELAY / PAUSE</span>
          </button>
        ) : session.status === "PAUSED" ? (
          <button
            onClick={onResume}
            className="flex h-16 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-extrabold items-center justify-center gap-2 rounded-2xl cursor-pointer transition shadow-md shadow-emerald-500/20"
          >
            <Play size={18} fill="currentColor" className="stroke-none" />
            <span className="text-xs sm:text-sm border-t border-transparent">RESUME (LANJUT)</span>
          </button>
        ) : (
          <div className="h-16 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 flex items-center justify-center italic text-xs text-slate-500 dark:text-slate-400 font-bold">
            Sesi {session.status}
          </div>
        )}

        <button
          onClick={() => setShowFinishConfirm(true)}
          className="flex h-16 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-extrabold items-center justify-center gap-2 rounded-2xl cursor-pointer transition shadow-md shadow-indigo-600/25"
        >
          <CheckCircle size={18} />
          <span className="text-xs sm:text-sm">SELESAI (FINISH)</span>
        </button>
      </div>

      {/* --- MODAL BOX PAUSE DIAL PAD (ZERO-TYPING DI LAPANGAN) --- */}
      {showPauseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto transition-all">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl relative">
            <h3 className="text-lg font-black text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={20} />
              <span>Pencatatan Delay Bongkaran</span>
            </h3>
            <p className="text-xs text-slate-650 dark:text-slate-400 mb-5 leading-relaxed font-semibold">
              Silakan ketuk alasan cepat di bawah ini untuk mencatat hambatannya agar tercatat otomatis ke WhatsApp.
            </p>

            {/* Quick Tap Zero-Typing Buttons */}
            <div className="grid grid-cols-2 gap-2.5 mb-5">
              {delayReasons.map((reason) => (
                <button
                  key={reason}
                  onClick={() => handlePauseSelect(reason)}
                  className="bg-slate-50 hover:bg-slate-100 active:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 dark:active:bg-slate-750 border border-slate-200 dark:border-slate-750 text-left py-3 px-3.5 rounded-2xl text-xs text-slate-700 dark:text-slate-300 font-extrabold transition cursor-pointer flex items-center justify-between"
                >
                  <span className="truncate mr-1">{reason}</span>
                  <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                </button>
              ))}
            </div>

            {/* Opsi custom typing manual jika terpaksa */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
              <label className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-black">
                Alasan Lain (Manual)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ketik detail alasan delay lainnya..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-750 rounded-xl text-xs py-2.5 px-3.5 text-slate-850 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 dark:focus:border-blue-600 focus:ring-1 focus:ring-blue-500/10 placeholder:text-slate-500"
                />
                <button
                  onClick={handleCustomPause}
                  disabled={!customReason.trim()}
                  className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-100 dark:disabled:bg-slate-850 disabled:text-slate-400 dark:disabled:text-slate-600 text-white font-bold text-xs px-4 rounded-xl transition cursor-pointer"
                >
                  Simpan
                </button>
              </div>
            </div>

            {/* Cancel Button */}
            <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setShowPauseModal(false)}
                className="bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold px-4 py-2.5 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRMATION MODAL FINISH SESSIONS --- */}
      {showFinishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 transition-all">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-slate-200 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center space-y-3 mb-5">
              <div className="mx-auto w-12 h-12 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center border border-indigo-100 dark:border-indigo-900 shadow-inner">
                <CheckCircle size={22} className="stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">Konfirmasi Penyelesaian</h3>
              <p className="text-xs text-slate-655 dark:text-slate-400 leading-relaxed font-semibold">
                Apakah Anda yakin ingin menyelesaikan pembongkaran KA ini? 
                Aplikasi akan mengunci durasi akhir dan mengirimkan laporan penutupan WhatsApp ke grup operasional.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowFinishConfirm(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold text-xs py-3 rounded-xl transition cursor-pointer"
              >
                KEMBALI
              </button>
              <button
                onClick={handleFinishConfirm}
                disabled={completing}
                className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                {completing ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <span>YA, SELESAI & KIRIM</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
