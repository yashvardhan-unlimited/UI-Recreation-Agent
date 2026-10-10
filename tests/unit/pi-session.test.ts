import { describe, expect, it } from "vitest";
import { piModelCatalog } from "../../src/pi/session.js";
import { tagsFixture, testConfig } from "../helpers.js";

describe("Pi model catalog", () => {
  it("registers every discovered model for Pi's native /model selector", () => {
    const [coding, textOnly] = tagsFixture.models;
    const catalog = piModelCatalog({
      config: testConfig(),
      provider: "local-ollama",
      defaultModel: coding!,
      availableModels: tagsFixture.models,
      visualModelId: coding!.name
    });

    expect(catalog.map((model) => model.id)).toEqual([coding!.name, textOnly!.name]);
    expect(catalog.find((model) => model.id === coding!.name)?.input).toEqual(["text", "image"]);
    expect(catalog.find((model) => model.id === textOnly!.name)?.input).toEqual(["text"]);
  });
});
