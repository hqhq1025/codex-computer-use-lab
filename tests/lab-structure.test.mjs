import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePostedResponsesRequest, summarizeResponsesRequest } from "../lib/model-tool-surface.mjs";
import { containsSecretLikeText, redactSecrets } from "../lib/redaction.mjs";

test("summarizeResponsesRequest distinguishes node_repl from computer tool", () => {
  const summary = summarizeResponsesRequest({
    model: "gpt-test",
    tool_choice: "auto",
    tools: [
      { type: "tool_search" },
      {
        type: "namespace",
        name: "mcp__node_repl",
        tools: [{ type: "function", name: "js" }]
      }
    ],
    input: [
      { type: "message" },
      { type: "function_call" },
      { type: "function_call_output" }
    ]
  });

  assert.equal(summary.hasResponsesComputerTool, false);
  assert.equal(summary.nodeReplTools.length, 1);
  assert.equal(summary.computerProtocolInputCount, 0);
});

test("parsePostedResponsesRequest extracts only the final JSON payload", () => {
  const request = parsePostedResponsesRequest(
    'prefix POST to http://127.0.0.1:8538/v1/responses: {"model":"x","tools":[]}'
  );
  assert.equal(request.model, "x");
});

test("parsePostedResponsesRequest ignores tracing suffixes and braces inside strings", () => {
  const request = parsePostedResponsesRequest(
    'span POST to http://127.0.0.1/v1/responses: {"model":"x","input":[{"type":"message","text":"value { with } braces and \\"quotes\\""}]} trailing_span{field=true}'
  );
  assert.equal(request.model, "x");
  assert.equal(
    request.input[0].text,
    'value { with } braces and "quotes"'
  );
});

test("parsePostedResponsesRequest preserves non-JSON JavaScript escapes as literals", () => {
  const request = parsePostedResponsesRequest(
    'POST to http://127.0.0.1/v1/responses: {"model":"x","input":[{"type":"message","text":"regex \\\\x7f and zero \\\\0"}]}'
      .replaceAll("\\\\x", "\\x")
      .replaceAll("\\\\0", "\\0")
  );
  assert.equal(request.input[0].text, "regex \\x7f and zero \\0");
});

test("redaction removes representative credentials", () => {
  const value = redactSecrets(
    'api_key="secret-value" Authorization: Bearer abcdefghijklmnop tvly-abcdefghijklmnop'
  );
  assert.match(value, /<redacted>/);
  assert.equal(containsSecretLikeText(value), false);
});

test("root README states the no-real-input safety boundary", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /must not:/);
  assert.match(readme, /real `computeruse\.sock`/);
  assert.match(readme, /synthesize keyboard or mouse input/);
});

test("checked model surface proves deferred node_repl without a computer tool", async () => {
  const fixtureUrl = new URL(
    "../fixtures/model-tool-surface/latest.json",
    import.meta.url
  );
  let fixture;
  try {
    fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  assert.equal(fixture.requestSurface.hasResponsesComputerTool, false);
  assert.equal(
    fixture.requestSurface.tools.some((tool) => tool.type === "tool_search"),
    true
  );
  assert.equal(
    fixture.rolloutDeferredSequence.toolSearchPrecedesNodeRepl,
    true
  );
});
