export type SessionStatus = "INIT" | "RUNNING" | "PAUSED" | "COMPLETED";

export interface DelayLog {
  timestamp: number; // UTC timestamp dalam detik ketika delay atau resume dicatat
  type: "PAUSE" | "RESUME";
  reason?: string; // Alasan delay, misal: "Pergantian Shift", "Kendala Cuaca", dll.
  duration_seconds?: number; // dihitung saat resume
}

export interface SessionFlags {
  notif_start: boolean;
  notif_60m: boolean;
  notif_100m: boolean;
  notif_120m: boolean;
  notif_180m: boolean;
}

export interface UnloadingSession {
  session_id: string; // ID sesi unik, misal: WBS_20260619_01
  train_number: string; // Nomor rangkaian KA, misal: 3550
  checker_name: string; // Nama Checker lapangan
  groupleader_name: string; // Nama Pengawas / Group Leader
  status: SessionStatus; // Status sesi operasional
  total_containers: number; // Target total, default 122
  unloaded_containers: number; // Jumlah kontainer yang sudah dibongkar
  start_timestamp: number; // Epoch timestamp dalam detik saat mulai
  last_paused_timestamp?: number | null; // Timestamp terakhir di-pause (dalam detik)
  net_duration_seconds: number; // Waktu bongkar bersih (murni)
  gross_duration_seconds: number; // Total durasi kotor (termasuk delay)
  flags: SessionFlags; // Idempotency flags untuk anti-spam WhatsApp
  last_overtime_notif: number | null; // Timestamp terakhir peringatan overtime dikirim (detik)
  logs: DelayLog[]; // Histori catatan hambatan (pause/resume)
  created_at: number; // Epoch timestamp ketika dokumen dibuat
}

export interface FonnteConfig {
  apiKey: string;
  targetGroup: string;
}
