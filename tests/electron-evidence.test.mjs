import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/electron/evidence.json", import.meta.url);
const scriptPath = new URL(
  "../scripts/extract-electron-cu-evidence.mjs",
  import.meta.url
).pathname;
const appAsar = "/Applications/ChatGPT.app/Contents/Resources/app.asar";

async function readFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function topicsById(evidence) {
  return new Map(evidence.staticEvidence.map((topic) => [topic.id, topic]));
}

test("fixture covers the Computer Use Electron lifecycle", async () => {
  const evidence = await readFixture();
  const topics = topicsById(evidence);
  const requiredTopics = [
    "bundled-cache-materialization",
    "node-repl-content-variant",
    "local-to-bundled-migration",
    "config-batch-write",
    "legacy-mcp-disabled",
    "canonical-service-sync",
    "managed-service-spawn",
    "approval-result-persistence",
    "approval-store",
    "app-approval-ui",
    "locked-use-installer",
    "settings-locked-use",
    "settings-sound-modes",
    "settings-pip"
  ];

  for (const topicId of requiredTopics) {
    assert.ok(topics.has(topicId), `missing evidence topic ${topicId}`);
    const topic = topics.get(topicId);
    assert.ok(topic.context.includes(topic.anchor));
    for (const marker of topic.markers) {
      assert.ok(
        topic.context.includes(marker),
        `${topicId} context is missing marker ${marker}`
      );
    }
  }
});

test("fixture ties static logic to the current installed state", async () => {
  const evidence = await readFixture();
  const { runtime } = evidence;

  assert.equal(runtime.bundledPlugin.sourceBundledContentVariant, null);
  assert.equal(runtime.bundledPlugin.cachedBundledContentVariant, "node-repl");
  assert.equal(runtime.bundledPlugin.cachedNodeReplSkillExists, true);
  assert.equal(runtime.config.legacyComputerUse.enabled, false);
  assert.equal(runtime.config.plugin.enabled, true);
  assert.match(
    runtime.config.nodeReplEnv.SKY_CUA_SERVICE_PATH,
    /^\$HOME\/\.codex\/plugins\/cache\/openai-bundled\/computer-use\//
  );
  assert.equal(runtime.service.sourceEqualsCache, true);
  assert.equal(runtime.service.cacheEqualsCanonical, true);
  assert.equal(
    runtime.service.processes.appServer.parentIsElectronMain,
    true
  );
  assert.equal(
    runtime.service.processes.skyService.parentIsElectronMain,
    true
  );
  assert.match(runtime.lockedUse.installerStatus, /^OK: (?:not-)?installed$/);
  assert.equal(runtime.approvals.contentsCollected, false);
});

test("fixture remains a small targeted extraction", async () => {
  const evidence = await readFixture();
  const fixtureStat = await stat(fixtureUrl);
  const selectedFiles = Object.values(evidence.source.selectedFiles);

  assert.ok(fixtureStat.size < 100 * 1024, "fixture should stay below 100 KiB");
  assert.equal(selectedFiles.length, 3);
  assert.ok(
    selectedFiles.every(
      (file) =>
        !file.path.includes("locales") &&
        !/webview\/assets\/[a-z]{2}(?:-[A-Z]{2})?-/.test(file.path)
    ),
    "extractor must not select localization bundles"
  );
  assert.ok(
    selectedFiles.reduce((total, file) => total + file.bytes, 0) <
      evidence.source.asarBytes / 10,
    "selected source files should be a small fraction of the ASAR"
  );
});

test(
  "live extractor reproduces the critical anchors",
  { skip: !existsSync(appAsar) },
  async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "electron-cu-evidence-")
    );
    const outputPath = path.join(temporaryDirectory, "evidence.json");
    try {
      const result = spawnSync(
        process.execPath,
        [scriptPath, "--asar", appAsar, "--out", outputPath],
        {
          encoding: "utf8",
          timeout: 30000
        }
      );
      assert.equal(result.status, 0, result.stderr);

      const evidence = JSON.parse(await readFile(outputPath, "utf8"));
      const topics = topicsById(evidence);
      assert.equal(
        topics.get("node-repl-content-variant").role,
        "main"
      );
      assert.equal(topics.get("app-approval-ui").role, "approval-ui");
      assert.equal(
        evidence.runtime.config.legacyComputerUse.enabled,
        false
      );
      assert.equal(
        evidence.runtime.bundledPlugin.cachedBundledContentVariant,
        "node-repl"
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
);
