import { useState, useEffect, FormEvent } from "react";
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebaseClient";
import { 
  MessageSquare, 
  Clock, 
  PhoneCall, 
  CheckCircle, 
  XCircle, 
  Settings, 
  Send, 
  Key, 
  Users, 
  CheckCheck, 
  AlertTriangle 
} from "lucide-react";

interface FonnteLog {
  id: string;
  message: string;
  target: string;
  timestamp: number;
  status: string;
  raw_response?: any;
}

export default function FonnteLiveFeed() {
  const [logs, setLogs] = useState<FonnteLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Configuration States
  const [apiKey, setApiKey] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Testing States
  const [testMessage, setTestMessage] = useState("Uji Coba Koneksi WhatsApp PT Wahana Bara Sentosa - Sistem Aktif dan Terhubung.");
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<{ success: boolean; message: string } | null>(null);

  // 1. Ambil konfigurasi Fonnte tersimpan dari doc sessions/settings_fonnte
  useEffect(() => {
    async function loadConfig() {
      try {
        const snap = await getDoc(doc(db, "sessions", "settings_fonnte"));
        if (snap.exists()) {
          const data = snap.data();
          setApiKey(data.apiKey || "");
          setTargetGroup(data.targetGroup || "");
        } else {
          // Fallback default placeholder
          setApiKey("iNfrBRnqQj4izhPo4PKL");
          setTargetGroup("628117882902-1623340497@g.us");
        }
      } catch (err) {
        console.error("Gagal memuat konfigurasi Fonnte:", err);
      } finally {
        setLoadingConfig(false);
      }
    }
    loadConfig();
  }, []);

  // 2. Sinkronisasi Data Log Live dari Firestore (fonnte_logs)
  useEffect(() => {
    const logsRef = collection(db, "fonnte_logs");
    const q = query(logsRef, orderBy("timestamp", "desc"), limit(30));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: FonnteLog[] = [];
      snapshot.forEach((docSnap) => {
        list.push({
          id: docSnap.id,
          ...(docSnap.data() as Omit<FonnteLog, "id">),
        });
      });
      setLogs(list);
      setLoading(false);
    }, (error) => {
      console.error("Error reading fonnte logs: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 3. Simpan perubahan konfigurasi ke Firestore secara instan
  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      const configRef = doc(db, "sessions", "settings_fonnte");
      await setDoc(configRef, {
        apiKey: apiKey.trim(),
        targetGroup: targetGroup.trim(),
        updatedAt: Date.now()
      }, { merge: true });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Gagal menyimpan konfigurasi:", err);
      setSaveError(err.message || "Gagal menyimpan ke Firestore.");
    } finally {
      setIsSaving(false);
    }
  };

  // 4. Kirim Pesan Uji Coba Koneksi langsung
  const handleTestSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!testMessage.trim()) return;

    setIsTesting(true);
    setTestStatus(null);

    try {
      const res = await fetch("/api/test-fonnte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testMessage.trim() })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus({
          success: true,
          message: "Pesan uji coba berhasil dipicu! Silakan pantau daftar streaming log di bawah."
        });
      } else {
        setTestStatus({
          success: false,
          message: data.error || "Gagal memicu pengiriman pesan."
        });
      }
    } catch (err: any) {
      console.error("Kesalahan koneksi pengujian:", err);
      setTestStatus({
        success: false,
        message: err.message || "Kesalahan jaringan menghubungkan ke API server."
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      
      {/* SECTION 1: HEADER & DUAL MANAGEMENT PANELS (CONFIG & DIAGNOSTICS) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* PANEL A: CONFIGURATION MANAGER */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 md:p-6 shadow-md relative overflow-hidden transition duration-200">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
          
          <div className="flex items-center gap-2.5 mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-100 dark:border-blue-900">
              <Settings size={18} className="stroke-[2.2]" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">Konfigurasi Kredensial Fonnte</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                Konfigurasikan API Token & ID Group tujuan WhatsApp Anda
              </p>
            </div>
          </div>

          {loadingConfig ? (
            <div className="flex justify-center items-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            </div>
          ) : (
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block mb-1.5 pl-1">
                  Fonnte API Token (Bearer Token)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                    <Key size={14} />
                  </div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Masukkan Token Fonnte Anda..."
                    className="w-full bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 pl-10 pr-4 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block mb-1.5 pl-1">
                  Target WhatsApp Group ID / Nomor
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                    <Users size={14} />
                  </div>
                  <input
                    type="text"
                    value={targetGroup}
                    onChange={(e) => setTargetGroup(e.target.value)}
                    placeholder="Contoh: 628117882902-1623340497@g.us"
                    className="w-full bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 pl-10 pr-4 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-mono"
                    required
                  />
                </div>
                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 pl-1 line-clamp-1">
                  Untuk grup WA gunakan format ID berakhiran <code className="bg-slate-105 dark:bg-slate-900 px-1 py-0.5 rounded font-mono text-blue-500">@g.us</code>
                </p>
              </div>

              {saveError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/60 rounded-2xl text-[10px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2">
                  <AlertTriangle size={14} className="text-rose-500 flex-shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccess && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/60 rounded-2xl text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-2">
                  <CheckCheck size={14} className="text-emerald-500 flex-shrink-0" />
                  <span>Konfigurasi instan berhasil disimpan di awan (Cloud Firestore)!</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-400 py-2.5 rounded-2xl text-xs font-black tracking-wider transition uppercase cursor-pointer"
              >
                {isSaving ? "Menyimpan..." : "Simpan Konfigurasi"}
              </button>
            </form>
          )}
        </div>

        {/* PANEL B: CONNECTION DIAGNOSTICS & TEST SENDER */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 md:p-6 shadow-md relative overflow-hidden transition duration-200">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500"></div>

          <div className="flex items-center gap-2.5 mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-100 dark:border-emerald-900">
              <Send size={18} className="stroke-[2.2]" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">Alat Uji Coba Pengiriman</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                Kirim pesan pengujian instan untuk memverifikasi keaktifan perangkat Anda
              </p>
            </div>
          </div>

          <form onSubmit={handleTestSend} className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block mb-1.5 pl-1">
                Isi Pesan Uji Coba (Kustom)
              </label>
              <textarea
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Tulis pesan pengujian..."
                rows={3}
                className="w-full bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl py-2.5 px-3 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition leading-relaxed resize-none"
                required
              />
            </div>

            {testStatus && (
              <div className={`p-3 border rounded-2xl text-[10px] font-bold flex items-start gap-2.5 ${
                testStatus.success 
                  ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400"
                  : "bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/60 text-rose-700 dark:text-rose-450"
              }`}>
                {testStatus.success ? (
                  <CheckCircle size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle size={14} className="text-rose-500 flex-shrink-0 mt-0.5" />
                )}
                <span>{testStatus.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isTesting || loadingConfig}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-emerald-400 py-2.5 rounded-2xl text-xs font-black tracking-wider transition uppercase cursor-pointer flex items-center justify-center gap-1.5"
            >
              {isTesting ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  <span>Mengirim Uji Coba...</span>
                </>
              ) : (
                <>
                  <Send size={12} className="stroke-[2.5]" />
                  <span>Kirim Pesan Uji Coba</span>
                </>
              )}
            </button>
          </form>
        </div>

      </div>

      {/* SECTION 2: THE REAL-TIME DELIVERY STREAM LOGS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-md flex flex-col transition duration-200">
        
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 rounded-xl border border-sky-100 dark:border-sky-900">
              <MessageSquare size={18} className="stroke-[2.2]" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">Fonnte Delivery Stream</h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                Umpan log penyaluran & respon API WhatsApp secara real-time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">LIVE AUDIOSTREAM</span>
          </div>
        </div>

        <div className="overflow-y-auto space-y-4 pr-1 max-h-[550px] min-h-[300px]">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-emerald-500"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-20 text-slate-400 dark:text-slate-500">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Belum ada aktivitas WhatsApp.</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 font-medium leading-relaxed">
                Notifikasi otomatis & uji coba akan tercatat secara detail di sini.
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-850/80 rounded-2xl p-4 text-xs text-slate-700 dark:text-slate-350 relative overflow-hidden transition hover:border-slate-300 dark:hover:border-slate-700 shadow-sm"
              >
                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 dark:bg-blue-600"></div>
                <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-slate-400 mb-2.5 pl-1 font-black uppercase tracking-wider">
                  <div className="flex items-center gap-1.5 font-mono">
                    <PhoneCall size={10} className="text-slate-400" />
                    <span>Grup/Target: {log.target}</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono">
                    <Clock size={10} />
                    <span>{new Date(log.timestamp).toLocaleTimeString("id-ID")} WIB ({new Date(log.timestamp).toLocaleDateString("id-ID")})</span>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl text-slate-800 dark:text-slate-100 border border-slate-150 dark:border-slate-850 font-mono whitespace-pre-wrap leading-relaxed font-semibold text-xs transition">
                  {log.message}
                </div>
                
                {/* STATUS BAR WITH FAILED REASON FEEDBACK */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pl-1 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/40">
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 font-bold">
                    ID Transaksi: <span className="font-mono">{log.id}</span>
                  </div>
                  
                  <div>
                    {log.status === "SUCCESS_SENT" ? (
                      <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-extrabold bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 py-1 px-2.5 rounded-full shadow-inner tracking-wide flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        BERHASIL TERKIRIM (FONNTE OK)
                      </span>
                    ) : log.status?.startsWith("FAILED_") ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[9px] text-rose-700 dark:text-rose-450 font-extrabold bg-rose-50 dark:bg-rose-950/20 border border-rose-100/60 dark:border-rose-900/60 py-1 px-2.5 rounded-full shadow-inner tracking-wider flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                          GAGAL MENGIRIM (API ERROR)
                        </span>
                        {log.raw_response && (
                          <span className="text-[9px] font-mono text-rose-500 font-bold bg-rose-950/10 p-1.5 rounded-lg border border-rose-900/30">
                            Respon Fonnte: {JSON.stringify(log.raw_response)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[9px] text-slate-600 dark:text-slate-400 bg-slate-150 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-1 px-2.5 rounded-full font-bold">
                        {log.status || "SENT"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

      </div>

    </div>
  );
}
