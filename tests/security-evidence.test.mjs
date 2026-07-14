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
const scriptPath = path.join(root, "scripts/collect-readonly-security-evidence.sh");
const fixturePath = path.join(root, "fixtures/security/latest.json");

const additionalSecretPatterns = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN OPENSSH PRIVATE KEY-----/,
  /"(?:apiKey|accessToken|refreshToken|password|secret)"\s*:\s*"(?!<redacted>)[^"]+"/i
];

function assertNoSecretPatterns(text) {
  assert.equal(containsSecretLikeText(text), false);
  for (const pattern of additionalSecretPatterns) {
    assert.doesNotMatch(text, pattern);
  }
}

function assertFailClosedEvidence(evidence) {
  assert.equal(evidence.safety.defaultRedaction, true);
  assert.equal(evidence.safety.tccModified, false);
  assert.equal(evidence.safety.authorizationDbModified, false);
  assert.equal(evidence.safety.installerExecuted, false);
  assert.equal(evidence.safety.realCuaSocket.connected, false);
  assert.equal(evidence.safety.realCuaSocket.written, false);
  assert.equal(evidence.lockScreen.collectorDecision, "fail_closed");
  assert.equal(evidence.lockScreen.readyForLockedComputerUse, false);
  assert.equal(evidence.requirements.collectorDecision, "fail_closed");
  assert.notEqual(evidence.requirements.effectiveAllowLockedComputerUse, "true");
  assert.equal(evidence.freshness.coordinateDecision, "fail_closed_without_fresh_observation");
  assert.equal(evidence.mockVsReal.provesActionPathWorks, false);
}

function assertKeyPermissionEvidence(evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.codeSignature.validOnDisk, true);
  assert.equal(evidence.codeSignature.hardenedRuntime, true);
  assert.equal(evidence.codeSignature.notarizedDeveloperId, true);
  assert.equal(evidence.entitlements.appSandbox, false);
  assert.equal(evidence.entitlements.appGroupPresent, true);
  assert.equal(evidence.entitlements.keychainAccessGroupPresent, true);
  assert.equal(evidence.provisionProfile.present, true);
  assert.equal(evidence.tcc.accessibility.state, "allowed");
  assert.equal(evidence.tcc.screenCapture.state, "allowed");
  assert.equal(evidence.ipc.secureModeCheck, true);
  assert.equal(evidence.peerIdentity.lockScreenPluginReadsAuditToken, true);
  assert.equal(evidence.peerIdentity.lockScreenPluginChecksSigningIdentifier, true);
  assert.equal(evidence.peerIdentity.lockScreenPluginChecksTeamIdentifier, true);
  assert.equal(evidence.peerIdentity.lockScreenPluginRejectsIdentityMismatch, true);
  assert.equal(evidence.lockScreen.worldWritableSocketReliesOnPeerIdentity, true);
  assert.equal(evidence.requirements.effectiveRequirementsRpcQueried, true);
  assert.equal(evidence.freshness.ambiguousRefetchRejectedStringPresent, true);
}

test("checked security fixture is complete, redacted, and fail closed", async () => {
  const raw = await readFile(fixturePath, "utf8");
  assertNoSecretPatterns(raw);
  const evidence = JSON.parse(raw);

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.safety.defaultRedaction, true);
  assert.equal(evidence.privacy.rawUnifiedLogsCollected, false);
  assert.equal(evidence.privacy.promptBodiesCollected, false);
  assert.equal(evidence.privacy.appApprovalListCollected, false);
  assertFailClosedEvidence(evidence);
});

test("collector source contains no mutation or real-socket client path", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(source, /\btccutil\s+(?:reset|insert|delete|modify)\b/i);
  assert.doesNotMatch(source, /\bauthorizationdb\s+write\b/i);
  assert.doesNotMatch(source, /CodexComputerUseAuthorizationPluginInstallerTool["']?\s*(?:install|uninstall)?/);
  assert.doesNotMatch(source, /\b(?:nc|ncat|socat)\b[^\n]*computeruse\.sock/i);
  assert.doesNotMatch(source, /curl[^\n]*--unix-socket[^\n]*computeruse\.sock/i);
  assert.doesNotMatch(source, /(?:createConnection|connect)\s*\([^\n]*computeruse\.sock/i);
  assert.match(source, /sqlite3 -readonly/);
  assert.match(source, /authorizationdb read system\.login\.console/);
});

test("fresh collection remains redacted and fail closed", { timeout: 90_000 }, async (t) => {
  if (process.platform !== "darwin") {
    t.skip("live collector is macOS-specific");
    return;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-cu-security-test-"));
  const outputPath = path.join(temporaryDirectory, "security.json");
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const { stdout, stderr } = await execFileAsync("bash", [scriptPath, "--out", outputPath], {
    cwd: root,
    timeout: 85_000,
    maxBuffer: 1024 * 1024
  });
  assertNoSecretPatterns(`${stdout}\n${stderr}`);

  const raw = await readFile(outputPath, "utf8");
  assertNoSecretPatterns(raw);
  const evidence = JSON.parse(raw);
  assert.equal(evidence.privacy.rawUnifiedLogsCollected, false);
  assert.equal(evidence.privacy.promptBodiesCollected, false);
  assert.equal(evidence.privacy.appApprovalListCollected, false);
  assertKeyPermissionEvidence(evidence);
  assertFailClosedEvidence(evidence);
});

test("fixture replacement is atomic for concurrent readers", { timeout: 90_000 }, async (t) => {
  if (process.platform !== "darwin") {
    t.skip("live collector is macOS-specific");
    return;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-cu-security-atomic-"));
  const outputPath = path.join(temporaryDirectory, "security.json");
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  await writeFile(outputPath, '{"generation":"old"}\n', { mode: 0o600 });

  const child = spawn("bash", [scriptPath, "--out", outputPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
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

  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  const killTimer = setTimeout(() => child.kill("SIGTERM"), 85_000);
  killTimer.unref();

  while (!exited) {
    const snapshot = await readFile(outputPath, "utf8");
    assert.doesNotThrow(() => JSON.parse(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const result = await exit;
  clearTimeout(killTimer);
  assert.equal(result.code, 0, `collector exited via ${result.signal ?? "unknown signal"}`);
  assertNoSecretPatterns(`${stdout}\n${stderr}`);

  const finalRaw = await readFile(outputPath, "utf8");
  assertNoSecretPatterns(finalRaw);
  const finalEvidence = JSON.parse(finalRaw);
  assertKeyPermissionEvidence(finalEvidence);
  assertFailClosedEvidence(finalEvidence);
});
