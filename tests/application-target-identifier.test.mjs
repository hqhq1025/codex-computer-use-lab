import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  runApplicationTargetIdentifierStaticProbe
} from "../scripts/application-target-identifier-static-probe.mjs";

const staticFixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/native/application-target-identifier-static.json",
      import.meta.url
    ),
    "utf8"
  )
);

const behaviorFixture = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/native/application-target-identifier-behavior.json",
      import.meta.url
    ),
    "utf8"
  )
);

test("live static probe reproduces identifier(for:) call sequence", async () => {
  const live = await runApplicationTargetIdentifierStaticProbe();
  assert.deepEqual(live, staticFixture);
  assert.equal(
    live.service.sha256,
    "27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58"
  );
  assert.equal(live.addresses.implementationBody, "0x1001e9128");
  assert.deepEqual(
    live.imports.map(({ api }) => api),
    [
      "Foundation.URL.resolvingSymlinksInPath()",
      "Foundation.URL.standardizedFileURL",
      "Foundation.URL.path(percentEncoded:)",
      "Swift.String.count",
      "Swift.String.index(before:)",
      "Swift.String.remove(at:)",
      "Swift.String.hasSuffix(_:)"
    ]
  );
});

test("Swift behavior probe reproduces the checked collision matrix", async () => {
  const outputPath = path.join(
    os.tmpdir(),
    `application-target-identifier-${process.pid}.json`
  );
  try {
    execFileSync(
      "swift",
      [
        new URL(
          "../scripts/application-target-identifier-probe.swift",
          import.meta.url
        ).pathname,
        "--out",
        outputPath
      ],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024
      }
    );
    const live = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(live, behaviorFixture);
  } finally {
    await rm(outputPath, { force: true });
  }
});

test("identifier aliases converge while separate install paths do not", () => {
  assert.equal(behaviorFixture.contracts.symlinkAliasConverges, true);
  assert.equal(behaviorFixture.contracts.dotSegmentsConverge, true);
  assert.equal(behaviorFixture.contracts.percentEncodedSpaceDecodes, true);
  assert.equal(behaviorFixture.contracts.trailingSlashRemoved, true);
  assert.equal(behaviorFixture.contracts.rootSlashPreserved, true);
  assert.equal(
    behaviorFixture.contracts.sameBundleIdDifferentPathsRemainDistinct,
    true
  );
});

test("bundle identifier resolution fails closed instead of picking arbitrarily", () => {
  assert.equal(
    staticFixture.resolutionContracts.identifierCachedAtTargetInitialization,
    true
  );
  assert.equal(staticFixture.resolutionContracts.zeroCandidatesFailClosed, true);
  assert.equal(
    staticFixture.resolutionContracts.multipleCandidatesFailClosed,
    true
  );
  assert.equal(
    staticFixture.resolutionContracts
      .ambiguousBundleIdDoesNotSelectArbitraryFirstCandidate,
    true
  );
  assert.equal(
    staticFixture.resolutionContracts
      .preferRunningFallsBackOnlyWhenNoRunningCandidateExists,
    true
  );
});

test("canonical identity is reused outside the manager lookup path", () => {
  assert.deepEqual(
    staticFixture.callsites.map(({ address }) => address),
    [
      "0x1000547e8",
      "0x100056b98",
      "0x100057edc",
      "0x1000a99f0",
      "0x1001e65e4",
      "0x1001e6d1c",
      "0x1001e76c8",
      "0x1001e7870"
    ]
  );
});

test("identifier probe remains read-only outside its temporary directory", () => {
  assert.deepEqual(staticFixture.safety, {
    staticBinaryReadOnly: true,
    serviceStartedOrAttached: false,
    realComputerUseSocketContacted: false,
    uiActionsExecuted: false
  });
  assert.deepEqual(behaviorFixture.safety, {
    temporaryDirectoryOnly: true,
    realComputerUseSocketContacted: false,
    uiActionsExecuted: false
  });
});
