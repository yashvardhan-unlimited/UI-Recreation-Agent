import { Image, matchesKey, visibleWidth, type Focusable } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ImageCandidate } from "../tools/assets.js";

export class ImageSelectionView implements Focusable {
  focused = false;
  private selected = 0;
  private readonly image: Image;
  private readonly choices: Array<{ id: string; label: string }>;

  constructor(base64Png: string, candidates: ImageCandidate[], private readonly theme: Theme, private readonly done: (value: string | undefined) => void) {
    this.image = new Image(base64Png, "image/png", { fallbackColor: (value) => theme.fg("muted", value) }, { maxHeightCells: 18, filename: "image-candidates.png" });
    this.choices = [
      ...candidates.map((candidate, index) => ({ id: candidate.id, label: `${index + 1}. ${candidate.title} - ${candidate.creator} - ${candidate.license.toUpperCase()}` })),
      { id: "action:search-again", label: "Search again with revised queries" },
      { id: "action:supply-own", label: "Supply my own asset" },
      { id: "action:reject-all", label: "Reject all candidates" }
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) this.done(undefined);
    else if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
    else if (matchesKey(data, "down")) this.selected = Math.min(this.choices.length - 1, this.selected + 1);
    else if (matchesKey(data, "return")) this.done(this.choices[this.selected]?.id);
  }

  render(width: number): string[] {
    const usable = Math.max(32, Math.min(width, 110));
    const lines = this.image.render(usable);
    const choices = this.choices.map((choice, index) => {
      const prefix = index === this.selected ? this.theme.fg("accent", "> ") : "  ";
      const raw = `${prefix}${choice.label}`;
      return visibleWidth(raw) > usable ? `${raw.slice(0, Math.max(0, usable - 1))}…` : raw;
    });
    return [...lines, "", this.theme.fg("accent", "Choose an image candidate"), ...choices, "", this.theme.fg("muted", "Up/Down selects - Enter confirms - Esc cancels")];
  }

  invalidate(): void { this.image.invalidate(); }
}
