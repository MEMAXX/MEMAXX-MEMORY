/**
 * Shared structured logger for MEMAXX Memory.
 *
 * Usage:
 *   import { log } from "./log.mjs";
 *   log.info({ component: "remote", ptyId }, "producer connected");
 *   log.error({ err, component: "embeddings" }, "embedding failed");
 *
 * Design notes:
 *   - Pretty-prints to stderr in dev (LOG_LEVEL=info default)
 *   - JSON output in production for log aggregation
 *   - `err` field is automatically serialized with stack trace
 *   - Always pass structured context objects BEFORE the message string
 */

import pino from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL || "info";

export const log = pino({
  level,
  base: { app: "memaxx-memory", pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport: !isProd
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,app",
          singleLine: false,
        },
      }
    : undefined,
});

/**
 * Create a child logger bound to a component name.
 * Every log line automatically includes { component: "<name>" }.
 *
 * Example:
 *   const rlog = childLog("remote");
 *   rlog.info({ ptyId }, "broadcasting");
 */
export function childLog(component) {
  return log.child({ component });
}
