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

const SYMBOL_PATTERNS = Object.freeze({
  setElementIDs: "UIElementRenderTreeV13setElementIDsyyF",
  nextAvailableElementIDIterator:
    "UIElementRenderTreeV30nextAvailableElementIDIterator",
  inheritElementID: "UIElementRenderDifferenceV6ChangeO16inheritElementID",
  eventStreamDescription:
    "SystemSelectionV22eventStreamDescription_11lineOptions26ignoreDifferenceLineBudget",
  refetchElementById:
    "RefetchableSkyshotAXTreeC22refetchElementIfNeeded_08validateG0AA0C9UIElementCSi_SbtKF",
  refetchElement:
    "RefetchableSkyshotAXTreeC22refetchElementIfNeeded_08validateG017ignoreValueChange",
  refetchIfNeeded:
    "RefetchableUIElementC15refetchIfNeeded15validateElement17ignoreValueChange"
});

const STRING_MARKERS = Object.freeze({
  removedElementIds: "Removed element IDs: ",
  ambiguousBefore:
    "[RefetchableSkyshotAXTree] Multiple existing equivalent elements; cannot guarantee uniqueness",
  missingAfter:
    "[RefetchableSkyshotAXTree] Element was invalidated and could not be found after refetching",
  ambiguousAfter:
    "[RefetchableSkyshotAXTree] Multiple new equivalent elements; cannot guarantee uniqueness",
  refetchSuccess:
    "[RefetchableSkyshotAXTree] Successfully found new element: %s",
  invalidated:
    "[RefetchableSkyshotAXTree] Element is invalidated, looking up equivalent",
  stillValid: "[RefetchableSkyshotAXTree] Element is still valid"
});

const RECOVERED_ADDRESSES = Object.freeze({
  setElementIDs: "0x100693920",
  nextAvailableElementIDIterator: "0x100693bac",
  nextElementID: "0x1006948d8",
  inheritElementID: "0x10069515c",
  rootRevision: "0x1006b9afc",
  appendingRevision: "0x1006b9270",
  siblingIdComparison: "0x10069678c-0x10069682c",
  matchedTextComparison: "0x1006974cc-0x100697590",
  changeIteratorNext: "0x1006961d4",
  changeRank: "0x100694ecc-0x100695140",
  changeComparator: "0x100695e88",
  removedRangeFormatting: "0x1001c06b8",
  removedRangeFeatureFlag: "0x1001c0848",
  differenceLineBudget: "0x1001c0a6c",
  differenceLineBudgetFallback: "0x1001c0ee4-0x1001c0f6c",
  noChangeRendering: "0x1001bbd8c-0x1001bc370",
  ignoreDifferenceLineBudget: "0x1001baee4",
  revisionGetters: "0x1006b7e68-0x1006b8000",
  refetchById: "0x1001b1eb0",
  revisionItemLookup: "0x1006b89d4",
  refetchTree: "0x1001b3e38",
  refetchIfNeeded: "0x1001b4e04"
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeHome(value) {
  return value.replace(os.homedir(), "$HOME");
}

function parseSymbols(output) {
  const symbols = {};
  for (const [name, pattern] of Object.entries(SYMBOL_PATTERNS)) {
    const line = output
      .split("\n")
      .find((candidate) => candidate.includes(pattern));
    if (!line) {
      throw new Error(`Missing native AX symbol: ${name}`);
    }
    const address = line.trim().match(/^([0-9a-f]{16})\s/u)?.[1];
    if (!address) {
      throw new Error(`Could not parse native AX symbol address: ${name}`);
    }
    symbols[name] = {
      address: `0x${address}`,
      pattern
    };
  }
  return symbols;
}

function parseStrings(output) {
  const markers = {};
  for (const [name, value] of Object.entries(STRING_MARKERS)) {
    const line = output
      .split("\n")
      .find((candidate) => candidate.endsWith(value));
    if (!line) {
      throw new Error(`Missing native AX string marker: ${name}`);
    }
    const offset = line.trim().match(/^([0-9a-f]+)\s/u)?.[1];
    if (!offset) {
      throw new Error(`Could not parse native AX string offset: ${name}`);
    }
    markers[name] = {
      fileOffset: `0x${offset}`,
      value
    };
  }
  return markers;
}

export async function runNativeAxContractProbe({
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
      path: normalizeHome(servicePath),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uuid: "9E40FA2F-FC6C-3EE2-824A-E4975CA022AD",
      version: "26.710.1000387"
    },
    evidence: {
      symbols: parseSymbols(nm),
      strings: parseStrings(strings),
      recoveredAddresses: RECOVERED_ADDRESSES
    },
    contracts: {
      rootIdsAreZeroBasedDepthFirst: true,
      appendPreservesMatchedIds: true,
      newIdsStartAfterCurrentMaximum: true,
      siblingMatchingUsesRenderId: true,
      matchedNoneUpdateUsesPrimaryTextOnly: true,
      changedParentsStillRecurseIntoChildren: true,
      changeTags: {
        none: 0,
        insert: 1,
        update: 2,
        remove: 3
      },
      samePathOrder: ["none", "remove", "insert", "update"],
      removedIdsUseMaximalConsecutiveRanges: true,
      fullTreeLineCountIsDiffBudget: true,
      emptyEffectiveDiffUsesNoChangeText: true,
      refetchFailsClosedOnMissingOrAmbiguousIdentity: true,
      ignoreValueChangeOnlyRelaxesValueComparison: true
    },
    revisionFields: [
      "lineageID",
      "tree",
      "renderTree",
      "focusTree",
      "focusRenderTree",
      "ids",
      "changes",
      "previousRevision"
    ],
    refetchIdentityFields: [
      "role",
      "subrole",
      "roleDescription",
      "title",
      "description",
      "value",
      "valueDescription",
      "placeholderValue",
      "help",
      "identifier",
      "url"
    ],
    unknowns: [
      "The exact punctuation used by every native removed-range rendering branch is not asserted.",
      "The behavior model mirrors recovered contracts but is not original service source code."
    ],
    safety: {
      staticBinaryReadOnly: true,
      serviceStartedOrAttached: false,
      realComputerUseSocketContacted: false,
      uiActionsExecuted: false
    }
  };

  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const outputPath =
    argumentValue("--out") ??
    path.resolve("fixtures/native/ax-diff-refetch.json");
  const result = await runNativeAxContractProbe({ outputPath });
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
