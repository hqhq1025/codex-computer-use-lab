import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { containsSecretLikeText } from "../lib/redaction.mjs";

const fixtureUrl = new URL(
  "../fixtures/service-lifecycle/latest.json",
  import.meta.url
);
const chapterUrl = new URL(
  "../docs/16-service-process-lifecycle-and-retention.md",
  import.meta.url
);
const reportUrl = new URL(
  "../../codex-app-computer-use-service-lifecycle-readonly-deep-dive.md",
  import.meta.url
);

function assertSafety(evidence) {
  assert.equal(evidence.safety.readOnly, true);
  assert.equal(evidence.safety.realComputerUseSocketConnected, false);
  assert.equal(evidence.safety.realActionTriggered, false);
  assert.equal(evidence.safety.processRestartedOrTerminated, false);
  assert.equal(evidence.safety.installerExecuted, false);
  assert.equal(evidence.safety.tccModified, false);
  assert.equal(evidence.safety.authorizationDbModified, false);
  assert.equal(evidence.safety.rawUnifiedLogsStored, false);
  assert.equal(evidence.safety.screenshotPixelsRead, false);
  assert.equal(evidence.safety.accessibilityTextRead, false);
  assert.equal(evidence.safety.approvalContentsRead, false);
  assert.equal(evidence.safety.eventStreamContentsRead, false);
  assert.equal(evidence.safety.analyticsPayloadsRead, false);
  assert.equal(evidence.safety.networkBodiesRead, false);
}

test("service lifecycle fixture is aggregate-only and redacted", async () => {
  const raw = await readFile(fixtureUrl, "utf8");
  assert.equal(containsSecretLikeText(raw), false);
  assert.doesNotMatch(raw, /\/Users\/[^/$"<\s]+/);
  assert.doesNotMatch(raw, /https?:\/\//i);
  assert.doesNotMatch(raw, /eventMessage|analyticsBody|screenshotPath|approvedBundleIdentifiers/);

  const evidence = JSON.parse(raw);
  assert.equal(evidence.schemaVersion, 1);
  assertSafety(evidence);
  assert.equal(evidence.processTree.skyService.parentPid, evidence.processTree.electronMain.pid);
  assert.equal(evidence.processTree.guardian.parentPid, evidence.processTree.skyService.pid);
  assert.equal(evidence.processTree.separateComputerUseLaunchAgentFound, false);
  assert.equal(evidence.processTree.separateComputerUseLaunchDaemonFound, false);
  assert.equal(evidence.ipc.ordinary.collectorConnected, false);
  assert.equal(evidence.ipc.guardian.connectionLossFailClosedRelock, true);
  assert.equal(evidence.ipc.authorizationBroker.pathnameObservedUnlinkedWhileFdOpen, true);
  assert.equal(evidence.trustBoundary.lockedUse.ready, false);
});

test("lifecycle and retention boundaries remain explicit", async () => {
  const evidence = JSON.parse(await readFile(fixtureUrl, "utf8"));

  assert.equal(evidence.spawnAndRecovery.electronManagerExplicitKillInSelectedClass, false);
  assert.equal(evidence.spawnAndRecovery.nativeLifecycleSymbols.managedCodexOwnerExitSource, true);
  assert.equal(evidence.spawnAndRecovery.currentLifecycleMode, "unknown");
  assert.equal(evidence.spawnAndRecovery.idleTimeoutSeconds, "unknown");
  assert.equal(evidence.retention.screenshots.currentTemporaryFileCount, 0);
  assert.equal(
    evidence.retention.screenshots.productionExperimentCleanup,
    "removed_after_target_app_session_end"
  );
  assert.equal(evidence.retention.skysight.currentSegmentFileCount, 0);
  assert.equal(evidence.retention.eventStream.genericFileAttributedToComputerUse, false);
  assert.equal(evidence.retention.analyticsDatabase.analyticsEventRows, 0);
  assert.equal(evidence.retention.analyticsDatabase.payloadBodiesRead, false);
  assert.equal(evidence.retention.statsigPreferences.valuesCopied, false);
  assert.equal(evidence.runtimeObservability.networkDestinationsCollected, false);
  assert.equal(evidence.runtimeObservability.networkBodiesCollected, false);
  assert.equal(evidence.unknowns.length > 0, true);
});

test("service lifecycle chapter documents safe reproduction pitfalls", async () => {
  const chapter = await readFile(chapterUrl, "utf8");

  assert.match(chapter, /launchd does not independently restart/);
  assert.match(chapter, /managedCodexOwnerExitSource/);
  assert.match(chapter, /listener FD alive != pathname currently connectable/);
  assert.match(chapter, /filter for `has\("timestamp"\)`/);
  assert.match(chapter, /In zsh, `path` is tied to `PATH`/);
  assert.match(chapter, /paths containing spaces are split by/);
  assert.match(chapter, /No `lsof -i` row does not prove no networking/);
});

test("Chinese service report preserves the read-only and unknown boundaries", async () => {
  const report = await readFile(reportUrl, "utf8");

  assert.match(report, /没有独立 launchd daemon/);
  assert.match(report, /managedCodexOwnerExitSource/);
  assert.match(report, /pathname 可以先 unlink/);
  assert.match(report, /total events\s+92,196/);
  assert.match(report, /不能据此判断 disabled/);
  assert.match(report, /- 保存 raw unified log/);
  assert.match(report, /## 25\. Unknown/);
});
