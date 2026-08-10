#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LAB_APP_BUNDLE_ID,
  LAB_APP_PATH,
  LAB_STATE_PATH,
  LAB_SYNTHETIC_MARKER
} from "../lib/cua-lab-scenarios.mjs";

const root = path.resolve(import.meta.dirname, "..");
const testApp = path.join(root, "test-app");
const binary = process.env.MAKA_CU_BIN;
if (!binary) {
  throw new Error("MAKA_CU_BIN must name the pinned maka-cu executable");
}
if (!(await stat(binary)).isFile()) {
  throw new Error(`MAKA_CU_BIN is not a file: ${binary}`);
}

const fixtureRoot = path.join(root, "fixtures", "real-cua");
const outputPath = process.env.MAKA_CU_OUTPUT
  ? path.resolve(process.env.MAKA_CU_OUTPUT)
  : path.join(fixtureRoot, "maka-modal-secondary.json");
if (
  outputPath !== fixtureRoot &&
  !outputPath.startsWith(`${fixtureRoot}${path.sep}`)
) {
  throw new Error(`MAKA_CU_OUTPUT must stay below ${fixtureRoot}`);
}
const imageDir = await mkdtemp(path.join(tmpdir(), "maka-cu-modal-secondary-"));
await mkdir(path.dirname(outputPath), { recursive: true });

const child = spawn(binary, ["host"], {
  stdio: ["pipe", "pipe", "pipe"]
});
let nextId = 1;
let buffer = "";
let stderr = "";
const pending = new Map();
const transcript = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    transcript.push({ direction: "server->client", message });
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

function request(method, params = {}, timeoutMs = 30_000) {
  const id = nextId++;
  const message = { jsonrpc: "2.0", id, method, params };
  transcript.push({ direction: "client->server", message });
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function oracle() {
  const state = JSON.parse(await readFile(LAB_STATE_PATH, "utf8"));
  if (
    state.synthetic !== true ||
    state.syntheticMarker !== LAB_SYNTHETIC_MARKER ||
    state.bundleIdentifier !== LAB_APP_BUNDLE_ID ||
    state.appPath !== LAB_APP_PATH
  ) {
    throw new Error("CUA Lab oracle identity mismatch");
  }
  return state;
}

async function resetLab() {
  execFileSync(path.join(testApp, "reset.sh"), { stdio: "ignore" });
  execFileSync(path.join(testApp, "launch.sh"), {
    stdio: "ignore",
    env: { ...process.env, CUA_LAB_BACKGROUND: "1" }
  });
  try {
    execFileSync("osascript", [
      "-e",
      'tell application "Google Chrome" to activate'
    ]);
  } catch {
    execFileSync("osascript", [
      "-e",
      'tell application id "com.openai.codex" to activate'
    ]);
  }
  await sleep(300);
  if (frontmost().bundleIdentifier === LAB_APP_BUNDLE_ID) {
    throw new Error("foreground sentinel could not move focus away from CUA Lab");
  }
}

function frontmost() {
  const script =
    'tell application "System Events" to tell first process whose frontmost is true to return {unix id, bundle identifier}';
  const [pid, bundleIdentifier] = execFileSync(
    "osascript",
    ["-e", script],
    { encoding: "utf8" }
  )
    .trim()
    .split(/,\s*/, 2);
  return {
    pid: Number(pid),
    bundleIdentifier: bundleIdentifier || null
  };
}

function resultOf(response, method) {
  const result = response.result;
  if (!result?.ok) {
    throw new Error(
      `${method} failed: ${result?.error?.code ?? response.error?.message ?? "unknown"}`
    );
  }
  return result;
}

function findElement(snapshot, label, role) {
  const matches = snapshot.elements.filter(
    (element) =>
      (element.label === label ||
        element.title === label ||
        element.value === label) &&
      (!role || element.role === role)
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${role ?? "element"} named ${label}, found ${matches.length}`
    );
  }
  return matches[0];
}

async function observeApp(session) {
  return resultOf(
    await request("observe", {
      session,
      target: { kind: "app", app: LAB_APP_BUNDLE_ID },
      includeImage: false
    }),
    "observe app"
  ).snapshot;
}

async function observeWindow(session, pid, windowId) {
  return resultOf(
    await request("observe", {
      session,
      target: { kind: "window", pid, windowId },
      includeImage: false
    }),
    "observe window"
  ).snapshot;
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
  const currentOracle = await oracle();
  if (!response.result?.ok) {
    const windows = await request("window.list", { session });
    throw new Error(
      `dispatch ${toolCallId} failed: ${response.result?.error?.code ?? response.error?.message ?? "unknown"}; ` +
        `lastAction=${currentOracle.meta.lastAction}; ` +
        `windows=${JSON.stringify(
          (windows.result?.windows ?? []).map(({ pid, windowId, appId, title }) => ({
            pid,
            windowId,
            appId,
            title
          }))
        )}; frontmost=${JSON.stringify(frontmost())}; stderr=${JSON.stringify(stderr.slice(-2000))}`
    );
  }
  return {
    result: response.result,
    oracle: currentOracle
  };
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function assertGreater(actual, before, message) {
  if (!(actual > before)) {
    throw new Error(`${message}: expected > ${before}, received ${actual}`);
  }
}

function assertAxAction(result, message) {
  assertEqual(result.path, "ax_action", `${message} path`);
}

async function startForegroundSentinelForPid(targetPid, label) {
  const output = path.join(
    imageDir,
    `${label}-foreground-sentinel.json`
  );
  const compiled = process.env.MAKA_CU_SENTINEL_BIN;
  const command = compiled ?? "xcrun";
  const args = compiled
    ? [String(targetPid), output]
    : [
        "swift",
        path.join(root, "scripts", "frontmost-sentinel.swift"),
        String(targetPid),
        output
      ];
  const sentinel = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  sentinel.stderr.setEncoding("utf8");
  sentinel.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    let readyBuffer = "";
    const timer = setTimeout(() => {
      reject(new Error(`foreground sentinel did not become ready: ${stderr}`));
    }, 15_000);
    sentinel.stdout.setEncoding("utf8");
    sentinel.stdout.on("data", (chunk) => {
      readyBuffer += chunk;
      if (!readyBuffer.includes("READY\n")) return;
      clearTimeout(timer);
      resolve();
    });
    sentinel.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `foreground sentinel exited before ready (${code}): ${stderr}`
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
                  `foreground sentinel exited ${code}: ${stderr}`
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
        (summary.sampleCount < 5 || summary.maxGapMilliseconds > 250)
      ) {
        throw new Error(
          `${message}: foreground sentinel coverage is too sparse: ${JSON.stringify(summary)}`
        );
      }
      return summary;
    }
  };
}

const session = `maka-modal-secondary-${process.pid}`;
const activeSentinels = [];
const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  binary: {
    bytes: (await stat(binary)).size,
    sha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex")
  },
  target: {
    bundleIdentifier: LAB_APP_BUNDLE_ID,
    appPath: path.relative(root, LAB_APP_PATH),
    statePath: path.relative(root, LAB_STATE_PATH)
  },
  modal: {},
  secondary: {}
};

try {
  report.hello = resultOf(
    await request("host.hello", {
      protocol: "maka.cu/2",
      host: { name: "maka-modal-secondary-probe", version: "1.0.0" },
      hostPid: process.pid,
      imageDir,
      allowGlobalPointer: false
    }),
    "host.hello"
  );
  report.permissions = resultOf(
    await request("permissions.check", { prompt: false }),
    "permissions.check"
  );
  resultOf(
    await request("session.begin", { session, captureScope: "window" }),
    "session.begin"
  );

  await resetLab();
  const modalTargetPid = (await oracle()).oop.hostPID;
  const modalSentinel = await startForegroundSentinelForPid(
    modalTargetPid,
    "modal"
  );
  activeSentinels.push(modalSentinel);
  const modalForegroundBefore = frontmost();
  const modalMain = await observeApp(session);
  const openModal = findElement(
    modalMain,
    "CUA Lab Open Modal",
    "AXButton"
  );
  const modalOpened = await dispatchElement(
    session,
    modalMain,
    openModal,
    { kind: "click", button: "left", count: 1 },
    "open-modal"
  );
  assertAxAction(modalOpened.result, "modal open");
  assertEqual(modalOpened.oracle.modal.open, true, "modal open oracle");
  const modalForegroundAfterOpen = frontmost();

  const modalSheet = await observeApp(session);
  assertEqual(
    modalSheet.target.title,
    "CUA Lab Modal",
    "app observation routes to sheet"
  );
  const closeModal = findElement(
    modalSheet,
    "CUA Lab Modal Close",
    "AXButton"
  );
  const modalClosed = await dispatchElement(
    session,
    modalSheet,
    closeModal,
    { kind: "click", button: "left", count: 1 },
    "close-modal"
  );
  assertAxAction(modalClosed.result, "modal close");
  assertEqual(modalClosed.oracle.modal.open, false, "modal close oracle");
  const modalForegroundAfterClose = frontmost();
  const modalReturned = await observeApp(session);
  if (modalReturned.target.title === "CUA Lab Modal") {
    throw new Error("app observation remained on the closed modal");
  }
  const modalSentinelResult = await modalSentinel.stop(
    "modal foreground safety"
  );
  report.modal = {
    passed: true,
    mainWindowId: modalMain.target.windowId,
    sheetWindowId: modalSheet.target.windowId,
    returnedWindowId: modalReturned.target.windowId,
    openPath: modalOpened.result.path,
    closePath: modalClosed.result.path,
    openVerification: modalOpened.result.verification,
    closeVerification: modalClosed.result.verification,
    foreground: {
      before: modalForegroundBefore,
      afterOpen: modalForegroundAfterOpen,
      afterClose: modalForegroundAfterClose
    },
    targetRemainedBackground:
      modalSentinelResult.targetForegroundSamples === 0,
    foregroundSentinel: modalSentinelResult
  };

  await resetLab();
  const secondaryTargetPid = (await oracle()).oop.hostPID;
  const secondarySentinel = await startForegroundSentinelForPid(
    secondaryTargetPid,
    "secondary"
  );
  activeSentinels.push(secondarySentinel);
  const secondaryForegroundBefore = frontmost();
  const secondaryMain = await observeApp(session);
  const openSecondary = findElement(
    secondaryMain,
    "CUA Lab Open Secondary Window",
    "AXButton"
  );
  const secondaryOpened = await dispatchElement(
    session,
    secondaryMain,
    openSecondary,
    { kind: "click", button: "left", count: 1 },
    "open-secondary"
  );
  assertAxAction(secondaryOpened.result, "secondary open");
  assertEqual(
    secondaryOpened.oracle.secondaryWindow.open,
    true,
    "secondary open oracle"
  );

  const windows = resultOf(
    await request("window.list", { session }),
    "window.list"
  ).windows;
  const secondaryWindow = windows.find(
    (window) =>
      window.appId === LAB_APP_BUNDLE_ID &&
      window.title === "CUA Lab Secondary Window"
  );
  if (!secondaryWindow) {
    throw new Error("secondary window missing from window.list");
  }
  const appSelectedSecondary = await observeApp(session);
  assertEqual(
    appSelectedSecondary.target.windowId,
    secondaryWindow.windowId,
    "app observation routes to frontmost secondary"
  );

  let exactSecondary = await observeWindow(
    session,
    secondaryWindow.pid,
    secondaryWindow.windowId
  );
  const secondaryButton = findElement(
    exactSecondary,
    "CUA Lab Secondary Button",
    "AXButton"
  );
  const buttonBefore =
    secondaryOpened.oracle.secondaryWindow.buttonClickCount;
  const buttonClicked = await dispatchElement(
    session,
    exactSecondary,
    secondaryButton,
    { kind: "click", button: "left", count: 1 },
    "secondary-button"
  );
  assertAxAction(buttonClicked.result, "secondary button");
  assertGreater(
    buttonClicked.oracle.secondaryWindow.buttonClickCount,
    buttonBefore,
    "secondary button oracle"
  );

  exactSecondary = await observeWindow(
    session,
    secondaryWindow.pid,
    secondaryWindow.windowId
  );
  const secondaryScroll = findElement(
    exactSecondary,
    "CUA Lab Secondary Scroll Region",
    "AXScrollArea"
  );
  const scrollBefore = buttonClicked.oracle.secondaryWindow.scrollOffset;
  const scrolled = await dispatchElement(
    session,
    exactSecondary,
    secondaryScroll,
    { kind: "scroll", direction: "down", pages: 1 },
    "secondary-scroll"
  );
  assertAxAction(scrolled.result, "secondary scroll");
  assertGreater(
    scrolled.oracle.secondaryWindow.scrollOffset,
    scrollBefore,
    "secondary scroll oracle"
  );

  exactSecondary = await observeWindow(
    session,
    secondaryWindow.pid,
    secondaryWindow.windowId
  );
  const secondaryClose = findElement(
    exactSecondary,
    "CUA Lab Secondary Close",
    "AXButton"
  );
  const secondaryClosed = await dispatchElement(
    session,
    exactSecondary,
    secondaryClose,
    { kind: "click", button: "left", count: 1 },
    "secondary-close"
  );
  assertAxAction(secondaryClosed.result, "secondary close");
  assertEqual(
    secondaryClosed.oracle.secondaryWindow.open,
    false,
    "secondary close oracle"
  );
  const secondaryReturned = await observeApp(session);
  const secondaryForegroundAfter = frontmost();
  if (secondaryReturned.target.windowId === secondaryWindow.windowId) {
    throw new Error("app observation remained on the closed secondary window");
  }
  const secondarySentinelResult = await secondarySentinel.stop(
    "secondary foreground safety"
  );
  report.secondary = {
    passed: true,
    mainWindowId: secondaryMain.target.windowId,
    secondaryWindowId: secondaryWindow.windowId,
    returnedWindowId: secondaryReturned.target.windowId,
    appSelectedSecondaryWindow: true,
    openPath: secondaryOpened.result.path,
    buttonPath: buttonClicked.result.path,
    scrollPath: scrolled.result.path,
    closePath: secondaryClosed.result.path,
    openVerification: secondaryOpened.result.verification,
    buttonVerification: buttonClicked.result.verification,
    scrollVerification: scrolled.result.verification,
    closeVerification: secondaryClosed.result.verification,
    buttonClickCount:
      buttonClicked.oracle.secondaryWindow.buttonClickCount,
    scrollOffset: scrolled.oracle.secondaryWindow.scrollOffset,
    foreground: {
      before: secondaryForegroundBefore,
      after: secondaryForegroundAfter
    },
    targetRemainedBackground:
      secondarySentinelResult.targetForegroundSamples === 0,
    foregroundSentinel: secondarySentinelResult
  };

  resultOf(await request("session.end", { session }), "session.end");
  report.passed = true;
} finally {
  await Promise.all(
    activeSentinels.map((sentinel) =>
      sentinel.stop("foreground sentinel cleanup", false)
    )
  );
  report.protocol = {
    requestCount: transcript.filter(
      (entry) => entry.direction === "client->server"
    ).length,
    responseCount: transcript.filter(
      (entry) => entry.direction === "server->client"
    ).length,
    stderrCharacters: stderr.length
  };
  child.stdin.end();
  child.kill("SIGTERM");
  try {
    execFileSync(path.join(testApp, "stop.sh"), { stdio: "ignore" });
  } catch {}
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(
  JSON.stringify({
    output: outputPath,
    passed: report.passed === true,
    modal: report.modal,
    secondary: report.secondary
  })
);
