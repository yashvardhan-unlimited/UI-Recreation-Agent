import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectPathPolicy } from "../../src/tools/path-policy.js";
import { applyUiPatch, readRelevantFiles } from "../../src/tools/files.js";

describe("project-root tool safety", () => {
  it("blocks traversal, .env, and binary reads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-path-"));
    const policy = new ProjectPathPolicy(root);
    await expect(policy.resolve("../outside.txt")).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
    await expect(policy.resolve(".env")).rejects.toMatchObject({ code: "SECRET_FILE_BLOCKED" });
    await expect(policy.resolve("hero.png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("applies exact anchored edits and detects stale hashes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-files-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "App.tsx"), "export const App = () => <h1>Old</h1>;\n");
    const [read] = await readRelevantFiles(root, ["src/App.tsx"]);
    await applyUiPatch(root, [{ path: "src/App.tsx", action: "edit", find: "Old", replace: "New", expectedSha256: read!.sha256 }]);
    expect(await readFile(path.join(root, "src", "App.tsx"), "utf8")).toContain("New");
    await expect(applyUiPatch(root, [{ path: "src/App.tsx", action: "edit", find: "New", replace: "Later", expectedSha256: read!.sha256 }])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates every operation before writing any file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-atomic-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "existing.ts"), "existing");
    await expect(applyUiPatch(root, [
      { path: "src/new.ts", action: "create", content: "new" },
      { path: "src/existing.ts", action: "replace", content: "changed" }
    ])).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readFile(path.join(root, "src", "new.ts"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(root, "src", "existing.ts"), "utf8")).toBe("existing");
  });
});
