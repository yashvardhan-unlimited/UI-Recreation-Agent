import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectEnv } from "../../src/config/load.js";

const key = "UI_AGENT_TEST_ENV_KEY";
const original = process.env[key];

describe("project .env loading", () => {
  afterEach(() => {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });

  it("loads variables from a workspace .env without requiring another package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-env-"));
    try {
      delete process.env[key];
      await writeFile(path.join(root, ".env"), `${key}=loaded\n`, "utf8");
      expect(loadProjectEnv(root)).toBe(true);
      expect(process.env[key]).toBe("loaded");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a missing .env as optional", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-env-missing-"));
    try {
      await mkdir(path.join(root, ".git"));
      expect(loadProjectEnv(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the nearest ancestor .env for a project nested inside the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-env-parent-"));
    const child = path.join(root, "nested", "project");
    try {
      delete process.env[key];
      await mkdir(path.join(root, ".git"));
      await mkdir(child, { recursive: true });
      await writeFile(path.join(root, ".env"), `${key}=from-parent\n`, "utf8");
      expect(loadProjectEnv(child)).toBe(true);
      expect(process.env[key]).toBe("from-parent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not cross a nested repository boundary to load a parent secret", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-env-boundary-"));
    const child = path.join(root, "nested-project");
    try {
      delete process.env[key];
      await mkdir(path.join(child, ".git"), { recursive: true });
      await writeFile(path.join(root, ".env"), `${key}=must-not-load\n`, "utf8");
      expect(loadProjectEnv(child)).toBe(false);
      expect(process.env[key]).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
