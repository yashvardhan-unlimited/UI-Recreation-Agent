import pc from "picocolors";
import { redact } from "./errors.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  event(kind: string, message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(redact(message)),
  warn: (message) => console.warn(pc.yellow(redact(message))),
  error: (message) => console.error(pc.red(redact(message))),
  event: (kind, message) => console.log(`${pc.cyan(`[${kind}]`)} ${redact(message)}`)
};
