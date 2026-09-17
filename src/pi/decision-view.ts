import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type Focusable } from "@earendil-works/pi-tui";
import type { RunManifest } from "../state/schema.js";

export class DecisionView implements Focusable {
  focused = false;
  private offset = 0;

  constructor(private readonly run: RunManifest, private readonly theme: Theme, private readonly done: () => void) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return")) this.done();
    if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
    if (matchesKey(data, "down")) this.offset = Math.min(Math.max(0, this.rows().length - 10), this.offset + 1);
  }

  render(width: number): string[] {
    const inner = Math.max(30, Math.min(width - 4, 96));
    const border = this.theme.fg("border", `+${"-".repeat(inner)}+`);
    const fit = (text: string): string => {
      const raw = visibleWidth(text) > inner ? `${text.slice(0, Math.max(0, inner - 1))}…` : text;
      return `${raw}${" ".repeat(Math.max(0, inner - visibleWidth(raw)))}`;
    };
    const content = this.rows().slice(this.offset, this.offset + 12).map((line) => `${this.theme.fg("border", "|")}${fit(line)}${this.theme.fg("border", "|")}`);
    return [border, `${this.theme.fg("border", "|")}${fit(` Run ${this.run.runId} · ${this.run.stage} · ${this.run.status}`)}${this.theme.fg("border", "|")}`, ...content, `${this.theme.fg("border", "|")}${fit(" Enter/Esc closes · ↑/↓ scrolls")}${this.theme.fg("border", "|")}`, border];
  }

  invalidate(): void {}

  private rows(): string[] {
    const decisions = this.run.decisions.filter((decision) => !decision.supersededAt).map((decision) => `DECISION  ${decision.topic}: ${JSON.stringify(decision.value)}`);
    const approvals = this.run.approvals.map((approval) => `${approval.approved ? "APPROVED" : "DECLINED"} ${approval.kind}: ${approval.summary}`);
    const defects = this.run.defects.filter((defect) => defect.status === "open").map((defect) => `${defect.severity.toUpperCase()} ${defect.page}/${defect.viewport}: ${defect.observedProblem}`);
    return [...decisions, ...approvals, ...defects].length ? [...decisions, ...approvals, ...defects] : ["No recorded decisions, approvals, or open defects yet."];
  }
}
