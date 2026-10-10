#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import pc from "picocolors";
import { loadConfig, saveConfig, setInteractionLevel } from "./config/load.js";
import { appConfigSchema, interactionLevelSchema } from "./config/schema.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { inferWorkflowKind, latestResumableRun } from "./launcher.js";
import { runLauncherUi } from "./pi/launcher-ui.js";
import { RunStore } from "./state/store.js";
import { safeError } from "./utils/errors.js";
import { consoleLogger } from "./utils/log.js";
import { resumeWorkflow, startWorkflow } from "./workflows/orchestrator.js";

const program = new Command();
program.name("ui-agent").description("Pi-powered frontend creation, recreation, audit, and repair agent").version("0.1.0");
program.option("--config <path>", "configuration file (default: .ui-agent/config.json)");

program.action(async () => {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("The UI Agent launcher needs an interactive terminal. Use a workflow command such as 'ui-agent create --brief <text> --out <directory>' in non-interactive environments.");
  }
  const previousRun = latestResumableRun(await new RunStore(process.cwd()).list());
  const choice = await runLauncherUi({
    cwd: process.cwd(),
    ...(previousRun ? { previousRun } : {})
  });
  if (choice.kind === "cancel") return;

  const config = await configFor(program);
  if (choice.kind === "resume") {
    await resumeWorkflow({ runId: choice.runId, workspaceRoot: process.cwd(), config, logger: consoleLogger, interactive: true });
    return;
  }
  const kind = await inferWorkflowKind(choice.prompt, process.cwd());
  const runId = await startWorkflow({ kind, brief: choice.prompt, projectRoot: process.cwd(), workspaceRoot: process.cwd(), config, logger: consoleLogger, interactive: true });
  console.log(`Run ${runId}`);
});

program.command("doctor").description("Verify model backend, Pi, browser, runtime, and visual capabilities").option("--json", "print JSON report").action(async (options) => {
  const config = await configFor(program);
  const report = await runDoctor(config, process.cwd());
  if (options.json) console.log(JSON.stringify(report, null, 2)); else printDoctor(report);
  if (report.summary.failed > 0) process.exitCode = 1;
});

program.command("create").description("Create a new frontend project from a brief").requiredOption("--brief <file-or-text>").requiredOption("--out <directory>").option("--interaction <level>", "high, balanced, or autonomous").option("--interactive", "force Pi TUI").action(async (options) => {
  const config = await configWithInteraction(program, options.interaction);
  const runId = await startWorkflow({ kind: "create", brief: await loadBrief(options.brief), projectRoot: options.out, workspaceRoot: process.cwd(), config, logger: consoleLogger, interactive: options.interactive || undefined });
  console.log(`Run ${runId}`);
});

program.command("improve").description("Audit and improve an existing frontend project").requiredOption("--project <directory>").requiredOption("--brief <file-or-text>").option("--interaction <level>").option("--interactive").action(async (options) => {
  const config = await configWithInteraction(program, options.interaction);
  const runId = await startWorkflow({ kind: "improve", brief: await loadBrief(options.brief), projectRoot: options.project, workspaceRoot: process.cwd(), config, logger: consoleLogger, interactive: options.interactive || undefined });
  console.log(`Run ${runId}`);
});

program.command("recreate").description("Recreate/restyle from owned screenshots or an authorized URL").requiredOption("--project <directory>").option("--reference <images...>").option("--url <authorized-url>").requiredOption("--brief <file-or-text>").option("--authorized", "confirm authorization to analyze/recreate the supplied URL").option("--interaction <level>").option("--interactive").action(async (options) => {
  if ((!options.reference || options.reference.length === 0) && !options.url) throw new Error("Provide --reference images or --url.");
  const config = await configWithInteraction(program, options.interaction);
  const runId = await startWorkflow({ kind: "recreate", brief: await loadBrief(options.brief), projectRoot: options.project, workspaceRoot: process.cwd(), config, logger: consoleLogger, references: options.reference, referenceUrl: options.url, urlAuthorized: Boolean(options.authorized), interactive: options.interactive || undefined });
  console.log(`Run ${runId}`);
});

program.command("audit").description("Run a frontend audit without assuming permission for broad redesign").requiredOption("--project <directory>").option("--brief <text>", "audit emphasis", "Audit the UI, important interactions, accessibility, responsiveness, and performance.").option("--interaction <level>").option("--interactive").action(async (options) => {
  const config = await configWithInteraction(program, options.interaction);
  const runId = await startWorkflow({ kind: "audit", brief: await loadBrief(options.brief), projectRoot: options.project, workspaceRoot: process.cwd(), config, logger: consoleLogger, interactive: options.interactive || undefined });
  console.log(`Run ${runId}`);
});

program.command("resume").description("Resume a persistent run and Pi session").argument("<run-id>").option("--interactive", "force Pi TUI").action(async (runId, options) => {
  await resumeWorkflow({ runId, workspaceRoot: process.cwd(), config: await configFor(program), logger: consoleLogger, interactive: options.interactive || undefined });
});

program.command("status").description("Show persistent run status").argument("[run-id]").option("--json").action(async (runId, options) => {
  const store = new RunStore(process.cwd());
  const value = runId ? await store.load(runId) : await store.list();
  if (options.json) console.log(JSON.stringify(value, null, 2)); else if (Array.isArray(value)) for (const run of value) console.log(`${run.runId}\t${run.kind}\t${run.stage}\t${run.status}\t${run.updatedAt}`); else console.log(`${value.runId}\n  ${value.kind} · ${value.stage} · ${value.status}\n  project: ${value.projectRoot}\n  open defects: ${value.defects.filter((defect) => defect.status === "open").length}\n  stop: ${value.stopReason ?? "—"}`);
});

const configCommand = program.command("config").description("Manage project-local UI-agent configuration");
configCommand.command("set").argument("<key>").argument("<value>").description("Set a supported configuration value").action(async (key, value) => {
  const configPath = program.opts().config as string | undefined;
  if (key === "interaction") {
    const updated = await setInteractionLevel(interactionLevelSchema.parse(value), configPath);
    console.log(`interaction=${updated.interaction}`);
    return;
  }
  if (key === "model") {
    const config = await loadConfig(configPath);
    const updated = appConfigSchema.parse({ ...config, model: { ...config.model, codingModelId: value } });
    await saveConfig(updated, configPath);
    console.log(`model.codingModelId=${value}`);
    return;
  }
  if (key === "visual-model") {
    const config = await loadConfig(configPath);
    const updated = appConfigSchema.parse({ ...config, model: { ...config.model, visualModelId: value } });
    await saveConfig(updated, configPath);
    console.log(`model.visualModelId=${value}`);
    return;
  }
  if (key === "provider") {
    const config = await loadConfig(configPath);
    const updated = appConfigSchema.parse({ ...config, model: { ...config.model, provider: value } });
    await saveConfig(updated, configPath);
    console.log(`model.provider=${value}`);
    return;
  }
  if (key === "groq-model" || key === "groq-visual-model") {
    const config = await loadConfig(configPath);
    const field = key === "groq-model" ? "codingModelId" : "visualModelId";
    const updated = appConfigSchema.parse({ ...config, model: { ...config.model, groq: { ...config.model.groq, [field]: value } } });
    await saveConfig(updated, configPath);
    console.log(`model.groq.${field}=${value}`);
    return;
  }
  throw new Error("Supported keys: interaction, provider, model, visual-model, groq-model, groq-visual-model");
});
configCommand.command("show").option("--json").action(async () => console.log(JSON.stringify(await configFor(program), null, 2)));

program.parseAsync().catch((error) => {
  const safe = safeError(error);
  console.error(pc.red(`${safe.code}: ${safe.message}`));
  if (safe.suggestion) console.error(`Suggestion: ${safe.suggestion}`);
  process.exitCode = 1;
});

async function configFor(root: Command) { return loadConfig(root.opts().config as string | undefined); }
async function configWithInteraction(root: Command, level?: string) { const config = await configFor(root); return level ? appConfigSchema.parse({ ...config, interaction: interactionLevelSchema.parse(level) }) : config; }
async function loadBrief(value: string): Promise<string> { try { await access(path.resolve(value)); return await readFile(path.resolve(value), "utf8"); } catch { return value; } }

function printDoctor(report: DoctorReport): void {
  console.log(`UI Agent doctor · ${report.createdAt}`);
  console.log(`Models: ${report.installedModels.map((model) => model.name).join(", ") || "none"}`);
  for (const check of report.checks) {
    const mark = check.status === "PASS" ? pc.green("PASS") : check.status === "FAIL" ? pc.red("FAIL") : pc.yellow("NOT CONFIGURED");
    console.log(`${mark.padEnd(20)} ${check.name}${check.modelId ? ` · ${check.modelId}` : ""}${check.latencyMs !== undefined ? ` · ${check.latencyMs}ms` : ""}`);
    console.log(`  ${check.message}`);
    if (check.testedUrl) console.log(`  URL: ${check.testedUrl}`);
    if (check.suggestion) console.log(`  Fix: ${check.suggestion}`);
  }
  console.log(`Report: ${path.join(report.artifactRoot, "doctor-report.json")}`);
}
