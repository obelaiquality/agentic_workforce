/**
 * Structured logger — replaces raw console.log/error/warn across the server.
 *
 * Usage:
 *   import { createLogger } from "../logger";
 *   const log = createLogger("MCP");
 *   log.info("Connected to server", serverId);
 */

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(module: string): Logger {
  const tag = `[${module}]`;
  return {
    info(...args: unknown[]) {
      console.log(timestamp(), tag, ...args);
    },
    warn(...args: unknown[]) {
      console.warn(timestamp(), tag, ...args);
    },
    error(...args: unknown[]) {
      console.error(timestamp(), tag, ...args);
    },
    debug(...args: unknown[]) {
      if (process.env.DEBUG) {
        console.debug(timestamp(), tag, ...args);
      }
    },
  };
}
