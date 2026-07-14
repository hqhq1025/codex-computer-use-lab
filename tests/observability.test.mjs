import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { containsSecretLikeText } from "../lib/redaction.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const scriptPath = path.join(root, "scripts/collect-observability-evidence.sh");
const fixturePath = path.join(root, "fixtures/observability/latest.json");

function assertPrivacyBoundary(evidence) {
  assert.equal(evidence.safety.defaultRedaction, true);
  assert.equal(evidence.safety.screenshotPixelsRead, false);
  assert.equal(evidence.safety.eventStreamContentsRead, false);
  assert.equal(evidence.safety.urlsRead, false);
  assert.equal(evidence.safety.analyticsBodiesRead, false);
  assert.equal(evidence.safety.privateLogsRead, false);
  assert.equal(evidence.safety.realCuaSocketConnected, false);
  assert.equal(evidence.safety.analyticsDatabaseQueried, false);
  assert.equal(evidence.safety.networkRequestsCaptured, false);
}

function assertBoundaryModel(evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.staticBoundaries.screenshotFileIsNotAppshotStore, true);
  assert.equal(evidence.staticBoundaries.appshotIsCaptureUxWithInMemoryStore, true);
  assert.equal(evidence.staticBoundaries.skysightSubscribesToEventStreamCapture, true);
  assert.equal(evidence.staticBoundaries.eventStreamHasIndependentStartStatusStopRequests, true);
  assert.equal(evidence.staticBoundaries.pipUsesIndependentXpcPresentationChannel, true);
  assert.equal(evidence.staticBoundaries.compiledCodeDoesNotProveCurrentEnablement, true);

  assert.equal(evidence.pathTemplates.screenshotTemporaryFile.lifecycle.creation, "confirmed");
  assert.equal(evidence.pathTemplates.screenshotTemporaryFile.lifecycle.cleanupTime, "unknown");
  assert.equal(evidence.pathTemplates.appshot.captureStore, "in_memory");
  assert.equal(evidence.pathTemplates.skysightSegments.staticDescription, "ephemeral_not_persisted");
  assert.equal(evidence.pathTemplates.eventStreamRecording.exactRootName, "unknown");

  assert.equal(evidence.gates.appshot.currentEnabled, "unknown");
  assert.equal(evidence.gates.pip.currentEnabled, "unknown");
  assert.equal(evidence.gates.skysight.currentRecording, "unknown");
  assert.equal(evidence.gates.eventStream.currentRecording, "unknown");
  assert.equal(evidence.gates.analytics.currentNetworkSending, "unknown");
  assert.equal(
    evidence.gates.analytics.productWideAnalyticsOptOut,
    "not_confirmed_in_selected_static_surfaces"
  );
  assert.equal(
    evidence.shippedResources.skysightSummarizer.observedContentTrust,
    "highly_untrusted"
  );
  assert.equal(evidence.shippedResources.skysightSummarizer.taintPropagation, "sticky");
  assert.equal(evidence.shippedResources.skysightSummarizer.bodyIncludedInFixture, false);
  assert.equal(
    evidence.shippedResources.skysightMemoryInstructions.bodyIncludedInFixture,
    false
  );
  assert.equal(
    evidence.runtime.processes.identification,
    "exact_ps_comm_executable_path"
  );
}

async function exactExecutableCount(executable) {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,comm="], {
    maxBuffer: 1024 * 1024
  });
  return stdout.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*\d+\s+(.+)$/);
    return match?.[1] === executable;
  }).length;
}

function assertNoSensitiveOutput(text) {
  assert.equal(containsSecretLikeText(text), false);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /"(?:url|body|prompt|eventContent|analyticsBody)"\s*:/i);
  assert.doesNotMatch(text, /\/Users\/[^/$"<\s]+/);
  assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9._-]+/i);
}

test("checked observability fixture is aggregate-only and redacted", async () => {
  const raw = await readFile(fixturePath, "utf8");
  assertNoSensitiveOutput(raw);
  const evidence = JSON.parse(raw);

  assertPrivacyBoundary(evidence);
  assertBoundaryModel(evidence);
  assert.deepEqual(
    evidence.requestTypes,
    [
      "ComputerUseClient.ComputerUseIPCEventStreamStartRequest",
      "ComputerUseClient.ComputerUseIPCEventStreamStatusRequest",
      "ComputerUseClient.ComputerUseIPCEventStreamStopRequest",
      "ComputerUseClient.ComputerUseIPCSkysightStartRequest",
      "ComputerUseClient.ComputerUseIPCSkysightStatusRequest",
      "ComputerUseClient.ComputerUseIPCSkysightStopRequest",
      "ComputerUseClient.ComputerUseIPCSkysightUpdateExclusionRequest",
      "ComputerUseClient.ComputerUseIPCSkysightListExclusionsRequest"
    ]
  );

  for (const aggregate of Object.values(evidence.runtime.metadataAggregates)) {
    assert.equal(Number.isInteger(aggregate.count), true);
    assert.equal(Number.isInteger(aggregate.sizeBytes.total), true);
    assert.equal(Array.isArray(aggregate.owners), true);
    assert.equal(Array.isArray(aggregate.modes), true);
    assert.equal("paths" in aggregate, false);
    assert.equal("names" in aggregate, false);
  }
});

test("collector source has no content, socket, database-query, or network capture path", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(source, /\bsqlite3\b/i);
  assert.doesNotMatch(source, /\blog\s+show\b/i);
  assert.doesNotMatch(source, /\bcurl\b|\bwget\b|\bnc\b|\bncat\b|\bsocat\b/i);
  assert.doesNotMatch(source, /--unix-socket/i);
  assert.doesNotMatch(source, /\b(?:cat|head|tail|sed|awk)\b[^\n]*(?:events\.jsonl|Analytics\.db|screenshot_)/i);
  assert.doesNotMatch(source, /(?:readFile|createReadStream|openSync)\s*\([^\n]*(?:events\.jsonl|Analytics\.db|screenshot_)/i);
  assert.doesNotMatch(source, /lsof[^\n]*-i/i);
  assert.doesNotMatch(source, /ps -axo pid=,command=/);
  assert.match(source, /find "\$SKYSIGHT_ROOT"[^\n]*-maxdepth/);
  assert.match(source, /lsof -n -P -Fn -p/);
  assert.match(source, /stat -f/);
  assert.match(source, /ps -axo pid=,comm=/);
  assert.match(source, /if \(\$0 == executable\) print pid/);
  assert.match(source, /mktemp "\$OUT_DIR\/\.observability\.XXXXXX"/);
  assert.match(source, /mv -f "\$TEMP_OUT" "\$OUT"/);
  assert.match(source, /highly untrusted observed content/);
  assert.match(source, /Untrusted taint is sticky/);
});

test("fresh collection is atomic and counts only the exact Sky executable", { timeout: 120_000 }, async (t) => {
  if (process.platform !== "darwin") {
    t.skip("live collector is macOS-specific");
    return;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-cu-observability-"));
  const outputPath = path.join(temporaryDirectory, "observability.json");
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  await writeFile(outputPath, '{"generation":"old"}\n', { mode: 0o600 });

  const child = spawn(
    "bash",
    [scriptPath, "--out", outputPath],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let exited = false;
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => {
    if (!exited) {
      child.kill("SIGTERM");
    }
  });

  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  while (!exited) {
    const snapshot = await readFile(outputPath, "utf8");
    assert.doesNotThrow(() => JSON.parse(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const result = await exit;
  assert.equal(result.code, 0, `collector exited via ${result.signal ?? "unknown signal"}`);
  assertNoSensitiveOutput(`${stdout}\n${stderr}`);

  const raw = await readFile(outputPath, "utf8");
  assertNoSensitiveOutput(raw);
  const evidence = JSON.parse(raw);
  assertPrivacyBoundary(evidence);
  assertBoundaryModel(evidence);
  const skyExecutable = path.join(
    os.homedir(),
    ".codex",
    "computer-use",
    "Codex Computer Use.app",
    "Contents",
    "MacOS",
    "SkyComputerUseService"
  );
  assert.equal(
    evidence.runtime.processes.skyServiceCount,
    await exactExecutableCount(skyExecutable)
  );
});
