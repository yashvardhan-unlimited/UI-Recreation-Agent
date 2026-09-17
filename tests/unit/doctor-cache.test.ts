import { describe, expect, it } from "vitest";
import { doctorMatchesConfig, verifiedVisualModel } from "../../src/model/doctor-cache.js";
import type { DoctorReport } from "../../src/doctor.js";
import { testConfig } from "../helpers.js";

function report(createdAt = new Date().toISOString()): DoctorReport {
  return {
    schemaVersion: 1, createdAt, selectedCodingModel: "qwen3.8:27b", selectedVisualModel: "qwen3.8:27b", installedModels: [], artifactRoot: "doctor",
    checks: [
      { name: "discovery", status: "PASS", testedUrl: "http://127.0.0.1:18080/api/tags", message: "ok" },
      { name: "inference_endpoint", status: "PASS", testedUrl: "http://127.0.0.1:18080/v1/models", message: "ok" },
      { name: "vision_single", status: "PASS", modelId: "qwen3.8:27b", message: "ok" },
      { name: "vision_compare", status: "PASS", modelId: "qwen3.8:27b", message: "ok" }
    ],
    summary: { passed: 4, failed: 0, notConfigured: 0 }
  };
}

describe("doctor capability gating", () => {
  it("requires a fresh report for the exact endpoints and model", () => {
    expect(doctorMatchesConfig(report(), testConfig(), "qwen3.8:27b")).toBe(true);
    expect(doctorMatchesConfig(report("2020-01-01T00:00:00.000Z"), testConfig(), "qwen3.8:27b")).toBe(false);
    expect(doctorMatchesConfig(report(), testConfig({ model: { ...testConfig().model, inferenceBaseUrl: "http://127.0.0.1:18080/other/v1" } }), "qwen3.8:27b")).toBe(false);
  });

  it("unlocks visual work only when both image checks pass for the same exact model", () => {
    expect(verifiedVisualModel(report(), "qwen3.8:27b")).toBe("qwen3.8:27b");
    const failed = report();
    failed.checks.find((check) => check.name === "vision_compare")!.status = "FAIL";
    expect(verifiedVisualModel(failed, "qwen3.8:27b")).toBeUndefined();
  });
});
