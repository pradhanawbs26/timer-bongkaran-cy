import { useState, useEffect, FormEvent } from "react";
import { Train, User, ShieldAlert, Play, AlertCircle } from "lucide-react";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebaseClient";

interface InitializeSessionProps {
  onStart: (trainNo: string, checker: string, gl: string, sessionId: string) => Promise<boolean>;
}

export default function InitializeSession({ onStart }: InitializeSessionProps) {
  const [trainNumber, setTrainNumber] = useState("");
  const [checkerName, setCheckerName] = useState("");
  const [groupLeaderName, setGroupLeaderName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // States for dynamic suggestions based on historical data
  const [trainSuggestions, setTrainSuggestions] = useState<string[]>([]);
  const [checkerSuggestions, setCheckerSuggestions] = useState<string[]>([]);
  const [glSuggestions, setGlSuggestions] = useState<string[]>([]);

  // Fetch unique and frequent values from past sessions
  useEffect(() => {
    async function fetchHistoricalSuggestions() {
      try {
        const sessionsRef = collection(db, "sessions");
        const q = query(sessionsRef, orderBy("created_at", "desc"), limit(100));
        const querySnapshot = await getDocs(q);
        
        const trainsMap: { [key: string]: number } = {};
        const checkersMap: { [key: string]: number } = {};
        const glsMap: { [key: string]: number } = {};

        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data) {
            const train = data.train_number;
            const checker = data.checker_name;
            const gl = data.groupleader_name;

            if (train) {
              const cleanedTrain = train.replace(/^KA-/, "");
              trainsMap[cleanedTrain] = (trainsMap[cleanedTrain] || 0) + 1;
            }
            if (checker) {
              checkersMap[checker] = (checkersMap[checker] || 0) + 1;
            }
            if (gl) {
              glsMap[gl] = (glsMap[gl] || 0) + 1;
            }
          }
        });

        // Sort by frequency (most frequent first) and take top 6
        const sortedTrains = Object.keys(trainsMap).sort((a, b) => trainsMap[b] - trainsMap[a]).slice(0, 6);
        const sortedCheckers = Object.keys(checkersMap).sort((a, b) => checkersMap[b] - checkersMap[a]).slice(0, 6);
        const sortedGls = Object.keys(glsMap).sort((a, b) => glsMap[b] - glsMap[a]).slice(0, 6);

        setTrainSuggestions(sortedTrains);
        setCheckerSuggestions(sortedCheckers);
        setGlSuggestions(sortedGls);
      } catch (err) {
        console.error("Gagal mengambil data histori masukan:", err);
      }
    }
    fetchHistoricalSuggestions();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trainNumber.trim()) {
      setErrorMessage("Nomor rangkaian KA harus diisi!");
      return;
    }
    if (!checkerName.trim()) {
      setErrorMessage("Nama Checker lapangan harus diisi!");
      return;
    }
    if (!groupLeaderName.trim()) {
      setErrorMessage("Nama Pengawas (Group Leader) harus diisi!");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    // Bikin Session ID format: WBS_YYYYMMDD_TIME
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const generatedSessionId = `WBS_${dateStr}_${timeStr}`;

    try {
      let formattedTrainNumber = trainNumber.trim();
      if (!formattedTrainNumber.toUpperCase().startsWith("KA-")) {
        formattedTrainNumber = `KA-${formattedTrainNumber}`;
      }

      const success = await onStart(
        generatedSessionId,
        formattedTrainNumber,
        checkerName.trim(),
        groupLeaderName.trim()
      );

      if (success) {
        // Pemicu langsung WhatsApp status mulai secara instant dan real-time
        fetch(`/api/sessions/${generatedSessionId}/start-notif`, {
          method: "POST"
        })
        .then(async (res) => {
          if (!res.ok) throw new Error(`API returned ${res.status}`);
        })
        .catch((err) => {
          console.warn("Gagal mengirim notif mulai via API:", err);
        });
      } else {
        setErrorMessage("Gagal menginisialisasi sesi di cloud database.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Terjadi kesalahan tidak terduga.");
    } finally {
      setSubmitting(false);
    }
  };

  // Form validity check for safety
  const isFormValid = trainNumber.trim() !== "" && checkerName.trim() !== "" && groupLeaderName.trim() !== "";

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 md:p-8 max-w-lg mx-auto shadow-md relative overflow-hidden transition-colors duration-200">
      {/* Decorative glossy accent strip */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-400 via-blue-500 to-indigo-500" />

      <div className="text-center mb-6 pt-2">
        <div className="mx-auto w-12 h-12 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mb-3.5 border border-blue-100 dark:border-blue-900 shadow-inner">
          <Train size={24} className="stroke-[2.2]" />
        </div>
        <h2 className="text-xl font-black text-slate-905 dark:text-slate-100 tracking-tight">Form Bongkaran KA</h2>
        <p className="text-xs text-slate-650 dark:text-slate-400 mt-1.5 font-semibold leading-relaxed">
          Pastikan semua identitas & nomor KA diisi lengkap sebelum memulai perekaman timer.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-5 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 text-rose-700 dark:text-rose-400 p-4 rounded-xl text-xs flex items-start gap-2.5">
          <ShieldAlert size={16} className="text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-bold">
            <p>{errorMessage}</p>
            {errorMessage.includes("permission") && (
              <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-500 leading-relaxed font-semibold">
                Tip: Pastikan Anda telah mengonfigurasi Security Rules Firestore dengan benar di Firebase Console agar transaksi diizinkan.
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Input No KA */}
        <div className="space-y-2">
          <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-350 uppercase tracking-wider flex items-center gap-1">
            <span>Nomor Rangkaian KA</span>
            <span className="text-rose-500 font-bold">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-450 dark:text-slate-500">
              <Train size={16} />
            </span>
            <input
              type="text"
              placeholder="Contoh: 3550"
              value={trainNumber}
              onChange={(e) => setTrainNumber(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 dark:focus:border-blue-600 focus:ring-1 focus:ring-blue-500/10 rounded-2xl py-3 pl-10 pr-4 text-slate-800 dark:text-slate-100 text-sm outline-none transition"
              required
            />
          </div>
          {/* Quick suggestions */}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {trainSuggestions.map((train) => (
              <button
                key={train}
                type="button"
                onClick={() => setTrainNumber(train)}
                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-[11px] text-slate-700 dark:text-slate-300 font-extrabold py-1 px-2.5 rounded-lg border border-slate-200/40 dark:border-slate-700/80 transition cursor-pointer"
              >
                {train}
              </button>
            ))}
          </div>
        </div>

        {/* Checker Field */}
        <div className="space-y-2">
          <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-350 uppercase tracking-wider flex items-center gap-1">
            <span>Nama Checker Lapangan</span>
            <span className="text-rose-500 font-bold">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-450 dark:text-slate-500">
              <User size={16} />
            </span>
            <input
              type="text"
              placeholder="Masukkan Nama Checker"
              value={checkerName}
              onChange={(e) => setCheckerName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 dark:focus:border-blue-600 focus:ring-1 focus:ring-blue-500/10 rounded-2xl py-3 pl-10 pr-4 text-slate-800 dark:text-slate-100 text-sm outline-none transition"
              required
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {checkerSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setCheckerName(name)}
                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-[11px] text-slate-700 dark:text-slate-300 font-extrabold py-1 px-2.5 rounded-lg border border-slate-200/40 dark:border-slate-700/80 transition cursor-pointer"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Group Leader / Pengawas Field */}
        <div className="space-y-2">
          <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-350 uppercase tracking-wider flex items-center gap-1">
            <span>Pengawas / Group Leader (GL)</span>
            <span className="text-rose-500 font-bold">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-455 dark:text-slate-500">
              <User size={16} />
            </span>
            <input
              type="text"
              placeholder="Masukkan Nama Group Leader"
              value={groupLeaderName}
              onChange={(e) => setGroupLeaderName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 dark:focus:border-blue-600 focus:ring-1 focus:ring-blue-500/10 rounded-2xl py-3 pl-10 pr-4 text-slate-800 dark:text-slate-100 text-sm outline-none transition"
              required
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {glSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setGroupLeaderName(name)}
                className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-755 text-[11px] text-slate-700 dark:text-slate-300 font-extrabold py-1 px-2.5 rounded-lg border border-slate-200/40 dark:border-slate-700/80 transition cursor-pointer"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Start Button */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 mt-6">
          <button
            type="submit"
            disabled={submitting || !isFormValid}
            className="w-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-450 dark:disabled:text-slate-600 text-white font-extrabold tracking-wide rounded-2xl py-4 flex items-center justify-center gap-2 shadow-sm transition duration-200 cursor-pointer text-sm"
          >
            {submitting ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
              <>
                <Play size={16} fill="currentColor" className="stroke-none" />
                <span>START BONGKARAN</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
