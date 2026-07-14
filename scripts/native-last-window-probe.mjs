#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_BINARY = path.join(
  os.homedir(),
  ".codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService"
);

const ADDRESSES = Object.freeze({
  getter: 0x10006bc64n,
  assignmentHelper: 0x10006bdc0n,
  orderedWindowsStart: 0x100080e9cn,
  orderedWindowsEnd: 0x100081194n,
  cgWindowListCreateCall: 0x100080ed4n,
  coordinateRawRead: 0x10007fe20n
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function command(commandName, args) {
  return execFileSync(commandName, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseTextSection(binaryPath) {
  const output = command("otool", ["-l", binaryPath]).split("\n");
  let sawTextSegment = false;
  let sawTextSection = false;
  const result = {};

  for (const rawLine of output) {
    const line = rawLine.trim();
    if (line === "segname __TEXT") {
      sawTextSegment = true;
      continue;
    }
    if (sawTextSegment && line === "sectname __text") {
      sawTextSection = true;
      continue;
    }
    if (!sawTextSection) {
      continue;
    }
    const match = line.match(/^(addr|size|offset)\s+(0x[0-9a-f]+|\d+)$/i);
    if (match) {
      result[match[1]] = match[2];
    }
    if (result.addr && result.size && result.offset) {
      return {
        address: BigInt(result.addr),
        size: Number(BigInt(result.size)),
        offset: Number(result.offset)
      };
    }
  }
  throw new Error("Could not parse Mach-O __TEXT,__text section");
}

function directBranchSites(binaryPath, targetAddress) {
  const section = parseTextSection(binaryPath);
  const binary = readFileSync(binaryPath);
  const sites = [];

  for (let index = 0; index < section.size; index += 4) {
    const instruction = binary.readUInt32LE(section.offset + index) >>> 0;
    if (((instruction & 0xfc000000) >>> 0) !== 0x94000000) {
      continue;
    }
    let immediate = BigInt(instruction & 0x03ffffff);
    if ((immediate & 0x02000000n) !== 0n) {
      immediate -= 0x04000000n;
    }
    const site = section.address + BigInt(index);
    const destination = site + (immediate << 2n);
    if (destination === targetAddress) {
      sites.push(site);
    }
  }
  return sites;
}

function hex(value) {
  return `0x${value.toString(16)}`;
}

function disassemble(binaryPath, start, end) {
  const objdump = command("xcrun", ["--find", "llvm-objdump"]).trim();
  return command(objdump, [
    "--arch=arm64",
    "--disassemble",
    `--start-address=${hex(start)}`,
    `--stop-address=${hex(end)}`,
    binaryPath
  ]);
}

function instructionLine(disassembly, address) {
  const prefix = `${address.toString(16)}:`;
  const line = disassembly
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!line) {
    throw new Error(`Missing instruction ${hex(address)}`);
  }
  return line.replace(/\s+/g, " ");
}

export async function runNativeLastWindowProbe({
  binaryPath = DEFAULT_BINARY,
  outputPath
} = {}) {
  const getterCalls = directBranchSites(binaryPath, ADDRESSES.getter);
  const assignmentCalls = directBranchSites(
    binaryPath,
    ADDRESSES.assignmentHelper
  );
  const orderedWindows = disassemble(
    binaryPath,
    ADDRESSES.orderedWindowsStart,
    ADDRESSES.orderedWindowsEnd
  );
  const coordinate = disassemble(
    binaryPath,
    ADDRESSES.coordinateRawRead,
    ADDRESSES.coordinateRawRead + 0x40n
  );
  const uuid = command("xcrun", ["dwarfdump", "--uuid", binaryPath])
    .trim()
    .split(/\s+/)[1];

  const fixture = {
    schemaVersion: 1,
    artifact: {
      name: "SkyComputerUseService",
      version: "26.710.1000387",
      build: "1000387",
      uuid,
      sha256: sha256(binaryPath)
    },
    addresses: Object.fromEntries(
      Object.entries(ADDRESSES).map(([key, value]) => [key, hex(value)])
    ),
    directCalls: {
      getter: getterCalls.map(hex),
      assignmentHelper: assignmentCalls.map(hex),
      businessAssignmentSites: assignmentCalls
        .filter(
          (address) =>
            address === 0x100070b68n || address === 0x10007130cn
        )
        .map(hex),
      compilerSetterThunkSites: assignmentCalls
        .filter((address) => address === 0x100088d34n)
        .map(hex)
    },
    coordinateClickRawRead: {
      site: hex(ADDRESSES.coordinateRawRead),
      instruction: instructionLine(
        coordinate,
        ADDRESSES.coordinateRawRead
      ),
      readsControllerOffset: "0x18"
    },
    orderedWindows: {
      range: [
        hex(ADDRESSES.orderedWindowsStart),
        hex(ADDRESSES.orderedWindowsEnd)
      ],
      directlyCallsLastWindowGetter: getterCalls.some(
        (site) =>
          site >= ADDRESSES.orderedWindowsStart &&
          site < ADDRESSES.orderedWindowsEnd
      ),
      directlyCallsLastWindowAssignment: assignmentCalls.some(
        (site) =>
          site >= ADDRESSES.orderedWindowsStart &&
          site < ADDRESSES.orderedWindowsEnd
      ),
      cgWindowListCreateCall: {
        site: hex(ADDRESSES.cgWindowListCreateCall),
        instruction: instructionLine(
          orderedWindows,
          ADDRESSES.cgWindowListCreateCall
        ),
        arguments: {
          option: "0x11",
          relativeToWindow: 0
        }
      }
    },
    inferredStateMachine: {
      initialValue: null,
      writeSource:
        "latest completed Skyshot SystemSelection.applicationWindow",
      writeOrdering: "completion-order-last-writer-wins-if-concurrent",
      clearedOnFocusOrWindowNotification: false,
      staleWindowPossible: true,
      roles: {
        orderedWindows:
          "current onscreen z-order intersected with the AX window cache",
        lastWindow:
          "historical single-window capture anchor for PiP and coordinate-click assistance"
      }
    },
    safety: {
      processStarted: false,
      processAttached: false,
      uiActionsExecuted: false
    }
  };

  if (outputPath) {
    const absolute = path.resolve(outputPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(fixture, null, 2)}\n`);
  }
  return fixture;
}

async function main() {
  const outputPath =
    argumentValue("--out") ?? "fixtures/native/last-window.json";
  const fixture = await runNativeLastWindowProbe({
    binaryPath: argumentValue("--binary") ?? DEFAULT_BINARY,
    outputPath
  });
  process.stdout.write(
    `${JSON.stringify({
      outputPath: path.resolve(outputPath),
      directCalls: fixture.directCalls,
      orderedWindows: fixture.orderedWindows,
      safety: fixture.safety
    }, null, 2)}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
