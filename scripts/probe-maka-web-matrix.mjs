#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "real-cua");
const lab = path.join(root, "test-app");
const oraclePath = path.join(lab, "runtime", "state.json");
const outputPath = process.env.MAKA_CU_OUTPUT
  ? path.resolve(process.env.MAKA_CU_OUTPUT)
  : path.join(fixtureRoot, "maka-web-matrix.json");
const sourceInput = process.env.MAKA_CU_SOURCE_DIR;

if (
  outputPath !== fixtureRoot &&
  !outputPath.startsWith(`${fixtureRoot}${path.sep}`)
) {
  throw new Error(`MAKA_CU_OUTPUT must stay below ${fixtureRoot}`);
}

if (!sourceInput) {
  throw new Error("MAKA_CU_SOURCE_DIR must name a clean maka-cu source checkout");
}

const sourceDir = await realpath(sourceInput);
const sourceStatus = execFileSync("git", ["status", "--porcelain"], {
  cwd: sourceDir,
  encoding: "utf8"
}).trim();
if (sourceStatus) {
  throw new Error(`MAKA_CU_SOURCE_DIR must be clean:\n${sourceStatus}`);
}
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceDir,
  encoding: "utf8"
}).trim();
const sourceBranch =
  process.env.MAKA_CU_SOURCE_BRANCH?.trim() ||
  execFileSync(
    "git",
    ["branch", "--show-current"],
    { cwd: sourceDir, encoding: "utf8" }
  ).trim();
const buildCommand = "swift build -c release";
execFileSync("swift", ["build", "-c", "release"], {
  cwd: sourceDir,
  stdio: "inherit"
});
const sourceStatusAfterBuild = execFileSync(
  "git",
  ["status", "--porcelain"],
  { cwd: sourceDir, encoding: "utf8" }
).trim();
const sourceCommitAfterBuild = execFileSync(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: sourceDir, encoding: "utf8" }
).trim();
if (
  sourceStatusAfterBuild ||
  sourceCommitAfterBuild !== sourceCommit
) {
  throw new Error(
    "maka-cu source changed while the release binary was being built"
  );
}

const builtBinary = await realpath(
  path.join(sourceDir, ".build", "release", "OpenComputerUse")
);
let binary = builtBinary;
if (process.env.MAKA_CU_BIN) {
  const requestedBinary = await realpath(process.env.MAKA_CU_BIN);
  const builtSha256 = createHash("sha256")
    .update(await readFile(builtBinary))
    .digest("hex");
  const requestedSha256 = createHash("sha256")
    .update(await readFile(requestedBinary))
    .digest("hex");
  if (requestedSha256 !== builtSha256) {
    throw new Error(
      `MAKA_CU_BIN bytes do not match the clean source build: ${requestedSha256} != ${builtSha256}`
    );
  }
  binary = requestedBinary;
}
const binaryBytes = await readFile(binary);
const binaryStat = await stat(binary);
const binarySha256 = createHash("sha256").update(binaryBytes).digest("hex");
if (
  process.env.MAKA_CU_EXPECTED_SHA256 &&
  process.env.MAKA_CU_EXPECTED_SHA256 !== binarySha256
) {
  throw new Error(
    `maka-cu SHA-256 mismatch: expected ${process.env.MAKA_CU_EXPECTED_SHA256}, got ${binarySha256}`
  );
}
const imageDir = await mkdtemp(path.join(tmpdir(), "maka-cu-web-matrix-"));
const sentinelBinary = path.join(imageDir, "frontmost-sentinel");
execFileSync(
  "xcrun",
  [
    "swiftc",
    path.join(root, "scripts", "frontmost-sentinel.swift"),
    "-o",
    sentinelBinary
  ],
  { stdio: "ignore" }
);
const child = spawn(binary, ["host"], {
  stdio: ["pipe", "pipe", "pipe"]
});

let nextId = 1;
let buffer = "";
let stderr = "";
const pending = new Map();
const activeSentinels = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) {
      break;
    }
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) {
      continue;
    }
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.on("exit", (code, signal) => {
  for (const [id, waiter] of pending) {
    clearTimeout(waiter.timer);
    waiter.reject(
      new Error(`maka-cu exited before response ${id}: code=${code} signal=${signal}`)
    );
  }
  pending.clear();
});

function request(method, params = {}, timeoutMs = 30_000) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readOracle() {
  return JSON.parse(await readFile(oraclePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

async function startForegroundSentinel(targetPid, label) {
  const output = path.join(imageDir, `${label}-foreground-sentinel.json`);
  const sentinel = spawn(
    sentinelBinary,
    [String(targetPid), output],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let sentinelStderr = "";
  sentinel.stderr.setEncoding("utf8");
  sentinel.stderr.on("data", (chunk) => {
    sentinelStderr += chunk;
  });
  await new Promise((resolve, reject) => {
    let readyBuffer = "";
    const timer = setTimeout(() => {
      reject(
        new Error(`foreground sentinel did not become ready: ${sentinelStderr}`)
      );
    }, 15_000);
    sentinel.stdout.setEncoding("utf8");
    sentinel.stdout.on("data", (chunk) => {
      readyBuffer += chunk;
      if (!readyBuffer.includes("READY\n")) {
        return;
      }
      clearTimeout(timer);
      resolve();
    });
    sentinel.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `foreground sentinel exited before ready (${code}): ${sentinelStderr}`
        )
      );
    });
  });

  let summaryPromise;
  return {
    async stop(message, enforce = true) {
      if (!summaryPromise) {
        summaryPromise = new Promise((resolve, reject) => {
          sentinel.once("exit", async (code) => {
            if (code !== 0 && code !== null) {
              reject(
                new Error(
                  `foreground sentinel exited ${code}: ${sentinelStderr}`
                )
              );
              return;
            }
            try {
              resolve(JSON.parse(await readFile(output, "utf8")));
            } catch (error) {
              reject(error);
            }
          });
        });
        sentinel.kill("SIGTERM");
      }
      const summary = await summaryPromise;
      if (
        enforce &&
        (summary.sampleCount < 5 ||
          summary.maxGapMilliseconds > 250 ||
          summary.targetForegroundSamples !== 0)
      ) {
        throw new Error(
          `${message}: foreground safety failed: ${JSON.stringify(summary)}`
        );
      }
      return summary;
    }
  };
}

function resetLab() {
  execFileSync(path.join(lab, "reset.sh"), { stdio: "ignore" });
  execFileSync(path.join(lab, "launch.sh"), {
    env: { ...process.env, CUA_LAB_BACKGROUND: "1" },
    stdio: "ignore"
  });
  execFileSync("osascript", [
    "-e",
    'tell application "Google Chrome" to activate'
  ]);
}

function frontmostPid() {
  return Number(
    execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to get unix id of first process whose frontmost is true'
      ],
      { encoding: "utf8" }
    ).trim()
  );
}

function pressNestedButton(label) {
  const script = `
tell application "System Events"
  tell process "Codex CUA Lab"
    set itemList to entire contents of window "Codex CUA Lab"
    repeat with itemRef in itemList
      try
        if (name of itemRef as text) is "${label}" then
          perform action "AXPress" of itemRef
          return "pressed"
        end if
      end try
    end repeat
  end tell
end tell
error "button not found: ${label}"
`;
  execFileSync("osascript", ["-e", script], { stdio: "ignore" });
}

function findElement(snapshot, label, role) {
  const matches = snapshot.elements.filter(
    (element) =>
      (element.label === label ||
        element.title === label ||
        element.value === label) &&
      (!role || element.role === role)
  );
  assertEqual(matches.length, 1, `unique ${role ?? "element"} ${label}`);
  return matches[0];
}

function findDeepestElement(snapshot, label, role) {
  const matches = snapshot.elements
    .filter(
      (element) =>
        (element.label === label ||
          element.title === label ||
          element.value === label) &&
        (!role || element.role === role)
    )
    .sort((left, right) => right.depth - left.depth);
  assert(matches.length > 0, `missing ${role ?? "element"} ${label}`);
  if (matches.length > 1) {
    assert(
      matches[0].depth > matches[1].depth,
      `ambiguous deepest ${role ?? "element"} ${label}`
    );
  }
  return { element: matches[0], candidateCount: matches.length };
}

function refusalCode(message) {
  return message.error?.code ?? message.result?.error?.code;
}

async function observe(session) {
  const response = await request("observe", {
    session,
    target: { kind: "app", app: "com.openai.codex.cualab" },
    includeImage: false
  });
  assert(response.result?.snapshot, "observe did not return a snapshot");
  return response.result.snapshot;
}

async function dispatchElement(session, snapshot, element, action, toolCallId) {
  const response = await request("dispatch.element", {
    session,
    snapshotId: snapshot.snapshotId,
    toolCallId,
    elementToken: element.token,
    expectElementDigest: element.digest,
    action,
    observeAfter: { includeImage: false, settle: "quiesce" }
  });
  await sleep(200);
  return { response, oracle: await readOracle() };
}

function actionSummary(dispatch) {
  return {
    outcome: dispatch.response.result?.outcome,
    path: dispatch.response.result?.path,
    effect: dispatch.response.result?.effect,
    verification: dispatch.response.result?.verification
  };
}

function runForegroundSentinels(run) {
  return [
    run.primary.foregroundSentinel,
    run.uniqueRefetch.foregroundSentinel,
    run.missingRefetch.foregroundSentinel,
    run.slider.foregroundSentinel,
    run.scroll.foregroundSentinel,
    run.oop.foregroundSentinel
  ];
}

async function resetAndObserve(session, sentinelLabel) {
  resetLab();
  await sleep(300);
  const state = await readOracle();
  const targetPid = state.oop.hostPID;
  const sentinel = sentinelLabel
    ? await startForegroundSentinel(targetPid, sentinelLabel)
    : null;
  if (sentinel) {
    activeSentinels.push(sentinel);
  }
  const snapshot = await observe(session);
  assertEqual(snapshot.target.pid, targetPid, "snapshot target PID");
  const foregroundAfterObserve = frontmostPid();
  assert(
    foregroundAfterObserve !== snapshot.target.pid,
    "observe must not foreground the target app"
  );
  return { snapshot, foregroundAfterObserve, sentinel };
}

async function runMatrix(session, index) {
  const primaryStart = await resetAndObserve(
    session,
    `web-${index}-primary`
  );
  const primary = findElement(
    primaryStart.snapshot,
    "CUA Lab Primary Button",
    "AXButton"
  );
  const primaryDispatch = await dispatchElement(
    session,
    primaryStart.snapshot,
    primary,
    { kind: "click", button: "left", count: 1 },
    `web-${index}-primary`
  );
  assertEqual(primaryDispatch.response.result?.outcome, "ok", "primary outcome");
  assertEqual(primaryDispatch.response.result?.path, "ax_action", "primary path");
  assertEqual(
    primaryDispatch.oracle.controls.buttonClickCount,
    1,
    "primary click oracle"
  );
  const primaryForegroundAfter = frontmostPid();
  assert(
    primaryForegroundAfter !== primaryStart.snapshot.target.pid,
    "primary dispatch must keep the target app in the background"
  );
  const primaryForegroundSentinel = await primaryStart.sentinel.stop(
    "primary foreground safety"
  );

  const refetchStart = await resetAndObserve(
    session,
    `web-${index}-unique-refetch`
  );
  const staleTarget = findElement(
    refetchStart.snapshot,
    "CUA Lab Stale Target",
    "AXButton"
  );
  pressNestedButton("CUA Lab Mutate Hierarchy");
  await sleep(250);
  const refetchDispatch = await dispatchElement(
    session,
    refetchStart.snapshot,
    staleTarget,
    { kind: "click", button: "left", count: 1 },
    `web-${index}-unique-refetch`
  );
  assertEqual(refetchDispatch.response.result?.outcome, "ok", "refetch outcome");
  assertEqual(refetchDispatch.response.result?.path, "ax_action", "refetch path");
  assertEqual(
    refetchDispatch.oracle.hierarchy.staleTargetClickCount,
    1,
    "refetch target count"
  );
  assertEqual(
    refetchDispatch.oracle.hierarchy.wrongTargetClickCount,
    0,
    "refetch wrong-target count"
  );
  const refetchForegroundSentinel = await refetchStart.sentinel.stop(
    "unique refetch foreground safety"
  );

  const missingStart = await resetAndObserve(
    session,
    `web-${index}-missing-refetch`
  );
  const missingTarget = findElement(
    missingStart.snapshot,
    "CUA Lab Stale Target",
    "AXButton"
  );
  pressNestedButton("CUA Lab Remove Stale Target");
  await sleep(250);
  const missingDispatch = await dispatchElement(
    session,
    missingStart.snapshot,
    missingTarget,
    { kind: "click", button: "left", count: 1 },
    `web-${index}-missing-refetch`
  );
  assert(
    ["element_released", "element_changed"].includes(
      refusalCode(missingDispatch.response)
    ),
    `missing refetch must fail closed, got ${JSON.stringify(missingDispatch.response)}`
  );
  assertEqual(
    missingDispatch.oracle.hierarchy.staleTargetClickCount,
    0,
    "missing target count"
  );
  assertEqual(
    missingDispatch.oracle.hierarchy.wrongTargetClickCount,
    0,
    "missing wrong-target count"
  );
  const missingForegroundSentinel = await missingStart.sentinel.stop(
    "missing refetch foreground safety"
  );

  const sliderStart = await resetAndObserve(session, `web-${index}-slider`);
  const slider = findElement(
    sliderStart.snapshot,
    "CUA Lab Slider",
    "AXSlider"
  );
  const sliderDispatch = await dispatchElement(
    session,
    sliderStart.snapshot,
    slider,
    { kind: "set_value", value: "42" },
    `web-${index}-slider`
  );
  assertEqual(sliderDispatch.response.result?.outcome, "ok", "slider outcome");
  assertEqual(sliderDispatch.response.result?.path, "ax_action", "slider path");
  assertEqual(sliderDispatch.oracle.controls.sliderValue, 42, "slider oracle");
  const sliderForegroundSentinel = await sliderStart.sentinel.stop(
    "slider foreground safety"
  );

  const scrollStart = await resetAndObserve(session, `web-${index}-scroll`);
  const scroll = findElement(
    scrollStart.snapshot,
    "CUA Lab Scroll Region",
    "AXScrollArea"
  );
  const scrollDispatch = await dispatchElement(
    session,
    scrollStart.snapshot,
    scroll,
    { kind: "scroll", direction: "down", pages: 1 },
    `web-${index}-scroll`
  );
  assertEqual(scrollDispatch.response.result?.outcome, "ok", "scroll outcome");
  assertEqual(scrollDispatch.response.result?.path, "ax_action", "scroll path");
  assertEqual(scrollDispatch.oracle.controls.scrollOffset, 76, "scroll oracle");
  const scrollForegroundSentinel = await scrollStart.sentinel.stop(
    "scroll foreground safety"
  );

  const oopStart = await resetAndObserve(session, `web-${index}-oop`);
  const oopSelection = findDeepestElement(
    oopStart.snapshot,
    "CUA Lab OOP Button",
    "AXButton"
  );
  await sleep(350);
  const oopDispatch = await dispatchElement(
    session,
    oopStart.snapshot,
    oopSelection.element,
    { kind: "click", button: "left", count: 1 },
    `web-${index}-oop`
  );
  assertEqual(oopDispatch.response.result?.outcome, "ok", "OOP outcome");
  assertEqual(oopDispatch.response.result?.path, "skylight_pid", "OOP path");
  assertEqual(oopDispatch.oracle.oop.clickCount, 1, "OOP click count");
  assertEqual(
    oopDispatch.oracle.oop.hostLocalMouseDownCount,
    1,
    "OOP mouse-down count"
  );
  assertEqual(
    oopDispatch.oracle.oop.hostLocalMouseUpCount,
    1,
    "OOP mouse-up count"
  );
  assertEqual(
    oopDispatch.oracle.oop.lastEventTrusted,
    true,
    "OOP event trust"
  );
  assert(
    oopDispatch.oracle.oop.hostPID !== oopDispatch.oracle.oop.webContentPID,
    "OOP host and WebContent PIDs must differ"
  );
  const oopForegroundAfter = frontmostPid();
  assert(
    oopForegroundAfter !== oopStart.snapshot.target.pid,
    "OOP dispatch must keep the target app in the background"
  );
  const oopForegroundSentinel = await oopStart.sentinel.stop(
    "OOP foreground safety"
  );

  return {
    index,
    primary: {
      ...actionSummary(primaryDispatch),
      buttonClickCount: primaryDispatch.oracle.controls.buttonClickCount,
      foregroundBefore: primaryStart.foregroundAfterObserve,
      foregroundAfter: primaryForegroundAfter,
      targetRemainedBackground:
        primaryForegroundSentinel.targetForegroundSamples === 0,
      foregroundSentinel: primaryForegroundSentinel
    },
    uniqueRefetch: {
      ...actionSummary(refetchDispatch),
      staleTargetClickCount:
        refetchDispatch.oracle.hierarchy.staleTargetClickCount,
      wrongTargetClickCount:
        refetchDispatch.oracle.hierarchy.wrongTargetClickCount,
      foregroundSentinel: refetchForegroundSentinel
    },
    missingRefetch: {
      refusal: refusalCode(missingDispatch.response),
      staleTargetClickCount:
        missingDispatch.oracle.hierarchy.staleTargetClickCount,
      wrongTargetClickCount:
        missingDispatch.oracle.hierarchy.wrongTargetClickCount,
      foregroundSentinel: missingForegroundSentinel
    },
    slider: {
      ...actionSummary(sliderDispatch),
      value: sliderDispatch.oracle.controls.sliderValue,
      foregroundSentinel: sliderForegroundSentinel
    },
    scroll: {
      ...actionSummary(scrollDispatch),
      offset: scrollDispatch.oracle.controls.scrollOffset,
      foregroundSentinel: scrollForegroundSentinel
    },
    oop: {
      ...actionSummary(oopDispatch),
      clickCount: oopDispatch.oracle.oop.clickCount,
      mouseDownCount: oopDispatch.oracle.oop.hostLocalMouseDownCount,
      mouseUpCount: oopDispatch.oracle.oop.hostLocalMouseUpCount,
      isTrusted: oopDispatch.oracle.oop.lastEventTrusted,
      hostPid: oopDispatch.oracle.oop.hostPID,
      webContentPid: oopDispatch.oracle.oop.webContentPID,
      candidateCount: oopSelection.candidateCount,
      foregroundBefore: oopStart.foregroundAfterObserve,
      foregroundAfter: oopForegroundAfter,
      targetRemainedBackground:
        oopForegroundSentinel.targetForegroundSamples === 0,
      foregroundSentinel: oopForegroundSentinel
    }
  };
}

const session = `maka-web-matrix-${process.pid}`;
const aggregate = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: {
    commit: sourceCommit,
    branch: sourceBranch,
    dirty: false,
    buildCommand
  },
  binary: {
    path: process.env.MAKA_CU_BIN
      ? "<maka-agent-worktree>/apps/desktop/resources/bin/maka-cu"
      : "<maka-cu-source>/.build/release/OpenComputerUse",
    sha256: binarySha256,
    size: binaryStat.size
  },
  runCount: 0,
  passed: false,
  runs: []
};

try {
  aggregate.protocol = await request("host.hello", {
    protocol: "maka.cu/2",
    host: { name: "maka-web-matrix", version: "1.0.0" },
    hostPid: process.pid,
    imageDir,
    allowGlobalPointer: false
  });
  aggregate.permissions = await request("permissions.check");
  await request("session.begin", { session, captureScope: "window" });

  for (let index = 1; index <= 5; index += 1) {
    aggregate.runs.push(await runMatrix(session, index));
  }

  await request("session.end", { session });
  aggregate.runCount = aggregate.runs.length;
  aggregate.summary = {
    primaryClickCounts: aggregate.runs.map(
      (run) => run.primary.buttonClickCount
    ),
    oopPaths: aggregate.runs.map((run) => run.oop.path),
    oopTrustedAllRuns: aggregate.runs.every((run) => run.oop.isTrusted),
    oopSinglePairAllRuns: aggregate.runs.every(
      (run) => run.oop.mouseDownCount === 1 && run.oop.mouseUpCount === 1
    ),
    sliderValues: aggregate.runs.map((run) => run.slider.value),
    scrollOffsets: aggregate.runs.map((run) => run.scroll.offset),
    uniqueRefetchWrongTargetClicks: aggregate.runs.reduce(
      (total, run) => total + run.uniqueRefetch.wrongTargetClickCount,
      0
    ),
    missingRefetchWrongTargetClicks: aggregate.runs.reduce(
      (total, run) => total + run.missingRefetch.wrongTargetClickCount,
      0
    ),
    targetRemainedBackgroundAllRuns: aggregate.runs.every(
      (run) =>
        runForegroundSentinels(run).every(
          (sentinel) => sentinel.targetForegroundSamples === 0
        )
    ),
    targetForegroundSamples: aggregate.runs.reduce(
      (total, run) =>
        total +
        runForegroundSentinels(run).reduce(
          (runTotal, sentinel) =>
            runTotal + sentinel.targetForegroundSamples,
          0
        ),
      0
    ),
    minimumSentinelSamples: Math.min(
      ...aggregate.runs.flatMap((run) =>
        runForegroundSentinels(run).map(
          (sentinel) => sentinel.sampleCount
        )
      )
    ),
    maximumSentinelGapMilliseconds: Math.max(
      ...aggregate.runs.flatMap((run) =>
        runForegroundSentinels(run).map(
          (sentinel) => sentinel.maxGapMilliseconds
        )
      )
    )
  };
  aggregate.passed =
    aggregate.runCount === 5 &&
    aggregate.summary.primaryClickCounts.every((count) => count === 1) &&
    aggregate.summary.oopPaths.every((pathName) => pathName === "skylight_pid") &&
    aggregate.summary.oopTrustedAllRuns &&
    aggregate.summary.oopSinglePairAllRuns &&
    aggregate.summary.sliderValues.every((value) => value === 42) &&
    aggregate.summary.scrollOffsets.every((offset) => offset === 76) &&
    aggregate.summary.uniqueRefetchWrongTargetClicks === 0 &&
    aggregate.summary.missingRefetchWrongTargetClicks === 0 &&
    aggregate.summary.targetRemainedBackgroundAllRuns &&
    aggregate.summary.targetForegroundSamples === 0;
  assert(aggregate.passed, "aggregate Web matrix did not satisfy every gate");

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      output: outputPath,
      runCount: aggregate.runCount,
      passed: aggregate.passed,
      summary: aggregate.summary
    })}\n`
  );
} catch (error) {
  aggregate.runCount = aggregate.runs.length;
  aggregate.failure = {
    message: error instanceof Error ? error.message : String(error),
    stderr
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`);
  throw error;
} finally {
  await Promise.all(
    activeSentinels.map((sentinel) =>
      sentinel.stop("foreground sentinel cleanup", false)
    )
  );
  try {
    execFileSync(path.join(lab, "stop.sh"), { stdio: "ignore" });
  } catch {}
  child.stdin.end();
  child.kill("SIGTERM");
  await rm(imageDir, { recursive: true, force: true });
}
