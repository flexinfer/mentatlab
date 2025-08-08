import { Registry, collectDefaultMetrics, Histogram } from "prom-client";
import type { Request, Response, NextFunction } from "express";

/**
 * Custom Registry so we can expose default + custom metrics on /metrics
 */
export const register = new Registry();

/**
 * Histogram to measure HTTP request durations with labels method, route, status_code
 */
export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register],
  // sensible default buckets in seconds
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

/**
 * Initialize collection of default Node/process metrics on the custom registry.
 * Call once during startup.
 */
export function initDefaultMetrics(): void {
  collectDefaultMetrics({ register });
}

/**
 * Express middleware that measures request duration and records into the histogram.
 * Uses req.route?.path when available, otherwise falls back to req.path.
 */
export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime();
    res.on("finish", () => {
      const diff = process.hrtime(start);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      const route = req.route?.path ?? req.path;
      // ensure labels are strings
      httpRequestDurationSeconds
        .labels(req.method, route, String(res.statusCode))
        .observe(durationSeconds);
    });
    next();
  };
}