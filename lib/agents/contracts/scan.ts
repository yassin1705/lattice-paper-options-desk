export type ScanTimeframe = '1Day' | '1Hour' | '15Min';

export type ScanDescriptor = {
  scanId: string;
  scheduledAt: string;
  startedAt: string;
  validUntil: string;
  timeframe: ScanTimeframe;
  lookbackBars: number;
};

export type ScanScheduleConfig = {
  timeframe: ScanTimeframe;
  lookbackBars: number;
  frequencyMinutes: number;
  delayAfterIntervalMinutes: number;
  maximumLatenessMinutes: number;
  signalTtlMinutes: number;
};

export const defaultScanScheduleConfig: ScanScheduleConfig = {
  timeframe: '1Hour',
  lookbackBars: 100,
  frequencyMinutes: 60,
  delayAfterIntervalMinutes: 2,
  maximumLatenessMinutes: 5,
  signalTtlMinutes: 55,
};
