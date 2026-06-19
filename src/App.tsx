import { useState, useEffect } from "react";
import { useBongkaranSession } from "./hooks/useBongkaranSession";
import { collection, query, where, onSnapshot, orderBy, limit, doc, deleteDoc } from "firebase/firestore";
import { db } from "./firebaseClient";
import InitializeSession from "./components/InitializeSession";
import UnloadingMonitor from "./components/UnloadingMonitor";
import HistoryLogs from "./components/HistoryLogs";
import FonnteLiveFeed from "./components/FonnteLiveFeed";
import { 
  Clock, 
  FileSpreadsheet, 
  MessageSquare, 
  Train, 
  PlusCircle, 
  RefreshCw,
  LogOut,
  Settings,
  HelpCircle,
  XCircle,
  Menu,
  X,
  Sun,
  Moon
} from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState<"monitor" | "history" | "fonnte">("monitor");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem("activeSessionId");
  });
  const [showNav, setShowNav] = useState(false);
  
  // Theme dark mode state
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("theme") === "dark";
  });

  // Sync dark mode class on HTML document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  // Set browser tab favicon dynamically to PT WBS logo
  useEffect(() => {
    const link: HTMLLinkElement = document.querySelector("link[rel*='icon']") || document.createElement("link");
    link.type = "image/jpeg";
    link.rel = "shortcut icon";
    link.href = "https://res.cloudinary.com/dgjnlxf69/image/upload/v1781846868/3c323f2d-def8-4c64-92c4-ca9314d29572_qc0eqr.jpg";
    document.getElementsByTagName("head")[0].appendChild(link);
  }, []);

  // Menyimpan seluruh sesi aktif yang dideteksi dari database secara real-time
  const [runningSessions, setRunningSessions] = useState<{ id: string; train_number: string; status: string }[]>([]);
  const [loadingActiveLookup, setLoadingActiveLookup] = useState(true);


  // Hook utama untuk sinkronisasi state ke Cloud Firestore
  const {
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
  } = useBongkaranSession(activeSessionId);

  // Simpan activeSessionId ke localStorage saat berubah
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem("activeSessionId", activeSessionId);
    } else {
      localStorage.removeItem("activeSessionId");
    }
  }, [activeSessionId]);

  // Kembalikan ke halaman depan ketika status sesi aktif berubah menjadi selesai (COMPLETED)
  useEffect(() => {
    if (session && session.status === "COMPLETED") {
      setActiveSessionId(null);
    }
  }, [session]);

  // Sinkronisasi pendeteksian sesi aktif yang masih berjalan (status NOT COMPLETED)
  // Index-free query: Hanya mengurutkan berdasarkan created_at desc (single-field built-in index)
  // lalu melakukan filtrasi in-memory untuk menjamin durabilitas tanpa kegagalan query.
  useEffect(() => {
    const sessionsRef = collection(db, "sessions");
    const q = query(
      sessionsRef, 
      orderBy("created_at", "desc"),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: { id: string; train_number: string; status: string }[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data && ["INIT", "RUNNING", "PAUSED"].includes(data.status)) {
          list.push({
            id: docSnap.id,
            train_number: data.train_number || "",
            status: data.status
          });
        }
      });
      setRunningSessions(list);
      
      // Jika ada sesi aktif dan client belum memilih sesi apa-apa,
      // auto-select sesi aktif paling terbaru (Skenario Perangkat Mati / Ganti Checker)
      if (list.length > 0 && !activeSessionId) {
        setActiveSessionId(list[0].id);
      }
      setLoadingActiveLookup(false);
    }, (err) => {
      console.log("Error checking active sessions: ", err);
      setLoadingActiveLookup(false);
    });

    return () => unsubscribe();
  }, [activeSessionId]);

  // Handle pemindahan ke sesi baru
  const handleStartNewSession = async (
    customSessionId: string,
    trainNumber: string,
    checkerName: string,
    groupleaderName: string
  ): Promise<boolean> => {
    const success = await startSession(customSessionId, trainNumber, checkerName, groupleaderName);
    if (success) {
      setActiveSessionId(customSessionId);
    }
    return success;
  };

  // Force-close/reset sesi aktif saat ini
  const forceQuitSession = () => {
    setActiveSessionId(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 flex flex-col font-sans selection:bg-emerald-500 selection:text-white transition-colors duration-200">
      
      {/* HEADER UTAMA - BRIGHT GLOSSY GLASS STYLE */}
      <header className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 sticky top-0 z-40 px-3 sm:px-4 md:px-6 py-3 sm:py-4 flex items-center justify-between shadow-sm transition-colors duration-200">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl overflow-hidden shadow-md flex items-center justify-center bg-white border border-slate-200/50 dark:border-slate-800">
            <img 
              src="https://res.cloudinary.com/dgjnlxf69/image/upload/v1781846868/3c323f2d-def8-4c64-92c4-ca9314d29572_qc0eqr.jpg" 
              alt="PT Wahana Bara Sentosa Logo" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <h1 className="text-sm sm:text-md md:text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>TIMER BONGKARAN KA</span>
              <span className="text-[8px] sm:text-[9px] font-black bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 py-0.5 px-2 rounded-full border border-blue-100 dark:border-blue-900 shadow-sm whitespace-nowrap">
                V2.0 PRO
              </span>
            </h1>
            <p className="text-[9px] sm:text-[10px] text-slate-600 dark:text-slate-400 font-bold tracking-wide line-clamp-1">
              Monitoring & Pencatatan Waktu Bongkaran KA PT WBS
            </p>
          </div>
        </div>

        {/* Kontrol Navigasi & Info Theme + Koneksi */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Theme Switch Button */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            type="button"
            className="w-9 h-9 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-amber-400 rounded-xl border border-slate-200/50 dark:border-slate-700 transition cursor-pointer flex items-center justify-center shadow-sm"
            title={darkMode ? "Aktifkan Mode Terang" : "Aktifkan Mode Gelap"}
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            onClick={() => setShowNav(!showNav)}
            type="button"
            className="w-9 sm:w-auto h-9 px-0 sm:px-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition duration-150 cursor-pointer text-slate-700 dark:text-slate-300 shadow-sm flex items-center justify-center gap-1.5"
          >
            {showNav ? <X size={14} className="text-rose-500" /> : <Menu size={14} className="text-blue-500" />}
            <span className="hidden sm:inline">{showNav ? "Tutup Menu" : "Menu"}</span>
          </button>

          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 border border-slate-200/40 dark:border-slate-700/60 px-2 sm:px-3 py-1.5 rounded-xl shadow-inner">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[9px] font-mono text-slate-700 dark:text-slate-350 font-bold uppercase tracking-wider">
              <span className="hidden xs:inline">WBS • </span>LIVE
            </span>
          </div>
        </div>
      </header>

      {/* DASHBOARD GRID CONTENT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        
        {/* KOLOM Kiri: Navigation & Active Sessions (4 Grid) - Hanya dilihat bila diperlukan */}
        {showNav && (
          <div className="lg:col-span-4 space-y-4 sm:space-y-5 animate-in slide-in-from-left duration-200">
            
            {/* Quick Menu */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm transition-colors duration-200">
              <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-widest pl-1">
                Menu Navigasi
              </h3>
              
              <nav className="flex flex-col gap-2">
                <button
                  onClick={() => setActiveTab("monitor")}
                  className={`w-full flex items-center justify-between p-3 rounded-2xl font-bold text-sm transition cursor-pointer ${
                    activeTab === "monitor"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-md"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/50 dark:bg-slate-800/50 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-700/50"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Clock size={16} />
                    <span>Operation Monitor</span>
                  </div>
                  {session && (
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      activeTab === "monitor" ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800"
                    }`}>
                      ACTIVE
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab("history")}
                  className={`w-full flex items-center gap-2.5 p-3 rounded-2xl font-bold text-sm transition cursor-pointer ${
                    activeTab === "history"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-md"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/50 dark:bg-slate-800/50 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-700/50"
                  }`}
                >
                  <FileSpreadsheet size={16} />
                  <span>Log Histori & Delay</span>
                </button>

                <button
                  onClick={() => setActiveTab("fonnte")}
                  className={`w-full flex items-center gap-2.5 p-3 rounded-2xl font-bold text-sm transition cursor-pointer ${
                    activeTab === "fonnte"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-md"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/50 dark:bg-slate-800/50 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-700/50"
                  }`}
                >
                  <MessageSquare size={16} />
                  <span>WhatsApp Fonnte Feed</span>
                </button>
              </nav>
            </div>

            {/* SINKRONISASI BANYAK PERANGKAT (Multi-Device Sync Panel) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 transition-colors duration-200">
              <div>
                <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">
                  Sinkronisasi Multi-Device
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed font-medium">
                  Checker cadangan atau pengawas dapat beralih ke sesi aktif mana pun secara instan dan real-time.
                </p>
              </div>

              {loadingActiveLookup ? (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw size={16} className="animate-spin text-blue-500" />
                </div>
              ) : runningSessions.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center italic font-semibold">
                  Tidak ada KA yang sedang aktif.
                </p>
              ) : (
                <div className="space-y-2">
                  {runningSessions.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => {
                        setActiveSessionId(run.id);
                        setActiveTab("monitor");
                      }}
                      className={`w-full text-left p-3 rounded-2xl border transition flex items-center justify-between cursor-pointer ${
                        activeSessionId === run.id
                          ? "bg-blue-50/70 border-blue-400 text-blue-700 font-bold dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300"
                          : "bg-slate-50 border-slate-200/50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800/50 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <span className="text-[9px] font-mono font-bold block text-slate-500 dark:text-slate-400 truncate">{run.id}</span>
                        <strong className="text-xs text-slate-800 dark:text-slate-200 font-extrabold block truncate">Rangkaian {run.train_number}</strong>
                      </div>
                      <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900 font-extrabold py-0.5 px-2 rounded-full font-mono uppercase tracking-wider flex-shrink-0">
                        {run.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {activeSessionId && (
                <button
                  onClick={forceQuitSession}
                  className="w-full text-center text-xs text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/60 border border-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950 dark:border-rose-900 dark:text-rose-400 p-3 rounded-2xl transition mt-2 cursor-pointer flex items-center justify-center gap-1.5 font-bold"
                >
                  <LogOut size={12} />
                  <span>Lepas / Ganti Monitoring KA</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* KOLOM KANAN: Dynamic Tab view (8 Grid atau 12 Grid) */}
        <div className={showNav ? "lg:col-span-8 w-full" : "lg:col-span-12 w-full max-w-2xl mx-auto"}>
          
          {/* TAB 1: Monitor Aktif */}
          {activeTab === "monitor" && (
            <div className="space-y-4">
              {loading ? (
                <div className="flex flex-col justify-center items-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm transition-colors duration-200">
                  <RefreshCw size={36} className="animate-spin text-blue-500 mb-3" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Menghubungkan ke server awan...</p>
                </div>
              ) : session ? (
                /* VIEW AKTIF: TAMPILAN MONITOR TIMER */
                <UnloadingMonitor
                  session={session}
                  liveNetSeconds={liveNetSeconds}
                  liveGrossSeconds={liveGrossSeconds}
                  onIncrement={incrementContainers}
                  onDecrement={decrementContainers}
                  onPause={pauseSession}
                  onResume={resumeSession}
                  onFinish={finishSession}
                />
              ) : (
                /* VIEW KOSONG / BELUM ADA SEKTOR KA DIINISIALISASI (FASE 1) */
                <InitializeSession onStart={handleStartNewSession} />
              )}
            </div>
          )}

          {/* TAB 2: Log Histori */}
          {activeTab === "history" && (
            <div className="h-full">
              <HistoryLogs />
            </div>
          )}

          {/* TAB 3: WhatsApp Live Stream (Fonnte) */}
          {activeTab === "fonnte" && (
            <div className="h-full">
              <FonnteLiveFeed />
            </div>
          )}

        </div>
      </main>

      {/* FOOTER CORPORATE COPY */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-150 dark:border-slate-850 py-5 px-6 text-center text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-auto transition-colors duration-200">
        <p>© 2026 Timer Bongkaran KA • PT Wahana Bara Sentosa • CY & Port Operation Department</p>
      </footer>
    </div>
  );
}
