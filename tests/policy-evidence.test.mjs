import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const fixturePath = path.join(root, "fixtures/policy/evidence.json");
const scriptPath = path.join(root, "scripts/extract-policy-evidence.sh");
const defaultSkyRoot =
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky";
const defaultApp =
  path.join(
    os.homedir(),
    ".codex/computer-use/Codex Computer Use.app"
  );
const defaultAsar = "/Applications/ChatGPT.app/Contents/Resources/app.asar";

async function readEvidence(filePath = fixturePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function transition(evidence, event, from = null) {
  const matches = evidence.stateMachine.transitions.filter(
    (candidate) =>
      candidate.event === event && (from == null || candidate.from === from)
  );
  assert.equal(
    matches.length,
    1,
    `expected one transition for ${from == null ? "" : `${from} -> `}${event}`
  );
  return matches[0];
}

function assertCriticalEvidence(evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.deepEqual(evidence.extraction, {
    nativeStringsPasses: 1,
    nativeSymbolTableScanned: false,
    asarSearchPasses: 1,
    outputReplacement: "same_directory_atomic_rename",
    timestampsCollected: false,
    deterministicForIdenticalInputs: true
  });
  assert.deepEqual(evidence.appPolicy.decisions, [
    "allowed",
    "denied",
    "forbidden"
  ]);
  assert.equal(evidence.stateMachine.actionAllowedOnlyIn, "active_observed");

  const expectedCodes = {
    appNotAllowed: -10006,
    noActiveSession: -10011,
    userStoppedSession: -10012,
    permissionsPending: -10014,
    blockedURL: -10015,
    userIntervened: -10016,
    ambiguousApp: -10018,
    screenLocked: -10020
  };
  for (const [name, code] of Object.entries(expectedCodes)) {
    assert.equal(evidence.serverErrorCodes[name], code, name);
  }

  assert.equal(
    evidence.appPolicy.persistentApprovalOfferedOnlyWhenPolicyAllows,
    true
  );
  assert.deepEqual(evidence.approvals.modes, ["session", "always"]);
  assert.equal(evidence.approvals.contentsCollected, false);
}

test("checked fixture captures critical policy and error evidence", async () => {
  const evidence = await readEvidence();
  assertCriticalEvidence(evidence);

  assert.equal(evidence.privacy.approvalStoreContentsRead, false);
  assert.equal(evidence.privacy.approvalStorePathProbed, false);
  assert.equal(evidence.privacy.urlHistoryRead, false);
  assert.equal(evidence.privacy.browserHistoryRead, false);
  assert.equal(evidence.privacy.userAppInventoryRead, false);
  assert.equal(evidence.privacy.realCuaSocketConnected, false);
  assert.equal(evidence.privacy.uiActionsExecuted, false);
});

test("policy and approval gates remain fail closed", async () => {
  const evidence = await readEvidence();

  for (const event of [
    "policy_allowed",
    "policy_denied",
    "policy_forbidden",
    "approval_always_persistence_failed",
    "approval_declined_or_canceled"
  ]) {
    assert.equal(transition(evidence, event).failClosed, true, event);
  }

  assert.equal(transition(evidence, "policy_allowed").to, "approval_gate");
  assert.equal(
    transition(evidence, "policy_denied").effect,
    "no_action"
  );
  assert.equal(
    transition(evidence, "policy_forbidden").effect,
    "no_action"
  );
  assert.equal(
    transition(evidence, "approval_always_persistence_failed").effect,
    "no_action_no_silent_session_downgrade"
  );
});

test("runtime blockers require the documented recovery transition", async () => {
  const evidence = await readEvidence();

  const noSession = transition(
    evidence,
    "action_requested",
    "authorized_unobserved"
  );
  assert.equal(noSession.errorName, "noActiveSession");
  assert.equal(noSession.effect, "no_action");
  assert.equal(noSession.recovery, "get_app_state");

  const blockedUrl = transition(evidence, "blocked_url");
  assert.equal(blockedUrl.errorCode, -10015);
  assert.equal(blockedUrl.sameSessionRetry, false);
  assert.equal(blockedUrl.failClosed, true);

  const userStopped = transition(evidence, "user_stopped_session");
  assert.equal(userStopped.sameTurnRetry, false);
  assert.equal(userStopped.recovery, "next_assistant_turn");

  const intervention = transition(evidence, "user_input_detected");
  assert.equal(intervention.recovery, "wait_then_reobserve");
  assert.equal(intervention.effect, "no_action");

  const reobserved = transition(
    evidence,
    "get_app_state_succeeded",
    "reobserve_required"
  );
  assert.equal(reobserved.to, "active_observed");
  assert.match(reobserved.effect, /intervention_cleared/);

  const locked = transition(evidence, "screen_locked");
  assert.equal(locked.errorCode, -10020);
  assert.equal(locked.recovery, "unlock_then_get_app_state");

  const ambiguous = transition(evidence, "ambiguous_app");
  assert.equal(ambiguous.errorCode, -10018);
  assert.equal(ambiguous.recovery, "use_app_name_or_full_path");

  const stale = transition(evidence, "stale_element_missing_or_ambiguous");
  assert.equal(stale.effect, "no_action");
  assert.equal(stale.recovery, "get_app_state");
  assert.equal(stale.failClosed, true);

  const securityProcess = transition(evidence, "system_security_process");
  assert.equal(securityProcess.effect, "no_action");
  assert.equal(securityProcess.failClosed, true);
});

test("unknown private lists stay empty instead of being guessed", async () => {
  const evidence = await readEvidence();

  for (const rule of Object.values(evidence.nativeRules)) {
    assert.equal(rule.listRecovered, false);
    assert.deepEqual(rule.entries, []);
    assert.match(rule.boundary, /not_|no_|runtime_/);
  }

  assert.equal(
    evidence.nativeRules.systemSecurityProcesses.classifierMarkerPresent,
    true
  );
  assert.equal(
    evidence.nativeRules.defaultBlockedUrls.remotePolicyCheckerPresent,
    true
  );
  assert.equal(
    evidence.nativeRules.defaultBlockedUrls.failClosedStopMessagePresent,
    true
  );
});

test("collector source has no user approval, URL history, app inventory, or live action path", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(source, /Library\/Group Containers/);
  assert.doesNotMatch(source, /\b(?:cat|sed|awk|jq)\b[^\n]*ComputerUseAppApprovals\.json/);
  assert.doesNotMatch(source, /\b(?:mdfind|lsregister)\b/);
  assert.doesNotMatch(source, /find\s+\/Applications/);
  assert.doesNotMatch(source, /\blog\s+show\b/);
  assert.doesNotMatch(
    source,
    /Library\/Application Support\/[^\n]*(?:History|History-journal)/
  );
  assert.doesNotMatch(source, /computeruse\.sock/);
  assert.doesNotMatch(source, /\b(?:nc|ncat|socat)\b/);
  assert.doesNotMatch(source, /createConnection\s*\(/);
  assert.doesNotMatch(source, /\bnm\b/);
  assert.match(source, /strings -a -n 4/);
  assert.match(source, /rg -a -o -F -f/);
  assert.match(source, /mv -f "\$TMP_OUT" "\$OUT"/);
});

test(
  "live static extraction is fast, deterministic, and atomically replaceable",
  {
    skip:
      process.platform !== "darwin" ||
      !existsSync(defaultSkyRoot) ||
      !existsSync(defaultApp) ||
      !existsSync(defaultAsar),
    timeout: 90_000
  },
  async (t) => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "codex-cu-policy-test-")
    );
    const firstPath = path.join(temporaryDirectory, "first.json");
    const secondPath = path.join(temporaryDirectory, "second.json");
    const atomicPath = path.join(temporaryDirectory, "atomic.json");
    t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

    const firstStart = performance.now();
    const firstRun = await execFileAsync(
      "bash",
      [scriptPath, "--out", firstPath],
      {
        cwd: root,
        timeout: 20_000,
        maxBuffer: 1024 * 1024
      }
    );
    const firstDurationMs = performance.now() - firstStart;
    assert.ok(
      firstDurationMs < 15_000,
      `first extraction took ${Math.round(firstDurationMs)}ms`
    );
    assert.doesNotMatch(
      `${firstRun.stdout}\n${firstRun.stderr}`,
      /\/Users\//
    );

    await execFileAsync("bash", [scriptPath, "--out", secondPath], {
      cwd: root,
      timeout: 20_000,
      maxBuffer: 1024 * 1024
    });

    const firstRaw = await readFile(firstPath, "utf8");
    const secondRaw = await readFile(secondPath, "utf8");
    assert.equal(secondRaw, firstRaw);

    const evidence = JSON.parse(firstRaw);
    assertCriticalEvidence(evidence);
    assert.equal(evidence.sources.publicCodexSource.inspected, false);

    const outputStat = await stat(firstPath);
    assert.equal(outputStat.mode & 0o077, 0);
    assert.ok(outputStat.size < 40 * 1024);

    await writeFile(atomicPath, '{"generation":"old"}\n', { mode: 0o600 });
    const child = spawn("bash", [scriptPath, "--out", atomicPath], {
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

    while (!exited) {
      const snapshot = await readFile(atomicPath, "utf8");
      assert.doesNotThrow(() => JSON.parse(snapshot));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const result = await exit;
    assert.equal(
      result.code,
      0,
      `collector exited via ${result.signal ?? "unknown signal"}\n${stderr}`
    );
    assert.doesNotMatch(`${stdout}\n${stderr}`, /\/Users\//);
    assert.equal(await readFile(atomicPath, "utf8"), firstRaw);
  }
);
