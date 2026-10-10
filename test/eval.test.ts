import { expect, it } from "vitest";
import { metrics, toCsv } from "../evals/run.js";
import type { Report } from "../src/loop.js";

const report: Report = {
  previewUrl: "",
  sections: { Hero: { status: "pass", score: 8, open: [] }, Menu: { status: "fixed", score: 7, open: [] }, Map: { status: "excluded", open: ["Builder failed"] } },
  app: [],
  usage: { calls: 9, tokensIn: 9000, tokensOut: 1200, seconds: 40 },
};
const events = [
  { step: "direct", role: "director", ms: 1, ok: true },
  { step: "gates", round: 0, ms: 1, ok: false, note: "2 issues, 2 mounted: Menu/type: TS2322 | Map/build: …" },
  { step: "critic", role: "critic", section: "Hero", round: 0, ms: 1, ok: true, note: "score 8, slop 2: centered everything | fake stats" },
  { step: "promote", round: 0, ms: 0, ok: true, note: "Hero" },
  { step: "critic", role: "critic", section: "Menu", round: 1, ms: 1, ok: true, note: "score 7" },
  { step: "promote", round: 1, ms: 0, ok: true, note: "Hero,Menu" },
  { step: "promote", round: 2, ms: 0, ok: true, note: "Hero,Menu" },
];

it("turns a report and its event log into one CSV row", () => {
  const row = metrics({ id: "ramen", kind: "plain", seconds: 41, report }, events);
  expect(row).toEqual({
    id: "ramen", kind: "plain", status: "ok", sections: 3, green: 2,
    first_round_gate_pass_rate: 0.33, rounds_to_green: "", mean_critic_score: 7.5,
    slop_findings: 2, rollbacks: 0, excluded: 1, calls: 9, tokens_in: 9000, tokens_out: 1200, wall_s: 41,
  });
  // All sections green from round 1 on.
  const allGreen = { ...report, sections: { Hero: report.sections.Hero!, Menu: report.sections.Menu! } };
  expect(metrics({ id: "x", kind: "plain", seconds: 1, report: allGreen }, events).rounds_to_green).toBe(1);
});

it("reports a failed run as an error row and quotes CSV cells that need it", () => {
  const row = metrics({ id: "broken", kind: "3d", seconds: 3, error: "director reply was invalid twice: bad, \"quoted\"\nstack" }, [{ step: "direct", role: "director", tokensIn: 50, tokensOut: 5, ms: 1, ok: false }]);
  expect(row).toMatchObject({ status: 'error: director reply was invalid twice: bad, "quoted"', sections: 0, calls: 1, tokens_in: 50 });
  expect(toCsv([row]).split("\n")[1]).toContain('"error: director reply was invalid twice: bad, ""quoted"""');
});
