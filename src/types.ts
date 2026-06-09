/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WhatsAppConfig {
  webhookUrl: string;
  token: string;
  groupId: string;
  enabled: boolean;
}

export interface ApiLog {
  id: string;
  timestamp: string;
  endpoint: string;
  type: 'START' | 'BREACH' | 'FINISH' | 'TEST';
  payload: any;
  status: 'SUCCESS' | 'ERROR';
  response: any;
}

export interface SessionHistoryItem {
  id: string;
  trainsetId: string;
  startTime: string;
  endTime: string;
  actualDurationMinutes: number;
  targetMinutes: number;
  containersUnloaded: number;
  targetVolume: number;
  status: 'ON_TIME' | 'OVERTIME';
  whatsappLog: {
    startSent: boolean;
    breachSent: boolean;
    finishSent: boolean;
  };
}
