#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const LAB_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const EXPECTED_APP_ROOT = path.join(
  LAB_ROOT,
  "test-app",
  "build",
  "Codex CUA Lab.app"
);
const ORACLE_PATH = path.join(LAB_ROOT, "test-app", "runtime", "state.json");
const TEST_APP_EXECUTABLE = path.join(
  EXPECTED_APP_ROOT,
  "Contents",
  "MacOS",
  "Codex CUA Lab"
);
const SKY_EXECUTABLE = path.join(
  os.homedir(),
  ".codex",
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "MacOS",
  "SkyComputerUseService"
);
const CUA_SOCKET = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "2DC432GLL2.com.openai.sky.CUAService",
  "IPC",
  "computeruse.sock"
);
const APPROVAL_STORE = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "2DC432GLL2.com.openai.sky.CUAService",
  "Library",
  "Application Support",
  "Software",
  "ComputerUseAppApprovals.json"
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

async function metadata(filePath) {
  try {
    const info = await stat(filePath);
    return {
      present: true,
      type: info.isSocket()
        ? "socket"
        : info.isDirectory()
          ? "directory"
          : info.isFile()
            ? "file"
            : "other",
      mode: (info.mode & 0o777).toString(8),
      bytes: info.size,
      modifiedUnixMilliseconds: Math.trunc(info.mtimeMs)
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { present: false };
    }
    throw error;
  }
}

async function readSyntheticOracle() {
  try {
    const value = JSON.parse(await readFile(ORACLE_PATH, "utf8"));
    return {
      present: true,
      schemaVersion: value.schemaVersion ?? null,
      revision: value.revision ?? null,
      syntheticMarker: value.syntheticMarker ?? null,
      state: value.state ?? value
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { present: false };
    }
    return {
      present: true,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function processRecord(expectedExecutable) {
  const output = commandOutput("/bin/ps", [
    "-axo",
    "pid=,command="
  ]);
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return false;
      }
      const command = match[2];
      return (
        command === expectedExecutable ||
        command.startsWith(`${expectedExecutable} `)
      );
    })
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      return {
        pid: match ? Number(match[1]) : null,
        command: normalizeCommand(match ? match[2] : line)
      };
    });
}

function normalizeCommand(command) {
  return command
    .replaceAll(os.homedir(), "$HOME")
    .replaceAll("/Applications/ChatGPT.app", "$APP");
}

function displaySummary() {
  const swift = `
import AppKit
import CoreGraphics
let screens = NSScreen.screens.enumerated().map { index, screen in
  let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32
  return [
    "index": index,
    "displayID": id.map(String.init) ?? "unknown",
    "frame": NSStringFromRect(screen.frame),
    "visibleFrame": NSStringFromRect(screen.visibleFrame),
    "scale": String(describing: screen.backingScaleFactor),
    "pixelsWide": id.map { String(CGDisplayPixelsWide($0)) } ?? "unknown",
    "pixelsHigh": id.map { String(CGDisplayPixelsHigh($0)) } ?? "unknown"
  ]
}
let data = try! JSONSerialization.data(withJSONObject: screens)
print(String(data: data, encoding: .utf8)!)
`;
  const output = commandOutput("/usr/bin/xcrun", ["swift", "-e", swift]);
  try {
    const result = JSON.parse(output);
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("display probe returned no screens");
    }
    return result;
  } catch {
    throw new Error("display geometry probe failed");
  }
}

function cuaTempAggregates() {
  const tempRoot = process.env.TMPDIR || os.tmpdir();
  const output = commandOutput("/usr/bin/find", [
    tempRoot,
    "-maxdepth",
    "4",
    "-type",
    "f",
    "(",
    "-iname",
    "*skyshot*",
    "-o",
    "-iname",
    "*screenshot*",
    "-o",
    "-iname",
    "*appshot*",
    "-o",
    "-iname",
    "*computer-use*",
    ")",
    "-print"
  ]);
  const paths = output ? output.split("\n").filter(Boolean) : [];
  let totalBytes = 0;
  let newestMtime = null;
  for (const filePath of paths) {
    try {
      const line = commandOutput("/usr/bin/stat", ["-f", "%z %m", filePath]);
      const [size, mtime] = line.split(" ").map(Number);
      if (Number.isFinite(size)) {
        totalBytes += size;
      }
      if (Number.isFinite(mtime)) {
        newestMtime = newestMtime == null ? mtime : Math.max(newestMtime, mtime);
      }
    } catch {
      // A short-lived file may disappear between find and stat.
    }
  }
  return {
    tempRoot: "<system-temp>",
    matchingFileCount: paths.length,
    totalBytes,
    newestModifiedUnixSeconds: newestMtime
  };
}

export async function collectRealCuaSnapshot(label = "snapshot") {
  return {
    schemaVersion: 1,
    label,
    capturedAt: new Date().toISOString(),
    safety: {
      readOnly: true,
      screenshotsRead: false,
      axContentRead: false,
      approvalContentsRead: false,
      realCuaRequestSent: false,
      realInputSynthesized: false
    },
    expectedTarget: {
      bundleIdentifier: "com.openai.codex.cualab",
      appRoot: "$LAB/test-app/build/Codex CUA Lab.app",
      appMetadata: await metadata(EXPECTED_APP_ROOT)
    },
    processes: {
      sky: processRecord(SKY_EXECUTABLE),
      testApp: processRecord(TEST_APP_EXECUTABLE)
    },
    ipc: {
      cuaSocket: await metadata(CUA_SOCKET),
      approvalStore: await metadata(APPROVAL_STORE)
    },
    displays: displaySummary(),
    syntheticOracle: await readSyntheticOracle(),
    cuaTempAggregates: cuaTempAggregates()
  };
}

async function atomicWrite(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporaryPath, absolutePath);
}

async function main() {
  const label = argumentValue("--label") ?? "snapshot";
  const outputPath = argumentValue("--out");
  const snapshot = await collectRealCuaSnapshot(label);
  if (outputPath) {
    await atomicWrite(outputPath, snapshot);
  }
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await main();
}
