import Type from "typebox";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ask, stream } from "../src/llm.js";
import { mockLlm } from "./mock-llm.js";

let mock: Awaited<ReturnType<typeof mockLlm>>;
const schema = Type.Object({ kind: Type.Union([Type.Literal("build"), Type.Literal("edit")]) });

beforeAll(async () => {
  mock = await mockLlm({
    intake: { _: ['<think>The user wants a site.</think>{"wrong": 1}', 'Here you go: {"kind": "build"}'] },
    critic: { _: ["not json", "still not json"] },
  });
  Object.assign(process.env, { UI_LLM_URL: mock.url, UI_MODEL_INTAKE: "mock-intake", UI_MODEL_CRITIC: "mock-critic" });
});
afterAll(() => mock.close());

it("requests schema output, strips <think>, retries once with the error and sums usage", async () => {
  const before = Date.now();
  const { value, usage } = await ask<{ kind: string }>("intake", { system: "Classify.", user: ["make a site for a bakery"], schema });
  // The live view reads this to tell a writing model from a silent server.
  expect(stream.last).toBeGreaterThanOrEqual(before);
  expect(value).toEqual({ kind: "build" });
  const [first, retry] = mock.requests.filter((r) => r.role === "intake").map((r) => JSON.parse(r.body) as { response_format?: unknown; messages: { content: unknown }[] });
  expect(first!.response_format).toMatchObject({ type: "json_schema" });
  expect(JSON.stringify(retry!.messages.at(-1))).toMatch(/does not match the schema/);
  expect(usage.tokensIn).toBeGreaterThan(0);
  expect(usage.tokensOut).toBe(Math.ceil('<think>The user wants a site.</think>{"wrong": 1}'.length / 4) + Math.ceil('Here you go: {"kind": "build"}'.length / 4));
});

it("throws after two invalid replies, still reporting usage", async () => {
  const error = await ask("critic", { system: "Judge.", user: ["x"], schema }).then(
    () => { throw new Error("expected ask() to throw"); },
    (e: unknown) => e as Error & { usage: { tokensIn: number } },
  );
  expect(error.message).toMatch(/invalid twice/);
  expect(error.usage.tokensIn).toBeGreaterThan(0);
});
