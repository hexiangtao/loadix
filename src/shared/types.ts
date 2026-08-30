/** Shared types used by both the dashboard UI and the load-testing engine. */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type ContentType = 'application/json' | 'application/x-www-form-urlencoded' | 'text/plain';

export type AssertionType = 'status' | 'latency' | 'contains';

export interface Assertion {
  type: AssertionType;
  value: string;
}

export interface TestConfig {
  method: HttpMethod;
  url: string;
  timeout: number;
  headers: [string, string][];
  body: string;
  contentType: ContentType;
  /** Load model kind. */
  loadModel: 'constant' | 'ramp' | 'step' | 'spike' | 'soak';
  users: number;
  rps: number;
  duration: number;
  ramp: number;
  /** Step load: users added per step. */
  stepUsers: number;
  /** Step load: seconds per step. */
  stepDuration: number;
  /** Spike: peak users during the spike. */
  spikeUsers: number;
  /** Spike: spike length in seconds. */
  spikeDuration: number;
  /** Auto-stop when error rate exceeds this % (0 = disabled). */
  maxErrorRate: number;
  /** Auto-stop when P95 exceeds this ms (0 = disabled). */
  maxP95: number;
  assertions: Assertion[];
  variables: [string, string][];
}

export interface RequestResult {
  status: number;
  ms: number;
  body: string;
  ok: boolean;
  error: string;
  pass: boolean;
  ts: number;
  failures?: Assertion[];
}

export interface MetricsSnapshot {
  requests: number;
  success: number;
  errors: number;
  rps: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  successRate: number;
  statusBreakdown: Record<string, number>;
  recent: RequestResult[];
  throughput: number[];
  latencySeries: number[];
  assertionFailures: Record<string, number>;
  slowest: RequestResult[];
}

export type EngineState = 'idle' | 'running' | 'finished' | 'aborted';

/** Messages sent from the dashboard to the background engine. */
export type EngineCommand =
  | { type: 'START'; config: TestConfig }
  | { type: 'STOP' }
  | { type: 'GET_STATE' };

/** Messages pushed from the background engine to the dashboard. */
export type EngineEvent =
  | { type: 'STATE'; state: EngineState; message?: string }
  | { type: 'METRICS'; metrics: MetricsSnapshot };
