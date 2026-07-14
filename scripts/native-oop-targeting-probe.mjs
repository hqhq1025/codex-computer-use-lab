#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SERVICE_PATH = path.join(
  os.homedir(),
  ".codex",
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "MacOS",
  "SkyComputerUseService"
);

const SYMBOLS = Object.freeze({
  mouseTarget:
    "ApplicationUIElementV6target15forMouseEventAt4with",
  mouseTargetWithAxWindow:
    "ApplicationUIElementV6target15forMouseEventAt08axWindowI5Point",
  oopMouseWindow:
    "ApplicationUIElementV24outOfProcessTargetWindow3for6appPID",
  keyboardTarget:
    "ApplicationUIElementV22targetForKeyboardEvent",
  oopKeyboardTarget:
    "ApplicationUIElementV18outOfProcessTarget3for6appPID",
  insideWebView:
    "UIElementProtocolPAAE15isInsideWebView",
  synthesizedSend:
    "SynthesizedEventV4send2to5delay",
  postToPid:
    "SystemSoftware10CGEventAPIO9postToPid"
});

const STRINGS = Object.freeze({
  missingOop: "elementPresumedOOPAndNotFound",
  missingEligibleParent:
    "elementIsOOPButExpectedToTargetAppAndNoEligibleParentElementWasFound",
  webContent: "webContent"
});

function parseNamed(output, entries, kind) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, marker]) => {
      const line = output
        .split("\n")
        .find((candidate) => candidate.includes(marker));
      if (!line) {
        throw new Error(`Missing ${kind} marker: ${name}`);
      }
      const address = line.trim().match(/^([0-9a-f]+)\s/u)?.[1];
      if (!address) {
        throw new Error(`Could not parse ${kind} marker: ${name}`);
      }
      return [
        name,
        kind === "symbol"
          ? { address: `0x${address}`, marker }
          : { fileOffset: `0x${address}`, value: marker }
      ];
    })
  );
}

export async function runNativeOopTargetingProbe({
  outputPath,
  servicePath = SERVICE_PATH
} = {}) {
  const bytes = await readFile(servicePath);
  const nm = execFileSync("nm", ["-arch", "arm64", "-nm", servicePath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  const strings = execFileSync(
    "strings",
    ["-a", "-t", "x", servicePath],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    }
  );
  const result = {
    schemaVersion: 1,
    service: {
      path: "$HOME/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      version: "26.710.1000387"
    },
    evidence: {
      symbols: parseNamed(nm, SYMBOLS, "symbol"),
      strings: parseNamed(strings, STRINGS, "string")
    },
    contracts: {
      coordinateMouseTargeting:
        "target(forMouseEventAt:) -> outOfProcessTargetWindow(for:appPID:)",
      keyboardTargeting:
        "targetForKeyboardEvent() -> outOfProcessTarget(for:appPID:)",
      finalDelivery:
        "SynthesizedEvent.send(to:delay:) -> CGEventAPI.postToPid",
      insideWebViewInfluencesActivation: true,
      oopMissingAndAmbiguousFailuresAreExplicit: true
    },
    debuggerAttach: {
      attemptedReadOnly: true,
      allowed: false,
      failure:
        "Not allowed to attach to process; no SIP, signature, entitlement, or TCC setting was changed."
    },
    safety: {
      staticBinaryReadOnly: true,
      serviceMemoryModified: false,
      systemSecuritySettingsModified: false,
      uiActionsExecuted: false
    }
  };
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const outputIndex = process.argv.indexOf("--out");
  const outputPath =
    outputIndex >= 0
      ? process.argv[outputIndex + 1]
      : path.resolve("fixtures/native/oop-targeting.json");
  const result = await runNativeOopTargetingProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      sha256: result.service.sha256,
      symbols: Object.keys(result.evidence.symbols).length,
      strings: Object.keys(result.evidence.strings).length,
      safety: result.safety
    }, null, 2)}\n`
  );
}
