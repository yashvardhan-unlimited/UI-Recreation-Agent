import {
  ExtensionInputComponent,
  initTheme
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  ProcessTerminal,
  TuiMainScreen
} from "@earendil-works/pi-tui";
import type { RunManifest } from "../state/schema.js";

export type LauncherChoice =
  | { kind: "prompt"; prompt: string }
  | { kind: "resume"; runId: string }
  | { kind: "cancel" };

export function resolveLauncherSubmission(
  value: string,
  previousRun?: RunManifest
): LauncherChoice | undefined {
  const prompt = value.trim();
  if (!prompt) return undefined;
  if (prompt.toLowerCase() === "/resume" && previousRun) {
    return { kind: "resume", runId: previousRun.runId };
  }
  return { kind: "prompt", prompt };
}

export async function runLauncherUi(input: {
  cwd: string;
  previousRun?: RunManifest;
}): Promise<LauncherChoice> {
  initTheme(undefined, false);
  const tui = new TuiMainScreen(new ProcessTerminal());
  tui.setClearOnShrink(true);

  const previous = input.previousRun
    ? `\n\nPrevious session: ${input.previousRun.runId} · ${input.previousRun.stage} · ${input.previousRun.status}\nType /resume or press Ctrl+R to continue it.`
    : "";
  const title = `UI Agent\n\nWhat would you like to create, change, recreate, or inspect?\nWorking in ${input.cwd}${previous}`;

  return await new Promise<LauncherChoice>((resolve) => {
    let settled = false;
    let removeInputListener = (): void => {};

    const finish = async (choice: LauncherChoice): Promise<void> => {
      if (settled) return;
      settled = true;
      removeInputListener();
      composer.dispose();
      tui.clear();
      tui.requestRender(true);
      await new Promise((done) => setTimeout(done, 25));
      tui.stop();
      resolve(choice);
    };

    const composer = new ExtensionInputComponent(
      title,
      "Describe the interface you want",
      (value) => {
        const choice = resolveLauncherSubmission(value, input.previousRun);
        if (choice) void finish(choice);
      },
      () => void finish({ kind: "cancel" }),
      { tui }
    );

    removeInputListener = tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
        void finish({ kind: "cancel" });
        return { consume: true };
      }
      if (input.previousRun && matchesKey(data, "ctrl+r")) {
        void finish({ kind: "resume", runId: input.previousRun.runId });
        return { consume: true };
      }
      return undefined;
    });

    tui.addChild(composer);
    tui.setFocus(composer);
    tui.start();
  });
}
