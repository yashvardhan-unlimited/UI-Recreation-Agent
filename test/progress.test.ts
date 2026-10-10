import { afterEach, expect, it, vi } from "vitest";
import { stream } from "../src/llm.js";
import { liveView } from "../src/progress.js";

afterEach(() => vi.useRealTimers());

it("shows what started, ticks every 5 s, tells a writing model from a silent server, and stops", () => {
  vi.useFakeTimers({ now: 1_000_000 });
  stream.last = 0;
  const shown: string[] = [];
  const view = liveView((text) => shown.push(text));
  view.add({ step: "start", ms: 0, ok: true, note: "planning the site" });
  expect(shown.at(-1)).toBe("… planning the site\n⏳ 0m 00s since the last update");
  vi.advanceTimersByTime(5_000);
  expect(shown.at(-1)).toBe("… planning the site\n⏳ 0m 05s since the last update");
  stream.last = Date.now();
  vi.advanceTimersByTime(5_000);
  expect(shown.at(-1)).toMatch(/0m 10s since the last update · the model is writing$/);
  vi.advanceTimersByTime(185_000);
  expect(shown.at(-1)).toMatch(/3m 15s since the last update · no model output for 3m 10s: the model server is busy/);
  view.add({ step: "start", ms: 0, ok: true, note: "critic reviewing 2 section(s)", round: 1 });
  view.add({ step: "critic", role: "critic", section: "Hero", round: 1, ms: 9, ok: false, note: "score 6, fail\nmore" });
  expect(shown.at(-1)).toBe("… planning the site\n… critic reviewing 2 section(s) (round 1)\n✗ critic Hero (round 1) — score 6, fail\n⏳ 0m 00s since the last update");
  view.stop();
  const count = shown.length;
  vi.advanceTimersByTime(60_000);
  expect(shown).toHaveLength(count);
});
