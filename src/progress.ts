import { stream } from "./llm.js";
import type { Report } from "./loop.js";
import type { Event } from "./store.js";

const round = (e: Omit<Event, "t">) => (e.round === undefined ? "" : ` (round ${e.round})`);
const line = (e: Omit<Event, "t">) => e.step === "start" ? `… ${e.note}${round(e)}`
  : `${e.ok ? "✓" : "✗"} ${e.step}${e.section ? ` ${e.section}` : ""}${round(e)}${e.note ? ` — ${e.note.split("\n")[0]!.slice(0, 100)}` : ""}`;
const clock = (ms: number) => `${Math.floor(ms / 60_000)}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;

/** The tool's live view: the last 8 progress lines plus a status line repainted every 5 s, so a long model call visibly ticks and a silent model server is called out. */
export function liveView(update: (text: string) => void) {
  const lines: string[] = [];
  let since = Date.now();
  const show = () => {
    const now = Date.now(), quiet = now - Math.max(stream.last, since);
    const why = now - stream.last < 10_000 ? " · the model is writing"
      : quiet > 180_000 ? ` · no model output for ${clock(quiet)}: the model server is busy (another session?) or loading a model; this run carries on when it answers` : "";
    update([...lines.slice(-8), `⏳ ${clock(now - since)} since the last update${why}`].join("\n"));
  };
  const timer = setInterval(show, 5_000);
  return {
    add(e: Omit<Event, "t">) {
      lines.push(line(e));
      since = Date.now();
      show();
    },
    stop: () => clearInterval(timer),
  };
}

export const summary = (r: Report) => [
  `Preview: ${r.previewUrl}`,
  ...Object.entries(r.sections).map(([id, s]) => `- ${id}: ${s.status}${s.score === undefined ? "" : ` (${s.score}/10)`}${s.open[0] ? ` — ${s.open[0]}` : ""}`),
  ...(r.app.length ? [`Page-level: ${r.app.join("; ")}`] : []),
  `${r.usage.calls} model calls, ${r.usage.tokensIn + r.usage.tokensOut} tokens, ${r.usage.seconds}s. Details in .ui/.`,
].join("\n");
