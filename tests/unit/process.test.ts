import { describe, expect, it } from "vitest";
import { safeChildEnvironment } from "../../src/utils/process.js";

describe("preview process environment", () => {
  it("does not inherit model, cloud, home, cluster, SSH, or container credentials", () => {
    const environment = safeChildEnvironment();
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "OLLAMA_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "AWS_ACCESS_KEY_ID", "KUBECONFIG", "SSH_AUTH_SOCK", "DOCKER_HOST", "CONTAINER_HOST"]) {
      expect(environment[key], key).toBeUndefined();
    }
    expect(environment.UI_AGENT_PREVIEW).toBe("1");
  });
});
