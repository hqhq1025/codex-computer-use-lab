#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const lab = path.join(root, "test-app");
const oraclePath = path.join(lab, "runtime", "state.json");
const sourceInput = process.env.MAKA_CU_SOURCE_DIR;
const outputPath = path.join(
  root,
  "fixtures",
  "real-cua",
  "maka-web-text-baseline.json"
);

if (!sourceInput) {
  throw new Error("MAKA_CU_SOURCE_DIR must name a clean maka-cu checkout");
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
execFileSync("swift", ["build", "-c", "release"], {
  cwd: sourceDir,
  stdio: "inherit"
});
const binary = await realpath(
  path.join(sourceDir, ".build", "release", "OpenComputerUse")
);
const imageDir = await mkdtemp(path.join(tmpdir(), "maka-web-text-"));
const child = spawn(binary, ["host"], {
  stdio: ["pipe", "pipe", "pipe"]
});

let nextId = 1;
let stdout = "";
let stderr = "";
const pending = new Map();

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

const session = `maka-web-text-${process.pid}`;
const requested = "Maka Web text";
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  sourceCommit,
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
  report.passed =
    report.dispatch.result?.outcome === "ok" &&
    report.oracle.textValue === requested &&
    report.oracle.textInputCount > 0;
  await request("session.end", { session });
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.stderr = stderr;
} finally {
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
    oracle: report.oracle
  })}\n`
);

if (!report.passed) {
  process.exitCode = 1;
}
