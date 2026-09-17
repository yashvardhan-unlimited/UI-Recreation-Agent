import { describe, expect, it } from "vitest";
import { reactViteScaffold } from "../../src/templates/react-vite.js";

describe("React/Vite scaffold", () => {
  it("contains the pinned strict frontend stack and valid Playwright config text", () => {
    const files = new Map(reactViteScaffold().map((operation) => [operation.path, operation.content ?? ""]));
    expect(files.get("package.json")).toContain('"react": "19.3.0"');
    expect(files.get("package.json")).toContain('"preview": "vite preview"');
    expect(files.get("tsconfig.app.json")).toContain('"strict": true');
    expect(files.get("src/styles.css")).toContain("prefers-reduced-motion");
    expect(files.get("src/vite-env.d.ts")).toContain("vite/client");
    expect(files.get("vite.config.ts")).toContain("fs: { strict: true, allow: [projectRoot] }");
    expect(files.get("playwright.config.ts")).toContain("\n});\n");
    expect(files.get("playwright.config.ts")).not.toContain("\n+});");
    expect(files.get("tests/ui.spec.ts")).toContain("toBeFocused");
  });
});
