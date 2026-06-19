import { useState, useEffect } from "react";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import { db } from "../firebaseClient";
import { UnloadingSession } from "../types";
import { FileSpreadsheet, Hourglass, Calendar, User, TrendingUp } from "lucide-react";

export default function HistoryLogs() {
  const [completedSessions, setCompletedSessions] = useState<UnloadingSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "sessions"), orderBy("created_at", "desc"));
      const snapshot = await getDocs(q);
      const list: UnloadingSession[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as UnloadingSession);
      });
      setCompletedSessions(list);
    } catch (err) {
      console.error("Gagal mendapatkan histori: ", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const formatSecsToMins = (secs: number) => {
    return `${Math.floor(secs / 60)} Menit`;
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-md h-full flex flex-col space-y-6 transition-colors duration-200">
      <div className="flex items-center justify-between pb-3 border-b border-slate-150 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-100 dark:border-indigo-900 shadow-inner">
            <FileSpreadsheet size={20} className="stroke-[2.2]" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 dark:text-slate-100">Log Histori Bongkaran KA</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">Rekapitulasi performa & log keterlambatan KA</p>
          </div>
        </div>
        
        <button
          onClick={fetchHistory}
          className="text-xs bg-slate-100 hover:bg-slate-200 active:bg-slate-350 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-350 text-slate-705 font-bold px-3.5 py-2 rounded-xl border border-slate-200/50 dark:border-slate-700 transition cursor-pointer"
        >
          Muat Ulang
        </button>
      </div>

      <div className="overflow-y-auto max-h-[550px] space-y-4 pr-1">
        {loading ? (
          <div className="flex justify-center items-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
          </div>
        ) : completedSessions.length === 0 ? (
          <div className="text-center py-16 text-slate-550 dark:text-slate-400">
            <p className="text-sm font-bold">Belum ada history sesi tercatat.</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Selesaikan satu sesi untuk melihat statistik performa di sini.</p>
          </div>
        ) : (
          completedSessions.map((sess) => {
            const totalDelaySeconds = sess.gross_duration_seconds - sess.net_duration_seconds;
            
            // Hitung rincian delay
            const reasonBreakdown: { [key: string]: number } = {};
            const logs = sess.logs || [];
            for (let i = 0; i < logs.length; i++) {
              if (logs[i].type === "PAUSE" && logs[i].reason) {
                const reason = logs[i].reason!;
                const resumeLog = logs.slice(i).find((l) => l.type === "RESUME");
                // Cari durasi pada log berikutnya yang bertipe RESUME
                const duration = resumeLog?.duration_seconds || 0;
                reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + Math.floor(duration / 60);
              }
            }

            const detailString = Object.entries(reasonBreakdown)
              .map(([reason, minutes]) => `${reason} (${minutes} mnt)`)
              .join(", ");

            return (
              <div 
                key={sess.session_id} 
                className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-2xl p-4 space-y-3.5 transition duration-200 hover:border-slate-350 dark:hover:border-slate-750"
              >
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-300 font-mono font-extrabold px-2 py-0.5 rounded-lg mr-2 shadow-sm">
                      {sess.session_id}
                    </span>
                    <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                      sess.status === "COMPLETED" 
                        ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-120 dark:border-indigo-900" 
                        : sess.status === "PAUSED"
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-120 dark:border-amber-900 animate-pulse"
                        : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-120 dark:border-emerald-900"
                    }`}>
                      {sess.status}
                    </span>
                    <h4 className="text-md font-black text-slate-850 dark:text-slate-100 mt-2 flex items-center gap-1.5">
                      <span>Rangkaian {sess.train_number}</span>
                    </h4>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider">TGL MULAI</p>
                    <p className="text-xs text-slate-700 dark:text-slate-300 font-extrabold mt-0.5">{new Date(sess.start_timestamp * 1000).toLocaleString("id-ID", { hour12: false })}</p>
                  </div>
                </div>

                {/* Grid Analisis Key-Value */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200/60 dark:border-slate-800 text-center shadow-sm">
                  <div>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-black mb-0.5 uppercase">TERBONGKAR</span>
                    <span className="block text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400">{sess.unloaded_containers} / {sess.total_containers}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-black mb-0.5 uppercase">NET (MURNI)</span>
                    <span className="block text-xs sm:text-sm font-black text-slate-800 dark:text-slate-200 font-mono">{formatSecsToMins(sess.net_duration_seconds)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-black mb-0.5 uppercase">GROSS (TOTAL)</span>
                    <span className="block text-xs sm:text-sm font-black text-slate-600 dark:text-slate-300 font-mono">{formatSecsToMins(sess.gross_duration_seconds)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-black mb-0.5 uppercase">TOTAL DELAY</span>
                    <span className="block text-xs sm:text-sm font-black text-amber-600 dark:text-amber-400 font-mono">{formatSecsToMins(totalDelaySeconds > 0 ? totalDelaySeconds : 0)}</span>
                  </div>
                </div>

                {/* Rincian Hambatan */}
                <div className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase mb-1">
                    <Hourglass size={12} className="text-amber-500" />
                    <span>Rincian Catatan Delay :</span>
                  </div>
                  {detailString ? (
                    <p className="text-slate-800 dark:text-slate-200 font-extrabold leading-relaxed">{detailString}</p>
                  ) : (
                    <p className="text-slate-400 dark:text-slate-500 italic">Bersih • Tidak terdeteksi delay operasional.</p>
                  )}
                </div>

                {/* Detail PIC */}
                <div className="flex gap-4 text-[11px] text-slate-500 pt-1 flex-wrap justify-between border-t border-slate-100 dark:border-slate-850">
                  <div className="flex items-center gap-1 font-extrabold text-slate-500 dark:text-slate-400">
                    <User size={12} className="text-slate-400" />
                    <span>Checker: <strong className="text-slate-750 dark:text-slate-300 font-bold">{sess.checker_name}</strong></span>
                  </div>
                  <div className="flex items-center gap-1 font-extrabold text-slate-500 dark:text-slate-400">
                    <User size={12} className="text-slate-400" />
                    <span>Group Leader: <strong className="text-slate-755 dark:text-slate-300 font-bold">{sess.groupleader_name}</strong></span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
