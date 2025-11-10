import type { Analysis } from '@teensy-mem-explorer/analyzer';

export type ServerLifecycleState = 'idle' | 'watching' | 'running' | 'error';

export interface ServerStatusPayload {
  state: ServerLifecycleState;
  lastRunStartedAt?: string;
  lastRunCompletedAt?: string;
  errorMessage?: string;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  port: number;
  state: ServerStatusPayload;
  latestAnalysisGeneratedAt?: string;
}

export interface ServerConfig {
  targetId?: string;
  elfPath?: string;
  mapPath?: string;
  toolchainDir?: string;
  toolchainPrefix?: string;
  debounceMs?: number;
  autoRun?: boolean;
}

export interface AnalysisBroadcastPayload {
  analysis: Analysis;
  generatedAt: string;
}

export type ServerMessage =
  | { type: 'status'; payload: ServerStatusPayload }
  | { type: 'hello'; payload: { message: string } }
  | { type: 'config'; payload: ServerConfig }
  | { type: 'analysis'; payload: AnalysisBroadcastPayload };
