import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseClient";
import { MessageSquare, Clock, User, PhoneCall } from "lucide-react";

interface FonnteLog {
  id: string;
  message: string;
  target: string;
  timestamp: number;
  status: string;
}

export default function FonnteLiveFeed() {
  const [logs, setLogs] = useState<FonnteLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const logsRef = collection(db, "fonnte_logs");
    const q = query(logsRef, orderBy("timestamp", "desc"), limit(20));

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
      console.log("Error reading logs: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-md h-full flex flex-col transition-colors duration-200">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-150 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl border border-emerald-100 dark:border-emerald-900 shadow-inner">
            <MessageSquare size={20} className="stroke-[2.2]" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 dark:text-slate-100">Live WhatsApp Fonnte Stream</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">Arus Notifikasi Real-time WhatsApp Group</p>
          </div>
        </div>
        <span className="flex h-2.5 w-2.5 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 max-h-[500px]">
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-slate-550 dark:text-slate-400">
            <p className="text-sm font-bold">Belum ada WhatsApp terkirim.</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Mulai sesi bongkaran KA untuk memicu Fonnte API!</p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850/80 rounded-2xl p-4 text-xs md:text-sm text-slate-700 dark:text-slate-350 relative overflow-hidden transition hover:border-slate-350 dark:hover:border-slate-750"
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-2 pl-1.5 font-extrabold uppercase">
                <div className="flex items-center gap-1">
                  <PhoneCall size={10} className="text-emerald-500" />
                  <span>Target WA: {log.target}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={10} />
                  <span>{new Date(log.timestamp).toLocaleTimeString("id-ID")}</span>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl text-slate-850 dark:text-slate-100 border border-slate-200/50 dark:border-slate-800 font-mono whitespace-pre-wrap leading-relaxed shadow-sm font-semibold text-xs">
                {log.message}
              </div>
              <div className="mt-2.5 flex items-center justify-end">
                {log.status === "SUCCESS_SENT" ? (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-extrabold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 py-1 px-3 rounded-full shadow-sm">
                    ✓ TERKIRIM KE GROUP (API OK)
                  </span>
                ) : log.status === "SUCCESS_SIMULATED" || log.status === "SUCCESS" || log.status === "SENT_COMPLETED" ? (
                  <span className="text-[10px] text-sky-700 dark:text-sky-400 font-extrabold bg-sky-50 dark:bg-sky-950/40 border border-sky-105 dark:border-sky-900 py-1 px-3 rounded-full shadow-sm">
                    ✓ BERHASIL SENT
                  </span>
                ) : log.status?.startsWith("FAILED_") ? (
                  <span className="text-[10px] text-rose-700 dark:text-rose-400 font-extrabold bg-rose-50 dark:bg-rose-950/40 border border-rose-105 dark:border-rose-900 py-1 px-3 rounded-full shadow-sm" title={log.status}>
                    ⚠ GAGAL (API ERROR): {log.status.replace("FAILED_API_", "").replace("FAILED_ERROR_", "")}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-150 dark:bg-slate-800 py-1 px-3 rounded-full font-bold">
                    {log.status || "SENT"}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
