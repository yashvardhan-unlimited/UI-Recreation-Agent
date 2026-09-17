import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { appConfigSchema, defaultConfig, type AppConfig, type InteractionLevel } from "./schema.js";

export function defaultConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, ".ui-agent", "config.json");
}

export async function loadConfig(configPath = defaultConfigPath()): Promise<AppConfig> {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const candidate = deepMerge(defaultConfig, parsed);
  return appConfigSchema.parse(candidate);
}

export async function saveConfig(config: AppConfig, configPath = defaultConfigPath()): Promise<void> {
  const validated = appConfigSchema.parse(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  const temp = `${configPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, configPath);
}

export async function setInteractionLevel(level: InteractionLevel, configPath = defaultConfigPath()): Promise<AppConfig> {
  const config = await loadConfig(configPath);
  const updated = appConfigSchema.parse({ ...config, interaction: level });
  await saveConfig(updated, configPath);
  return updated;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override === undefined ? base : override;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
