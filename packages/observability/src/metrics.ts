export type MetricTags = Record<string, string>;

/** Metrics sink. A real backend (OpenTelemetry, a hosted APM) is chosen in the deployment phase. */
export interface Metrics {
  increment(name: string, value?: number, tags?: MetricTags): void;
  timing(name: string, milliseconds: number, tags?: MetricTags): void;
}

export const noopMetrics: Metrics = {
  increment: () => undefined,
  timing: () => undefined,
};
