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
  isWebBrowser:
    "AccessibilitySupport20ApplicationUIElementV12isWebBrowserSbvg",
  webAreaUrl:
    "AccessibilitySupport16WebAreaUIElementV3url10Foundation3URLVSgvg",
  elementUrl:
    "AccessibilitySupport17UIElementProtocolPAAE3url10Foundation3URLVSgvg",
  urlPolicyNotification:
    "eventStreamServiceURLPolicyStateDidChange",
  appPolicyProvider:
    "_OBJC_CLASS_$__TtC11ComputerUse39CodexAppServerComputerUsePolicyProvider",
  urlBlocklistCache:
    "_OBJC_CLASS_$__TtC11ComputerUse28ComputerUseURLBlocklistCache"
});
const STRINGS = Object.freeze({
  addressField: "WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD",
  accountHeader: "ChatGPT-Account-ID",
  featureStatus: "feature_status",
  stopped:
    "Computer Use stopped due to encountering a disallowed URL: ",
  blockedUserMessage:
    "This session has been stopped because Computer Use is not allowed on the current browser URL.",
  failOpenLog: "URL blocklist check failed for %s: %{public}s"
});

function parse(output, entries, type) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, marker]) => {
      const line = output
        .split("\n")
        .find((candidate) => candidate.includes(marker));
      if (!line) {
        throw new Error(`Missing URL policy ${type}: ${name}`);
      }
      const address = line.trim().match(/^([0-9a-f]+)\s/u)?.[1];
      return [
        name,
        type === "symbol"
          ? { address: address ? `0x${address}` : null, marker }
          : { fileOffset: address ? `0x${address}` : null, value: marker }
      ];
    })
  );
}

export async function runNativeUrlPolicyProbe({
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
      symbols: parse(nm, SYMBOLS, "symbol"),
      strings: parse(strings, STRINGS, "string"),
      recoveredAddresses: {
        checkerFailureLog: "0x1001427d4",
        checkerFailOpenReturn: "0x1001428ac",
        urlObservationCallback: "0x1000a55b4",
        blockedCompletion: "0x1000a546c",
        blockedLogReference: "0x1000a5538",
        actionHandler: "0x10012df9c",
        getStateHandler: "0x100136904",
        requestHandler: "0x10013f9e4"
      }
    },
    contracts: {
      onlyWebBrowsersUseUrlPolicy: true,
      currentUrlComesFromAccessibility: true,
      checkerReturnsIsAllowedAndServiceStoresIsBlocked: true,
      checkerFailureBehavior: "fail-open",
      blockedUrlErrorCode: -10015,
      urlChangesAreObservedAsynchronously: true,
      actionAndUrlPolicyAreNotAtomic: true,
      acceptedSideEffectsCannotBeRolledBackAfterBlockedRedirect: true
    },
    unknowns: [
      "Address-field versus WebArea URL priority is not recovered.",
      "Aura endpoint path, response schema, and concrete TTL constants remain private.",
      "Only AX-visible current URL is confirmed; HTTP redirect intermediates are not observed."
    ],
    safety: {
      staticBinaryReadOnly: true,
      auraNetworkContacted: false,
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
      : path.resolve("fixtures/native/url-policy.json");
  const result = await runNativeUrlPolicyProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      sha256: result.service.sha256,
      contracts: result.contracts,
      safety: result.safety
    }, null, 2)}\n`
  );
}
