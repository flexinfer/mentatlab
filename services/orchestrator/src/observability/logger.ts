import pino from "pino";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";

/**
 * Structured JSON logger (pino)
 */
export const logger = pino();

/**
 * Middleware to ensure each request has an X-Request-Id.
 * Stores the id on res.locals.requestId and sets response header.
 */
export function requestIdMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    const incoming = (_req.header("x-request-id") ?? "") as string;
    const id = incoming.trim() !== "" ? incoming : nanoid(12);
    res.locals.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}

/**
 * Middleware that logs at start and finish of each request.
 * Uses res.locals.requestId for id.
 */
export function requestLoggerMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = (res.locals.requestId as string) ?? (req.header("x-request-id") as string) ?? nanoid(12);

    // Start log
    logger.info({ msg: "req", id, method: req.method, path: req.path });

    const start = process.hrtime();
    res.on("finish", () => {
      const diff = process.hrtime(start);
      const durationMs = Math.round(diff[0] * 1000 + diff[1] / 1e6);
      logger.info({
        msg: "res",
        id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: durationMs
      });
    });

    next();
  };
}