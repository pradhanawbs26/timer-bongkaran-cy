import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseClient";
import { 
  MessageSquare, 
  Clock, 
  PhoneCall, 
  CheckCircle, 
  XCircle 
} from "lucide-react";

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

  // Sinkronisasi Data Log Live dari Firestore
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

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-md shadow-slate-100 dark:shadow-none flex flex-col transition-colors duration-200">
      
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-450 rounded-2xl border border-sky-100 dark:border-sky-900 shadow-inner">
            <MessageSquare size={18} className="stroke-[2.2]" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">Fonnte Delivery Stream</h3>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
              Umpan log pengiriman notifikasi grup secara real-time
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[10px] font-bold text-slate-450 dark:text-slate-500">LIVE COUPLING</span>
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
              Notifikasi baru akan tercatat di sini secara otomatis setiap kali status bongkaran diperbarui.
            </p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-850/80 rounded-2xl p-4 text-xs text-slate-700 dark:text-slate-350 relative overflow-hidden transition hover:border-slate-300 dark:hover:border-slate-700 shadow-sm"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-300 dark:bg-slate-800"></div>
              <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-slate-400 mb-2 pl-1 font-black uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <PhoneCall size={10} className="text-slate-400" />
                  <span>Grup: {log.target}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={10} />
                  <span>{new Date(log.timestamp).toLocaleTimeString("id-ID")}</span>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl text-slate-800 dark:text-slate-100 border border-slate-150 dark:border-slate-850 font-mono whitespace-pre-wrap leading-relaxed font-semibold text-xs transition">
                {log.message}
              </div>
              <div className="mt-2.5 flex items-center justify-end pl-1">
                {log.status === "SUCCESS_SENT" ? (
                  <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-extrabold bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 py-1 px-2.5 rounded-full shadow-inner tracking-wide flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    TERKIRIM KE WHATSAPP (API OK)
                  </span>
                ) : log.status?.startsWith("FAILED_") ? (
                  <span className="text-[9px] text-rose-700 dark:text-rose-450 font-extrabold bg-rose-50 dark:bg-rose-950/20 border border-rose-100/60 dark:border-rose-900/60 py-1 px-2.5 rounded-full shadow-inner tracking-wider flex items-center gap-1" title={log.status}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                    GAGAL (API ERROR): {log.status.replace("FAILED_API_", "").replace("FAILED_ERROR_", "").replace("FAILED_JSON_POST_API_", "").replace("FAILED_URL_ENCODED_POST_API_","").replace("FAILED_GET_REQUEST_API_","").replace("FAILED_JSON_POST_ERR_","").replace("FAILED_URL_ENCODED_POST_ERR_","").replace("FAILED_GET_REQUEST_ERR_","")}
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-600 dark:text-slate-400 bg-slate-150 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-1 px-2.5 rounded-full font-bold">
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
