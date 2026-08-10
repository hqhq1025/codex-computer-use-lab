import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL(
  "../fixtures/real-cua/maka-web-matrix.json",
  import.meta.url
);
const probeUrl = new URL(
  "../scripts/probe-maka-web-matrix.mjs",
  import.meta.url
);

test("Maka Web matrix is source-bound, normalized, and fully passing", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.source.dirty, false);
  assert.match(fixture.source.commit, /^[0-9a-f]{40}$/);
  assert.equal(fixture.source.buildCommand, "swift build -c release");
  assert.equal(
    fixture.binary.path,
    "<maka-cu-source>/.build/release/OpenComputerUse"
  );
  assert.match(fixture.binary.sha256, /^[0-9a-f]{64}$/);
  assert.equal(fixture.runCount, 5);
  assert.equal(fixture.passed, true);
  assert.deepEqual(fixture.summary.primaryClickCounts, [1, 1, 1, 1, 1]);
  assert.deepEqual(
    fixture.summary.oopPaths,
    Array(5).fill("skylight_pid")
  );
  assert.equal(fixture.summary.oopTrustedAllRuns, true);
  assert.equal(fixture.summary.oopSinglePairAllRuns, true);
  assert.deepEqual(fixture.summary.sliderValues, [42, 42, 42, 42, 42]);
  assert.deepEqual(fixture.summary.scrollOffsets, [76, 76, 76, 76, 76]);
  assert.equal(fixture.summary.uniqueRefetchWrongTargetClicks, 0);
  assert.equal(fixture.summary.missingRefetchWrongTargetClicks, 0);
  assert.equal(fixture.summary.targetRemainedBackgroundAllRuns, true);
  assert.equal(fixture.summary.targetForegroundSamples, 0);
  assert.ok(fixture.summary.minimumSentinelSamples >= 5);
  assert.ok(fixture.summary.maximumSentinelGapMilliseconds <= 250);

  for (const run of fixture.runs) {
    assert.equal(run.primary.buttonClickCount, 1);
    assert.equal(run.primary.path, "ax_action");
    assert.equal(run.primary.foregroundSentinel.targetForegroundSamples, 0);
    assert.equal(run.uniqueRefetch.staleTargetClickCount, 1);
    assert.equal(run.uniqueRefetch.wrongTargetClickCount, 0);
    assert.equal(
      run.uniqueRefetch.foregroundSentinel.targetForegroundSamples,
      0
    );
    assert.equal(run.missingRefetch.staleTargetClickCount, 0);
    assert.equal(run.missingRefetch.wrongTargetClickCount, 0);
    assert.equal(
      run.missingRefetch.foregroundSentinel.targetForegroundSamples,
      0
    );
    assert.equal(run.slider.value, 42);
    assert.equal(run.slider.foregroundSentinel.targetForegroundSamples, 0);
    assert.equal(run.scroll.offset, 76);
    assert.equal(run.scroll.foregroundSentinel.targetForegroundSamples, 0);
    assert.equal(run.oop.path, "skylight_pid");
    assert.equal(run.oop.isTrusted, true);
    assert.equal(run.oop.mouseDownCount, 1);
    assert.equal(run.oop.mouseUpCount, 1);
    assert.notEqual(run.oop.hostPid, run.oop.webContentPid);
    assert.equal(run.oop.foregroundSentinel.targetForegroundSamples, 0);
  }
});

test("Maka Web probe builds only a clean source revision", async () => {
  const source = await readFile(probeUrl, "utf8");

  assert.match(source, /MAKA_CU_SOURCE_DIR/);
  assert.match(source, /git", \["status", "--porcelain"\]/);
  assert.match(source, /swift", \["build", "-c", "release"\]/);
  assert.match(source, /<maka-cu-source>\/\.build\/release\/OpenComputerUse/);
  assert.doesNotMatch(source, /\/Users\/[^/]+/);
});
