import { UiAgentError } from "./errors.js";

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UiAgentError("ABORTED", "Operation cancelled.");
}

export function deadlineSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new UiAgentError("TIMEOUT", `Operation exceeded ${timeoutMs} ms.`)), timeoutMs);
  timer.unref?.();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }, { once: true });
  return controller.signal;
}

export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const signal = deadlineSignal(timeoutMs, parent);
  try {
    return await operation(signal);
  } catch (error) {
    if (signal.aborted && !parent?.aborted) {
      throw new UiAgentError("TIMEOUT", `Operation exceeded ${timeoutMs} ms.`, { cause: error });
    }
    throw error;
  }
}
