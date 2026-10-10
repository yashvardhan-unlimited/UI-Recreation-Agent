#!/usr/bin/env node
// `uagent`: pi with the UI Agent extension, talking to the self-hosted model server.
// The defaults below are the trialled role → model mapping; any UI_* variable already set in the environment wins.
import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vision = "qwen3.8:27b", coder = "qwen3-coder:30b";
const env = {
  UI_LLM_URL: "http://127.0.0.1:18080/v1",
  UI_MODEL_INTAKE: coder, UI_MODEL_DIRECTOR: vision, UI_MODEL_ANALYST: vision,
  UI_MODEL_BUILDER: coder, UI_MODEL_SHOWPIECE: coder, UI_MODEL_CRITIC: vision,
  ...process.env,
};
const pi = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const args = [pi, "-e", join(root, "src", "index.ts"), "--provider", "selfhosted", "--model", vision, ...process.argv.slice(2)];
// Ctrl+C reaches every process in the console; let pi handle it instead of this launcher dying under it.
process.on("SIGINT", () => {});
spawn(process.execPath, args, { stdio: "inherit", env }).on("exit", (code) => process.exit(code ?? 1));
