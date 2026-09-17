import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { chromium } from "playwright";
import getPort from "get-port";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory
} from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "./config/schema.js";
import { authHeaders, discoverModels, selectModels, verifyOpenAiModelsEndpoint } from "./model/discovery.js";
import { probeSingleVision, probeStructuredJson, probeText, probeToolCalling, probeVisionComparison } from "./model/capabilities.js";
import type { CapabilityEvidence, OllamaModel } from "./model/types.js";
import { writeJsonAtomic, timestampForPath } from "./utils/fs.js";
import { safeError } from "./utils/errors.js";
import { runProcess } from "./utils/process.js";

export type DoctorStatus = "PASS" | "FAIL" | "NOT_CONFIGURED";
export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  testedUrl?: string;
  modelId?: string;
  latencyMs?: number;
  message: string;
  suggestion?: string;
  evidence?: unknown;
}
export interface DoctorReport {
  schemaVersion: 1;
  createdAt: string;
  selectedCodingModel?: string;
  selectedVisualModel?: string;
  installedModels: OllamaModel[];
  checks: DoctorCheck[];
  artifactRoot: string;
  summary: { passed: number; failed: number; notConfigured: number };
}

export async function runDoctor(config: AppConfig, workspaceRoot: string): Promise<DoctorReport> {
  const artifactRoot = path.join(workspaceRoot, ".ui-agent", "doctor", timestampForPath());
  await mkdir(artifactRoot, { recursive: true });
  const checks: DoctorCheck[] = [];
  let installedModels: OllamaModel[] = [];
  let selected: ReturnType<typeof selectModels> | undefined;
  let endpointAvailable = false;

  if (config.model.protocol !== "openai-completions") {
    checks.push({ name: "protocol", status: "FAIL", testedUrl: config.model.inferenceBaseUrl, message: "The installed Pi SDK integration has no documented native Ollama agent provider.", suggestion: "Use protocol=openai-completions with the verified loopback /v1 base URL." });
  }

  const discoveryStart = performance.now();
  try {
    installedModels = await discoverModels(config);
    selected = selectModels(installedModels, config);
    checks.push({ name: "discovery", status: "PASS", testedUrl: config.model.discoveryUrl, latencyMs: elapsed(discoveryStart), message: `Discovered ${installedModels.length} installed model(s).`, evidence: installedModels.map((model) => ({ name: model.name, digest: model.digest, size: model.size, details: model.details, advertisedCapabilities: model.capabilities })) });
  } catch (error) { checks.push(failed("discovery", error, { testedUrl: config.model.discoveryUrl, started: discoveryStart, suggestion: "Start the loopback inference server and verify the discovery URL." })); }

  const endpointStart = performance.now();
  if (config.model.protocol === "openai-completions") {
    try {
      const ids = await verifyOpenAiModelsEndpoint(config);
      if (selected && !ids.includes(selected.coding.name)) throw new Error(`Selected model ${selected.coding.name} was not returned by /v1/models.`);
      endpointAvailable = true;
      checks.push({ name: "inference_endpoint", status: "PASS", testedUrl: `${config.model.inferenceBaseUrl}/models`, ...(selected ? { modelId: selected.coding.name } : {}), latencyMs: elapsed(endpointStart), message: "OpenAI-compatible model endpoint is available.", evidence: ids });
    } catch (error) { checks.push(failed("inference_endpoint", error, { testedUrl: `${config.model.inferenceBaseUrl}/models`, ...(selected ? { modelId: selected.coding.name } : {}), started: endpointStart, suggestion: "Use an inference base URL ending in /v1 and keep the local server running." })); }
  } else {
    checks.push({ name: "inference_endpoint", status: "NOT_CONFIGURED", testedUrl: config.model.inferenceBaseUrl, message: "No supported Pi inference protocol is configured.", suggestion: "Select openai-completions for this installed Pi version." });
  }

  if (selected && endpointAvailable) {
    await captureCapabilityCheck(checks, "text", () => probeText(config, selected!.coding.name), config, selected.coding.name);
    await captureCapabilityCheck(checks, "structured_json", () => probeStructuredJson(config, selected!.coding.name), config, selected.coding.name);
    await captureCapabilityCheck(checks, "tool_calling", () => probeToolCalling(config, selected!.coding.name), config, selected.coding.name);
    await captureCapabilityCheck(checks, "pi_tool_roundtrip", () => probePiToolRoundtrip(config, selected!.coding, artifactRoot), config, selected.coding.name);
    if (selected.visual) {
      await captureCapabilityCheck(checks, "vision_single", () => probeSingleVision(config, selected!.visual!.name, path.join(artifactRoot, "vision")), config, selected.visual.name);
      await captureCapabilityCheck(checks, "vision_compare", () => probeVisionComparison(config, selected!.visual!.name, path.join(artifactRoot, "vision")), config, selected.visual.name);
    } else {
      checks.push({ name: "vision_single", status: "NOT_CONFIGURED", modelId: selected.coding.name, message: "No visual model was discovered/configured.", suggestion: "Set model.visualModelId to an installed local VLM and rerun doctor." });
      checks.push({ name: "vision_compare", status: "NOT_CONFIGURED", modelId: selected.coding.name, message: "No visual model was discovered/configured.", suggestion: "Screenshot and URL recreation will be refused until a local VLM passes." });
    }
  } else {
    const reason = selected ? "The selected inference endpoint did not pass." : "No exact installed model could be selected from discovery.";
    for (const name of ["text", "structured_json", "tool_calling", "pi_tool_roundtrip"] as const) checks.push({ name, status: "NOT_CONFIGURED", ...(selected ? { modelId: selected.coding.name } : {}), message: `${reason} This capability was not tested.`, suggestion: "Restore discovery and the /v1 endpoint, then rerun doctor." });
    for (const name of ["vision_single", "vision_compare"] as const) checks.push({ name, status: "NOT_CONFIGURED", ...(selected?.visual ? { modelId: selected.visual.name } : {}), message: `${reason} Visual capability was not tested.`, suggestion: "Configure an installed local VLM and rerun doctor." });
  }

  await checkRuntime(checks, workspaceRoot);
  await checkBrowser(checks, artifactRoot);
  const report: DoctorReport = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ...(selected ? { selectedCodingModel: selected.coding.name } : {}),
    ...(selected?.visual ? { selectedVisualModel: selected.visual.name } : {}),
    installedModels,
    checks,
    artifactRoot,
    summary: { passed: checks.filter((check) => check.status === "PASS").length, failed: checks.filter((check) => check.status === "FAIL").length, notConfigured: checks.filter((check) => check.status === "NOT_CONFIGURED").length }
  };
  await writeJsonAtomic(path.join(artifactRoot, "doctor-report.json"), report);
  await writeJsonAtomic(path.join(workspaceRoot, ".ui-agent", "doctor", "latest.json"), report);
  return report;
}

async function probePiToolRoundtrip(config: AppConfig, discovered: OllamaModel, artifactRoot: string): Promise<CapabilityEvidence> {
  const started = performance.now();
  const projectRoot = path.join(artifactRoot, "pi-roundtrip");
  const agentDir = path.join(projectRoot, ".pi-agent");
  await mkdir(agentDir, { recursive: true });
  const token = "PI_TOOL_CONTINUATION_8472";
  let calls = 0;
  const extension: ExtensionFactory = (pi) => {
    pi.registerTool({
      name: "doctor_write_probe",
      label: "Doctor write probe",
      description: "Write the exact diagnostic token to a project-scoped test file.",
      parameters: Type.Object({ token: Type.String() }),
      async execute(_id, params) {
        calls += 1;
        if (params.token !== token) throw new Error("Incorrect diagnostic token.");
        await writeFile(path.join(projectRoot, "pi-roundtrip.txt"), params.token, "utf8");
        return { content: [{ type: "text", text: JSON.stringify({ written: true, token: params.token }) }], details: { written: true } };
      }
    });
  };
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerProvider("doctor-local", {
    baseUrl: config.model.inferenceBaseUrl, apiKey: "local-loopback", authHeader: false, headers: authHeaders(config), api: "openai-completions",
    models: [{ id: discovered.name, name: discovered.name, reasoning: discovered.capabilities.includes("thinking"), thinkingLevelMap: { off: "none", minimal: "low", low: "low", medium: "medium", high: "high" }, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: discovered.details.context_length ?? config.model.contextWindow, maxTokens: Math.max(512, Math.min(config.model.maxOutputTokens, 2_048)), compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true, maxTokensField: "max_tokens", thinkingFormat: "openai", supportsStrictMode: false } }]
  });
  await modelRuntime.setRuntimeApiKey("doctor-local", "local-loopback");
  const model = modelRuntime.getModel("doctor-local", discovered.name)!;
  const settingsManager = SettingsManager.inMemory({ defaultThinkingLevel: "off", retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: projectRoot, agentDir, settingsManager, extensionFactories: [{ name: "doctor", factory: extension }], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "You are a capability doctor. Always use the required tool, then state the exact token from its result." });
  await loader.reload({ resolveProjectTrust: async () => false });
  const { session } = await createAgentSession({ cwd: projectRoot, agentDir, modelRuntime, model, thinkingLevel: "off", tools: ["doctor_write_probe"], sessionManager: SessionManager.inMemory(projectRoot), settingsManager, resourceLoader: loader });
  let assistantText = "";
  const unsubscribe = session.subscribe((event) => { if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") assistantText += event.assistantMessageEvent.delta; });
  try { await session.prompt(`Call doctor_write_probe with token '${token}'. After the tool result, reply with exactly '${token}'.`); } finally { unsubscribe(); session.dispose(); }
  const file = await readFile(path.join(projectRoot, "pi-roundtrip.txt"), "utf8");
  return { capability: "tools", passed: calls === 1 && file === token && assistantText.includes(token), latencyMs: elapsed(started), modelId: discovered.name, endpoint: config.model.inferenceBaseUrl, evidence: `pi_tool_calls=${calls}, file_roundtrip=${file === token}, continuation=${assistantText.includes(token)}` };
}

async function checkRuntime(checks: DoctorCheck[], workspaceRoot: string): Promise<void> {
  const started = performance.now();
  try {
    const node = await runProcess("node", ["--version"], { cwd: workspaceRoot, timeoutMs: 10_000 });
    const npm = await runProcess("npm", ["--version"], { cwd: workspaceRoot, timeoutMs: 10_000 });
    const port = await getPort();
    const server = createServer((_request, response) => { response.writeHead(204); response.end(); });
    await new Promise<void>((resolve, reject) => server.listen(port, "127.0.0.1", resolve).once("error", reject));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    checks.push({ name: "runtime_package_port", status: "PASS", latencyMs: elapsed(started), message: `Node ${node.stdout.trim()}, npm ${npm.stdout.trim()}, loopback port ${port} allocatable.` });
  } catch (error) { checks.push(failed("runtime_package_port", error, { started, suggestion: "Install supported Node/npm and ensure a loopback port can be allocated." })); }
}

async function checkBrowser(checks: DoctorCheck[], artifactRoot: string): Promise<void> {
  const started = performance.now();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.setContent("<!doctype html><title>UI Agent Doctor</title><main><h1>Browser OK</h1></main>");
    const screenshotPath = path.join(artifactRoot, "browser-doctor.png");
    await page.screenshot({ path: screenshotPath });
    checks.push({ name: "browser_screenshot", status: "PASS", latencyMs: elapsed(started), message: "Chromium launched and wrote a real screenshot.", evidence: { executable: chromium.executablePath(), screenshotPath } });
  } catch (error) { checks.push(failed("browser_screenshot", error, { started, suggestion: "Run npx playwright install chromium or configure an installed Chrome/Edge channel." })); }
  finally { await browser?.close(); }
}

async function captureCapabilityCheck(checks: DoctorCheck[], name: string, operation: () => Promise<CapabilityEvidence>, config: AppConfig, modelId: string): Promise<void> {
  try { checks.push({ ...fromEvidence(await operation()), name }); }
  catch (error) { checks.push(failed(name, error, { testedUrl: `${config.model.inferenceBaseUrl}/chat/completions`, modelId })); }
}

function fromEvidence(evidence: CapabilityEvidence): DoctorCheck {
  return { name: evidence.capability, status: evidence.passed ? "PASS" : "FAIL", testedUrl: evidence.endpoint, modelId: evidence.modelId, latencyMs: evidence.latencyMs, message: evidence.passed ? "Capability verified with correct output." : "Endpoint responded, but the answer did not prove the capability.", evidence: evidence.evidence, ...(evidence.passed ? {} : { suggestion: "Use a different installed local model or adjust its compatible provider settings." }) };
}

function failed(name: string, error: unknown, meta: { testedUrl?: string; modelId?: string; started?: number; suggestion?: string }): DoctorCheck {
  const safe = safeError(error);
  const suggestion = meta.suggestion ?? safe.suggestion;
  return { name, status: "FAIL", ...(meta.testedUrl ? { testedUrl: meta.testedUrl } : {}), ...(meta.modelId ? { modelId: meta.modelId } : {}), ...(meta.started ? { latencyMs: elapsed(meta.started) } : {}), message: safe.message, ...(suggestion ? { suggestion } : {}) };
}

function elapsed(started: number): number { return Math.round(performance.now() - started); }
