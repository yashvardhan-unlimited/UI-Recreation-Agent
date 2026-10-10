import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { paths, promote, removeProject, runLog, snapshot, syncStage } from "../src/store.js";

const write = async (file: string, text: string) => {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, text);
};

it("syncStage links the site's install and removing the stage never touches it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-store-"));
  const { site, stage } = paths(dir);
  await write(join(site, "node_modules", "keep.txt"), "x");
  await write(join(site, "src", "tokens.css"), "@theme {}");
  await syncStage(dir);
  await access(join(stage, "node_modules", "keep.txt"));
  await syncStage(dir);
  await removeProject(stage);
  await access(join(site, "node_modules", "keep.txt"));
});

it("promote copies green sections and tokens, and the site registry lists only them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-store-"));
  const { site, stage } = paths(dir);
  await write(join(stage, "src", "sections", "A.tsx"), "export default () => null;");
  await write(join(stage, "src", "sections", "B.tsx"), "export default () => null;");
  await write(join(stage, "src", "tokens.css"), "@theme { --color-bg: #000; }");
  await write(join(stage, "index.html"), "<!doctype html>");
  await snapshot(dir, "A");
  await promote(dir, ["A"]);
  expect(await readFile(join(site, "src", "tokens.css"), "utf8")).toContain("#000");
  const registry = await readFile(join(site, "src", "sections", "index.ts"), "utf8");
  expect(registry).toContain('import A from "./A"');
  expect(registry).not.toContain("B");
  await expect(access(join(site, "src", "sections", "B.tsx"))).rejects.toThrow();
});

it("runLog appends one JSON event per line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ui-store-"));
  const log = runLog(dir);
  await log({ step: "gates", ms: 5, ok: true });
  await log({ step: "critic", section: "Hero", ms: 9, ok: false, note: "score 5" });
  const [file] = await import("node:fs/promises").then((fs) => fs.readdir(paths(dir).runs));
  const lines = (await readFile(join(paths(dir).runs, file!), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { step: string; t: number });
  expect(lines.map((l) => l.step)).toEqual(["gates", "critic"]);
  expect(lines.every((l) => typeof l.t === "number")).toBe(true);
});
