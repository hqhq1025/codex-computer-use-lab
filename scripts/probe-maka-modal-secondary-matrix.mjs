#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "real-cua");
const probe = path.join(
  root,
  "scripts",
  "probe-maka-modal-secondary.mjs"
);
const outputPath = path.join(
  fixtureRoot,
  "maka-modal-secondary.json"
);
const binary = process.env.MAKA_CU_BIN;
if (!binary) {
  throw new Error("MAKA_CU_BIN must name the pinned maka-cu executable");
}

await mkdir(fixtureRoot, { recursive: true });
const sentinelBuild = await mkdtemp(
  path.join(tmpdir(), "maka-foreground-sentinel-")
);
const sentinelBinary = path.join(sentinelBuild, "frontmost-sentinel");
await execFileAsync(
  "xcrun",
  [
    "swiftc",
    path.join(root, "scripts", "frontmost-sentinel.swift"),
    "-o",
    sentinelBinary
  ],
  { timeout: 90_000 }
);
const temporaryOutputs = [];
const runs = [];

try {
  for (let index = 1; index <= 5; index += 1) {
    const runPath = path.join(
      fixtureRoot,
      `.maka-modal-secondary-run-${process.pid}-${index}.json`
    );
    temporaryOutputs.push(runPath);
    await execFileAsync(
      process.execPath,
      [probe],
      {
        cwd: root,
        env: {
          ...process.env,
          MAKA_CU_BIN: binary,
          MAKA_CU_OUTPUT: runPath,
          MAKA_CU_SENTINEL_BIN: sentinelBinary
        },
        encoding: "utf8",
        timeout: 90_000,
        maxBuffer: 1024 * 1024
      }
    );
    const run = JSON.parse(await readFile(runPath, "utf8"));
    if (run.passed !== true) {
      throw new Error(`Maka modal/secondary run ${index} did not pass`);
    }
    runs.push({
      index,
      capturedAt: run.capturedAt,
      modal: run.modal,
      secondary: run.secondary,
      protocol: run.protocol
    });
  }

  const binaryProvenance = JSON.parse(
    await readFile(temporaryOutputs[0], "utf8")
  ).binary;
  const paths = runs.flatMap((run) => [
    run.modal.openPath,
    run.modal.closePath,
    run.secondary.openPath,
    run.secondary.buttonPath,
    run.secondary.scrollPath,
    run.secondary.closePath
  ]);
  const sentinels = runs.flatMap((run) => [
    run.modal.foregroundSentinel,
    run.secondary.foregroundSentinel
  ]);
  const topologyRecoveryEvidenceCount = runs
    .flatMap((run) => [
      run.modal.openVerification,
      run.modal.closeVerification,
      run.secondary.openVerification,
      run.secondary.closeVerification
    ])
    .filter(
      (verification) =>
        verification?.method === "action_result" &&
        verification?.observedChange === true
    ).length;

  const aggregate = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    binary: binaryProvenance,
    runCount: runs.length,
    passed: runs.length === 5,
    summary: {
      allDispatchPathsAxAction: paths.every(
        (dispatchPath) => dispatchPath === "ax_action"
      ),
      targetForegroundSamples: sentinels.reduce(
        (total, sentinel) =>
          total + sentinel.targetForegroundSamples,
        0
      ),
      minimumSentinelSamples: Math.min(
        ...sentinels.map((sentinel) => sentinel.sampleCount)
      ),
      maximumSentinelGapMilliseconds: Math.max(
        ...sentinels.map((sentinel) => sentinel.maxGapMilliseconds)
      ),
      targetRemainedBackgroundAllRuns: sentinels.every(
        (sentinel) => sentinel.targetForegroundSamples === 0
      ),
      topologyRecoveryEvidenceCount
    },
    runs
  };
  if (
    aggregate.passed !== true ||
    aggregate.summary.allDispatchPathsAxAction !== true
  ) {
    throw new Error(
      `Maka modal/secondary aggregate failed: ${JSON.stringify(aggregate.summary)}`
    );
  }
  await writeFile(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      output: outputPath,
      runCount: aggregate.runCount,
      summary: aggregate.summary
    })}\n`
  );
} finally {
  await Promise.all(
    temporaryOutputs.map((runPath) => rm(runPath, { force: true }))
  );
  await rm(sentinelBuild, { recursive: true, force: true });
}
