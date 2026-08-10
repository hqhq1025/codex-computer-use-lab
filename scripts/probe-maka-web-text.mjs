#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const lab = path.join(root, "test-app");
const oraclePath = path.join(lab, "runtime", "state.json");
const sourceInput = process.env.MAKA_CU_SOURCE_DIR;
const fixtureRoot = path.join(root, "fixtures", "real-cua");
const outputPath = process.env.MAKA_CU_OUTPUT
  ? path.resolve(process.env.MAKA_CU_OUTPUT)
  : path.join(fixtureRoot, "maka-web-text.json");
const requirePass = process.env.MAKA_CU_REQUIRE_PASS !== "0";

if (!sourceInput) {
  throw new Error("MAKA_CU_SOURCE_DIR must name a clean maka-cu checkout");
}
if (
  outputPath !== fixtureRoot &&
  !outputPath.startsWith(`${fixtureRoot}${path.sep}`)
) {
  throw new Error(`MAKA_CU_OUTPUT must stay below ${fixtureRoot}`);
}

const sourceDir = await realpath(sourceInput);
const sourceStatus = execFileSync("git", ["status", "--porcelain"], {
  cwd: sourceDir,
  encoding: "utf8"
}).trim();
if (sourceStatus) {
  throw new Error(`maka-cu source must be clean:\n${sourceStatus}`);
}
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceDir,
  encoding: "utf8"
}).trim();
const sourceBranch =
  process.env.MAKA_CU_SOURCE_BRANCH?.trim() ||
  execFileSync("git", ["branch", "--show-current"], {
    cwd: sourceDir,
    encoding: "utf8"
  }).trim();
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
if (sourceStatusAfterBuild || sourceCommitAfterBuild !== sourceCommit) {
  throw new Error("maka-cu source changed during the release build");
}
const binary = await realpath(
  path.join(sourceDir, ".build", "release", "OpenComputerUse")
);
const binaryBytes = await readFile(binary);
const binaryStat = await stat(binary);
const imageDir = await mkdtemp(path.join(tmpdir(), "maka-web-text-"));
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
let stdout = "";
let stderr = "";
const pending = new Map();
let sentinel;

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  for (;;) {
    const newline = stdout.indexOf("\n");
    if (newline < 0) {
      break;
    }
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    if (!line) {
      continue;
    }
    const response = JSON.parse(line);
    const waiter = pending.get(response.id);
    if (waiter) {
      pending.delete(response.id);
      clearTimeout(waiter.timer);
      waiter.resolve(response);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
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

function deepestElement(snapshot, label, role) {
  const matches = snapshot.elements
    .filter(
      (element) =>
        element.role === role &&
        (element.label === label || element.title === label)
    )
    .sort((left, right) => right.depth - left.depth);
  if (matches.length === 0) {
    throw new Error(`missing ${role} ${label}`);
  }
  return {
    element: matches[0],
    candidateCount: matches.length
  };
}

async function startForegroundSentinel(targetPid) {
  const output = path.join(imageDir, "foreground-sentinel.json");
  const process = spawn(
    sentinelBinary,
    [String(targetPid), output],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let processStderr = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk) => {
    processStderr += chunk;
  });
  await new Promise((resolve, reject) => {
    let ready = "";
    const timer = setTimeout(() => {
      reject(new Error(`foreground sentinel did not become ready: ${processStderr}`));
    }, 15_000);
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk) => {
      ready += chunk;
      if (!ready.includes("READY\n")) {
        return;
      }
      clearTimeout(timer);
      resolve();
    });
    process.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `foreground sentinel exited before ready (${code}): ${processStderr}`
        )
      );
    });
  });

  let summaryPromise;
  return {
    async stop() {
      if (!summaryPromise) {
        summaryPromise = new Promise((resolve, reject) => {
          process.once("exit", async (code) => {
            if (code !== 0 && code !== null) {
              reject(new Error(`foreground sentinel exited ${code}: ${processStderr}`));
              return;
            }
            try {
              resolve(JSON.parse(await readFile(output, "utf8")));
            } catch (error) {
              reject(error);
            }
          });
        });
        process.kill("SIGTERM");
      }
      return summaryPromise;
    }
  };
}

const session = `maka-web-text-${process.pid}`;
const requested = "Maka Web text";
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: {
    commit: sourceCommit,
    branch: sourceBranch,
    dirty: false,
    buildCommand: "swift build -c release"
  },
  binary: {
    path: "<maka-cu-source>/.build/release/OpenComputerUse",
    sha256: createHash("sha256").update(binaryBytes).digest("hex"),
    size: binaryStat.size
  },
  requested,
  passed: false
};

try {
  execFileSync(path.join(lab, "reset.sh"), { stdio: "ignore" });
  execFileSync(path.join(lab, "launch.sh"), {
    env: { ...process.env, CUA_LAB_BACKGROUND: "1" },
    stdio: "ignore"
  });
  execFileSync("osascript", [
    "-e",
    'tell application "Google Chrome" to activate'
  ]);
  const initialOracle = JSON.parse(await readFile(oraclePath, "utf8"));
  sentinel = await startForegroundSentinel(initialOracle.oop.hostPID);

  report.hello = await request("host.hello", {
    protocol: "maka.cu/2",
    host: { name: "maka-web-text-probe", version: "1.0.0" },
    hostPid: process.pid,
    imageDir,
    allowGlobalPointer: false
  });
  report.permissions = await request("permissions.check");
  await request("session.begin", { session, captureScope: "window" });
  const observed = await request("observe", {
    session,
    target: { kind: "app", app: "com.openai.codex.cualab" },
    includeImage: false
  });
  report.observe = observed;
  const snapshot = observed.result?.snapshot;
  if (!snapshot) {
    throw new Error("observe returned no snapshot");
  }
  const selected = deepestElement(
    snapshot,
    "CUA Lab OOP Text Field",
    "AXTextField"
  );
  report.target = {
    candidateCount: selected.candidateCount,
    element: selected.element
  };
  report.dispatch = await request("dispatch.element", {
    session,
    snapshotId: snapshot.snapshotId,
    toolCallId: "oop-text-set-value",
    elementToken: selected.element.token,
    expectElementDigest: selected.element.digest,
    action: { kind: "set_value", value: requested },
    observeAfter: { includeImage: false, settle: "quiesce" }
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  report.oracle = JSON.parse(await readFile(oraclePath, "utf8")).oop;
  report.foregroundSentinel = await sentinel.stop();
  report.passed =
    report.dispatch.result?.outcome === "ok" &&
    report.oracle.textValue === requested &&
    report.oracle.textInputCount > 0 &&
    report.oracle.lastTextEventTrusted === true &&
    report.foregroundSentinel.targetForegroundSamples === 0 &&
    report.foregroundSentinel.sampleCount >= 5 &&
    report.foregroundSentinel.maxGapMilliseconds <= 250;
  await request("session.end", { session });
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.stderr = stderr;
} finally {
  if (sentinel) {
    try {
      report.foregroundSentinel ??= await sentinel.stop();
    } catch {}
  }
  try {
    execFileSync(path.join(lab, "stop.sh"), { stdio: "ignore" });
  } catch {}
  child.stdin.end();
  child.kill("SIGTERM");
  await rm(imageDir, { recursive: true, force: true });
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({
    output: outputPath,
    passed: report.passed,
    outcome: report.dispatch?.result?.outcome,
    path: report.dispatch?.result?.path,
    effect: report.dispatch?.result?.effect,
    oracle: report.oracle,
    foregroundSentinel: report.foregroundSentinel,
    failure: report.failure
  })}\n`
);

if (requirePass && !report.passed) {
  process.exitCode = 1;
}
