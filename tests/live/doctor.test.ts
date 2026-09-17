import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/schema.js";
import { runDoctor } from "../../src/doctor.js";

const enabled = process.env.UI_AGENT_LIVE_MODEL === "1";

describe.skipIf(!enabled)("live local-model capability doctor", () => {
  it("proves text, JSON recovery, tool continuation, Pi tool continuation, browser, and configured vision", async () => {
    const report = await runDoctor(defaultConfig, process.cwd());
    const status = new Map(report.checks.map((check) => [check.name, check.status]));
    for (const name of ["discovery", "inference_endpoint", "text", "structured_json", "tool_calling", "pi_tool_roundtrip", "runtime_package_port", "browser_screenshot"]) {
      expect(status.get(name), name).toBe("PASS");
    }
    if (report.selectedVisualModel) {
      expect(status.get("vision_single")).toBe("PASS");
      expect(status.get("vision_compare")).toBe("PASS");
    }
  }, 900_000);
});
