import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_NODE_REPL_BINARY,
  PNG_1X1_BASE64,
  assertSafeProbeSource,
  buildIsolatedEnv,
  runProbe
} from "../scripts/node-repl-mcp-probe.mjs";

test("isolated environment does not inherit trusted bridge configuration", () => {
  const env = buildIsolatedEnv({
    homeDir: "/tmp/node-repl-test-home",
    nodeBinary: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
  });

  assert.deepEqual(Object.keys(env).sort(), [
    "HOME",
    "NODE_REPL_DISABLE_ANALYTICS",
    "NODE_REPL_NODE_PATH",
    "NODE_REPL_UNTRUSTED_ENV_ALLOWLIST",
    "NO_COLOR",
    "PATH",
    "TMPDIR"
  ]);
  for (const name of [
    "CODEX_CLI_PATH",
    "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
    "NODE_REPL_TRUSTED_CODE_PATHS",
    "NODE_REPL_TRUST_ALL_CODE",
    "NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS"
  ]) {
    assert.equal(Object.hasOwn(env, name), false, `${name} must stay absent`);
  }
});

test("source guard rejects real wrappers and privileged operations", () => {
  const rejected = [
    'await import("@oai/sky")',
    'await import("./computer-use-wrapper.mjs")',
    'nodeRepl.nativePipe.createConnection("/tmp/example.sock")',
    'nodeRepl.createElicitation({ message: "approve" })',
    'nodeRepl.launchServices.openApplication({ bundleIdentifier: "x" })',
    "nodeRepl.withSuspendedTimeout(async () => {})",
    'nodeRepl.fetch("https://example.com")',
    '"/tmp/computeruse.sock"'
  ];

  for (const code of rejected) {
    assert.throws(
      () => assertSafeProbeSource({ name: "unsafe-test", code }),
      /contains/u
    );
  }
});

test("saved node_repl fixtures are sanitized and internally consistent", async () => {
  const [summaryText, transcriptText] = await Promise.all([
    readFile(new URL("../fixtures/node-repl/probe.json", import.meta.url), "utf8"),
    readFile(
      new URL("../fixtures/node-repl/transcript.json", import.meta.url),
      "utf8"
    )
  ]);
  const summary = JSON.parse(summaryText);
  const transcript = JSON.parse(transcriptText);

  assert.deepEqual(
    summary.tools.map((tool) => tool.name),
    ["js", "js_add_node_module_dir", "js_reset"]
  );
  assert.equal(summary.ordinaryCell.globalProcessType, "undefined");
  assert.equal(summary.ordinaryCell.envFrozen, true);
  assert.deepEqual(summary.ordinaryCell.envKeys, []);
  assert.equal(summary.processDenial.imports.process.blocked, true);
  assert.equal(summary.processDenial.imports["node:process"].blocked, true);
  assert.deepEqual(summary.persistentBinding, {
    firstCall: 41,
    secondCall: 42
  });
  assert.equal(summary.ordinaryCell.envFrozen, true);
  assert.deepEqual(summary.ordinaryCell.envKeys, []);
  assert.equal(summary.emitImage.mimeType, "image/png");
  assert.equal(
    summary.emitImage.bytes,
    Buffer.from(PNG_1X1_BASE64, "base64").length
  );
  assert.deepEqual(
    {
      width: summary.emitImage.width,
      height: summary.emitImage.height
    },
    { width: 1, height: 1 }
  );
  assert.equal(summary.safety.realWrapperLoaded, false);
  assert.equal(summary.safety.nativeSocketOpened, false);

  const serializedTranscript = JSON.stringify(transcript);
  assert.doesNotMatch(serializedTranscript, /@oai\/sky/u);
  assert.doesNotMatch(serializedTranscript, /computeruse\.sock/iu);
  assert.doesNotMatch(serializedTranscript, /iVBORw0KGgo/u);
  assert.match(serializedTranscript, /<probe:ordinary-surface sha256:/u);
});

test("live MCP probe confirms the ordinary-cell trust boundary", async (t) => {
  try {
    await access(DEFAULT_NODE_REPL_BINARY);
  } catch {
    t.skip(`installed node_repl not found at ${DEFAULT_NODE_REPL_BINARY}`);
    return;
  }

  const { summary, transcript, stderr } = await runProbe({ timeoutMs: 10_000 });
  assert.equal(stderr, "");
  assert.equal(summary.transport.protocolVersion, "2025-06-18");
  assert.deepEqual(
    summary.tools.map((tool) => tool.name),
    ["js", "js_add_node_module_dir", "js_reset"]
  );
  assert.deepEqual(summary.persistentBinding, {
    firstCall: 41,
    secondCall: 42
  });
  for (const state of Object.values(summary.ordinaryCell.privileged)) {
    assert.deepEqual(state, {
      visible: false,
      own: false,
      type: "undefined"
    });
  }
  assert.equal(summary.processDenial.imports.process.blocked, true);
  assert.equal(summary.processDenial.imports["node:process"].blocked, true);
  assert.equal(summary.emitImage.mimeType, "image/png");
  assert.deepEqual(
    {
      width: summary.emitImage.width,
      height: summary.emitImage.height
    },
    { width: 1, height: 1 }
  );
  assert.equal(summary.safety.unexpectedServerRequests, 0);
  assert.ok(transcript.messages.length >= 14);
});
