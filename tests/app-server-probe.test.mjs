import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { containsSecretLikeText } from "../lib/redaction.mjs";
import {
  DEFAULT_CODEX_BINARY,
  JsonLineDecoder,
  buildProbeMessages,
  encodeJsonLine,
  runProbe,
  sanitizeTranscriptValue,
  validateHandshakeTranscript
} from "../scripts/app-server-probe.mjs";

test("JSONL framing survives arbitrary stdout chunk boundaries", () => {
  const decoder = new JsonLineDecoder();
  const first = { id: "one", result: { ok: true } };
  const second = { method: "notice", params: { value: 2 } };
  const wire = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;

  assert.deepEqual(decoder.push(wire.slice(0, 7)), []);
  assert.deepEqual(decoder.push(wire.slice(7, 19)), []);
  assert.deepEqual(decoder.push(wire.slice(19)), [first, second]);
  assert.deepEqual(decoder.finish(), []);

  const clientFrame = encodeJsonLine(buildProbeMessages().initialize);
  assert.equal(clientFrame.endsWith("\n"), true);
  assert.equal(clientFrame.split("\n").length, 2);
  assert.equal(JSON.parse(clientFrame).jsonrpc, undefined);
});

test("client allowlist rejects model, write, MCP, and Computer Use methods", () => {
  for (const method of [
    "thread/start",
    "turn/start",
    "model/list",
    "fs/writeFile",
    "mcpServer/tool/call",
    "computer/use"
  ]) {
    assert.throws(
      () => encodeJsonLine({ id: "unsafe", method, params: {} }),
      /refusing unsafe app-server method/
    );
  }
});

test("recorded fixture contains initialize, initialized, and read-only thread/list", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/app-server/probe.json", import.meta.url),
      "utf8"
    )
  );

  validateHandshakeTranscript(fixture);
  assert.deepEqual(
    fixture.messages
      .filter((entry) => entry.direction === "client->server")
      .map((entry) => entry.message.method),
    ["initialize", "initialized", "thread/list"]
  );
  const threadList = fixture.messages.find(
    (entry) =>
      entry.direction === "server->client" &&
      entry.message.id === "probe-thread-list"
  );
  assert.deepEqual(threadList.message.result.data, []);
  assert.equal(fixture.safety.modelTaskStarted, false);
  assert.equal(fixture.safety.computerUseInvoked, false);
  assert.equal(fixture.safety.writeRpcInvoked, false);
});

test("transcript sanitizer removes secrets and private temporary paths", () => {
  const sanitized = sanitizeTranscriptValue(
    {
      codexHome: "/private/tmp/probe-secret",
      authorization: "Bearer abcdefghijklmnop",
      nested: {
        apiKey: "sk-abcdefghijklmnop",
        path: "/Users/example/private/project"
      },
      serverName: "private-host.local",
      installationId: "11111111-2222-3333-4444-555555555555"
    },
    {
      temporaryCodexHome: "/private/tmp/probe-secret",
      homeDirectory: "/Users/example"
    }
  );
  const text = JSON.stringify(sanitized);

  assert.equal(containsSecretLikeText(text), false);
  assert.doesNotMatch(text, /abcdefghijklmnop/);
  assert.doesNotMatch(text, /\/private\/tmp\/probe-secret/);
  assert.doesNotMatch(text, /\/Users\/example/);
  assert.doesNotMatch(text, /private-host/);
  assert.doesNotMatch(text, /11111111-2222/);
  assert.match(text, /<temporary-codex-home>/);
  assert.match(text, /<home>/);
  assert.match(text, /<redacted-host>/);
  assert.match(text, /<redacted-installation-id>/);
});

test(
  "live private app-server completes the isolated read-only handshake",
  { skip: !existsSync(DEFAULT_CODEX_BINARY), timeout: 30_000 },
  async () => {
    const transcript = await runProbe({ timeoutMs: 20_000 });
    validateHandshakeTranscript(transcript);

    const threadList = transcript.messages.find(
      (entry) =>
        entry.direction === "server->client" &&
        entry.message.id === "probe-thread-list"
    );
    assert.deepEqual(threadList.message.result.data, []);
    assert.equal(containsSecretLikeText(JSON.stringify(transcript)), false);
    assert.doesNotMatch(
      JSON.stringify(transcript),
      /codex-app-server-probe-[A-Za-z0-9]+|\.local"|installationId":"[0-9a-f-]{36}/
    );
  }
);
