import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import runsRouter from "./routes/runs";
import { requestIdMiddleware, requestLoggerMiddleware } from "./observability/logger";
import { initDefaultMetrics, metricsMiddleware, register } from "./observability/metrics";

initDefaultMetrics();

const app = express();

// ---- CORS configuration (conditional) ----
const rawCorsOrigins = process.env.CORS_ORIGINS;
let corsOptions: cors.CorsOptions | undefined;

const defaultAllowedHeaders = [
  "Content-Type",
  "Accept",
  "Origin",
  "X-Requested-With",
  "Authorization",
  "x-api-key"
];

if (typeof rawCorsOrigins === "string" && rawCorsOrigins.trim() !== "") {
  const allowed = new Set(
    rawCorsOrigins
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
  );

  corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow non-browser (e.g., curl, server-to-server) requests that don't set Origin
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    allowedHeaders: defaultAllowedHeaders,
    credentials: false
  };
} else {
  // Backwards compatible: permissive CORS
  corsOptions = {
    origin: true,
    allowedHeaders: defaultAllowedHeaders,
    credentials: false
  };
}

app.use(cors(corsOptions));
app.use(express.json());

app.use(requestIdMiddleware());
app.use(requestLoggerMiddleware());
app.use(metricsMiddleware());

// ---- Auth middleware (optional, enabled only when ORCHESTRATOR_API_KEY is set) ----
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY ? process.env.ORCHESTRATOR_API_KEY.trim() : "";

const isExemptPath = (req: Request): boolean => {
  if (req.method === "OPTIONS") return true;
  if (req.method === "GET") {
    const p = req.path;
    if (p === "/health" || p === "/ready" || p === "/metrics") return true;
  }
  return false;
};

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!ORCHESTRATOR_API_KEY) {
    // No API key configured -> keep behavior unchanged
    return next();
  }

  if (isExemptPath(req)) return next();

  const authHeader = req.header("authorization");
  let bearerToken: string | undefined;
  if (authHeader && typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    bearerToken = authHeader.substring(7).trim();
  }

  const apiKeyHeader = req.header("x-api-key");

  if (bearerToken === ORCHESTRATOR_API_KEY || apiKeyHeader === ORCHESTRATOR_API_KEY) {
    return next();
  }

  // Unauthorized response shape required by spec
  res.status(401).json({ error: "unauthorized" });
};

// ---- Rate limiter (in-memory, simple sliding window) ----
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000) || 60000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120) || 120;

type TimestampArray = number[];
const rateStore = new Map<string, TimestampArray>();

const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (isExemptPath(req)) return next();

  // Identify key: prefer api key if present in request, else client IP
  const authHeader = req.header("authorization");
  let bearerToken: string | undefined;
  if (authHeader && typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    bearerToken = authHeader.substring(7).trim();
  }
  const apiKeyHeader = req.header("x-api-key");

  const identityKey = bearerToken ?? apiKeyHeader ?? req.ip;

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = rateStore.get(identityKey) ?? [];
  // Prune old entries (keep ascending order: we'll push new timestamps at end)
  let validStartIndex = 0;
  while (validStartIndex < timestamps.length && timestamps[validStartIndex] <= windowStart) {
    validStartIndex++;
  }
  if (validStartIndex > 0) {
    // slice to keep only recent timestamps
    const pruned = timestamps.slice(validStartIndex);
    rateStore.set(identityKey, pruned);
    // use pruned array for further checks
    const current = pruned.length;
    if (current >= RATE_LIMIT_MAX) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    pruned.push(now);
    return next();
  } else {
    // no pruning needed
    if (timestamps.length >= RATE_LIMIT_MAX) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    timestamps.push(now);
    rateStore.set(identityKey, timestamps);
    return next();
  }
};

// Register auth and rate limit middlewares in the requested order
app.use(authMiddleware);
app.use(rateLimitMiddleware);

app.get("/ready", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  const body = await register.metrics();
  res.send(body);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "orchestrator" });
});

app.use("/runs", runsRouter);

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 7070;
if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`orchestrator listening on http://localhost:${port}`);
  });
}
export default app;