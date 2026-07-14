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
  applicationTargetIdentifier:
    "SystemSoftware17ApplicationTargetV10identifierSSvg",
  applicationTargetIdentifierForUrl:
    "SystemSoftware17ApplicationTargetV10identifier3for",
  appInstanceTargetIdentifier: "AppInstanceC16targetIdentifierSSvg",
  managerShared: "AppInstanceManagerC6sharedACvgZ",
  managerInstance: "AppInstanceManagerC8instance3for",
  managerSetInstance: "AppInstanceManagerC03setD0",
  managerRemoveInstance: "AppInstanceManagerC06removeD03for",
  appInstanceActivate: "AppInstanceC8activateyyF",
  appInstanceDeactivate: "AppInstanceC10deactivateyyF",
  serialExecutor: "AppInstanceC14SerialExecutorC07unownedF0",
  clearStoppedByUser: "AppInstanceManagerC18clearStoppedByUser3for",
  chatID: "AppControllerC6chatIDSSSgvg",
  lastAXTreeGetter: "AppControllerC10lastAXTreeAA018RefetchableSkyshotF0CSgvg",
  lastAXTreeSetter: "AppControllerC10lastAXTreeAA018RefetchableSkyshotF0CSgvs",
  appControllerDeactivate: "AppControllerC10deactivateyyF"
});

const IVAR_PATTERNS = Object.freeze({
  chatID:
    "OBJC_IVAR_$__TtC11ComputerUse24ComputerUseAppController.chatID",
  lastAXTree:
    "OBJC_IVAR_$__TtC11ComputerUse24ComputerUseAppController.lastAXTree",
  serialExecutorTail:
    "OBJC_IVAR_$__TtCC11ComputerUse22ComputerUseAppInstance14SerialExecutor.tail",
  appInstanceApplicationTarget:
    "OBJC_IVAR_$__TtC11ComputerUse22ComputerUseAppInstance.applicationTarget",
  appInstanceAppController:
    "OBJC_IVAR_$__TtC11ComputerUse22ComputerUseAppInstance.appController",
  appInstanceSerialExecutor:
    "OBJC_IVAR_$__TtC11ComputerUse22ComputerUseAppInstance.serialExecutor",
  managerState:
    "OBJC_IVAR_$__TtC11ComputerUse29ComputerUseAppInstanceManager.state",
  conversationTargets:
    "OBJC_IVAR_$__TtC18Codex_Computer_Use30CodexComputerUseSessionTracker.targetIdentifiersByConversationID"
});

const STRING_MARKERS = Object.freeze({
  conversationId: "conversationId",
  targetIdentifiersByConversationID: "targetIdentifiersByConversationID",
  targetIdentifier: "targetIdentifier",
  chatID: "chatID",
  lastAXTree: "lastAXTree",
  conversationEnded: "Codex thread ended or stopped conversationID=%s",
  deactivateFailure:
    "Failed to deactivate Computer Use for ended Codex thread app=%s: %@"
});

const RECOVERED_ADDRESSES = Object.freeze({
  applicationTargetIdentifier: "0x1001e6508",
  applicationTargetIdentifierForUrl: "0x1001e6624",
  applicationTargetIdentifierForUrlBody: "0x1001e9128",
  appInstanceTargetIdentifier: "0x1000999f4",
  managerShared: "0x10009b964",
  managerInstance: "0x10009c1a4",
  managerSetInstance: "0x10009c22c",
  managerRemoveInstance: "0x10009a1e0",
  actorTailEnqueueBody: "0x10009b418",
  serialExecutorUnownedExecutor: "0x10009b7c0",
  appControllerChatID: "0x10006be34",
  appControllerLastAXTreeGetter: "0x10006c370",
  appControllerLastAXTreeSetter: "0x10006c3bc",
  appControllerUpdateSkyshot: "0x10006ebe4",
  baselineDirectRead: "0x10006fbcc",
  baselineReplacement: "0x100070a8c",
  appControllerDeactivate: "0x100072004",
  appInstanceDeactivate: "0x100099e98",
  requestInstanceResolutionBody: "0x10013fbd8",
  existingInstanceLookup: "0x100140008",
  existingControllerRunningApplicationRead: "0x100140050",
  existingProcessTerminatedCheck: "0x10014006c",
  liveInstanceFastReturn: "0x100140070",
  terminatedInstanceRemove: "0x1001400a8",
  newControllerAllocation: "0x10014015c",
  newControllerInitialization: "0x10014018c",
  newInstanceControllerStore: "0x100140234",
  newInstanceManagerInsert: "0x100140258",
  clearStoppedByUser: "0x10009c758",
  trackerCleanupBody: "0x10000da60",
  cleanupClearStoppedByUserCall: "0x10000dc04",
  deactivateSuccessLog: "0x10000e304",
  deactivateFailureLog: "0x10000e4b8"
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeHome(value) {
  return value.replace(os.homedir(), "$HOME");
}

function findLine(output, pattern, role) {
  const line = output
    .split("\n")
    .find((candidate) => candidate.includes(pattern));
  if (!line) {
    throw new Error(`Missing native app-instance ${role}: ${pattern}`);
  }
  return line.trim();
}

function parseAddress(line, role) {
  const address = line.match(/^([0-9a-f]{16})\s/u)?.[1];
  if (!address) {
    throw new Error(`Could not parse native app-instance ${role} address`);
  }
  return `0x${address}`;
}

function parseSymbols(output, patterns) {
  return Object.fromEntries(
    Object.entries(patterns).map(([name, pattern]) => {
      const line = findLine(output, pattern, name);
      return [
        name,
        {
          address: parseAddress(line, name),
          pattern
        }
      ];
    })
  );
}

function parseStrings(output) {
  return Object.fromEntries(
    Object.entries(STRING_MARKERS).map(([name, value]) => {
      const line = output
        .split("\n")
        .find((candidate) => candidate.endsWith(value));
      if (!line) {
        throw new Error(`Missing native app-instance string: ${name}`);
      }
      const offset = line.trim().match(/^([0-9a-f]+)\s/u)?.[1];
      if (!offset) {
        throw new Error(
          `Could not parse native app-instance string offset: ${name}`
        );
      }
      return [
        name,
        {
          fileOffset: `0x${offset}`,
          value
        }
      ];
    })
  );
}

export async function runNativeAppInstanceContractProbe({
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
  const lifecycleDisassembly = execFileSync(
    "/usr/bin/lldb",
    [
      "-b",
      "-o",
      `target create '${servicePath}'`,
      "-o",
      "disassemble -s 0x10013fdcc -e 0x10014038c",
      "-o",
      "quit"
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }
  );
  for (const marker of [
    "ldr    x1, [x8, #0x270]",
    "tbz    w0, #0x0, 0x100140364",
    "bl     0x10009c374",
    "bl     0x10009c460",
    "bl     0x10006c54c",
    "str    x23, [x22, x8]",
    "bl     0x10009c294"
  ]) {
    if (!lifecycleDisassembly.includes(marker)) {
      throw new Error(`Missing app-instance lifecycle marker: ${marker}`);
    }
  }
  if (!strings.includes("isTerminated")) {
    throw new Error("Missing app-instance lifecycle selector: isTerminated");
  }
  const result = {
    schemaVersion: 1,
    service: {
      path: normalizeHome(servicePath),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uuid: "9E40FA2F-FC6C-3EE2-824A-E4975CA022AD",
      version: "26.710.1000387"
    },
    directEvidence: {
      symbols: parseSymbols(nm, SYMBOL_PATTERNS),
      ivars: parseSymbols(nm, IVAR_PATTERNS),
      strings: parseStrings(strings)
    },
    recoveredAddresses: RECOVERED_ADDRESSES,
    contracts: {
      managerScope: "service-process-singleton",
      managerKey: "SystemSoftware.ApplicationTarget.identifier",
      managerStorage: "lock-protected Array<ComputerUseAppInstance>",
      managerLookup: "linear targetIdentifier search",
      managerInsert: "replace same targetIdentifier then append",
      managerKeyInputsExcluded: [
        "pid",
        "socket",
        "node_repl_process",
        "thread",
        "conversation",
        "chatID"
      ],
      targetIdentifierDerivedFromBundleUrl: true,
      targetIdentifierCanonicalization:
        "resolvingSymlinksInPath.standardizedFileURL.path(percentEncoded:false).stripTrailingSlashExceptRoot",
      sameTargetSharesAppInstanceAcrossTransports: "strong-static-evidence",
      sameTargetSerialization: "per-AppInstance SerialExecutor tail",
      differentTargetParallelism: "independent AppInstance executors",
      conversationTrackerShape:
        "conversationID -> Set<ApplicationTarget.identifier>",
      conversationCleanup: [
        "remove conversation tracker entry",
        "clear stopped-by-user state for each target",
        "deactivate the shared AppInstance asynchronously"
      ],
      conversationCleanupRemovesInstance: false,
      conversationCleanupChecksOtherReferences: false,
      chatIDParticipatesInManagerKey: false,
      lastAXTreeOwner: "ComputerUseAppController",
      deactivateClearsLastAXTree: false,
      crossConversationBaselineReuse: "strong-static-evidence",
      liveProcessReusesExistingInstance: true,
      liveProcessReusesExistingController: true,
      appControllerReplacedWhileProcessAlive: false,
      terminatedProcessRemovesOldInstance: true,
      terminatedProcessCreatesNewControllerAndInstance: true,
      terminatedProcessClearsLastAXTreeByControllerReplacement: true,
      baselineLifetime:
        "canonical target path plus current live NSRunningApplication instance"
    },
    ivarOffsets: {
      chatID: "0x38",
      serialExecutorTail: "0x70"
    },
    pendingDynamicExperiment: {
      executed: false,
      targetRestriction: "com.openai.codex.cualab only",
      clients: [
        "client A / conversation A / target X",
        "client B / conversation B / target X",
        "control client C / target Y"
      ],
      expectedChecks: [
        "A and B observe the same AppInstance and SerialExecutor pointers",
        "B links behind A on the same executor tail",
        "C uses a distinct executor and may overlap X",
        "ending conversation A deactivates but does not remove X",
        "B reuses the same controller and previous lastAXTree baseline"
      ]
    },
    unknowns: [
      "Exact pointer equality across two live clients still requires debugger or equivalent runtime instrumentation.",
      "No debugger attach was performed by this probe."
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
    path.resolve("fixtures/native/app-instance-isolation.json");
  const result = await runNativeAppInstanceContractProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      sha256: result.service.sha256,
      symbols: Object.keys(result.directEvidence.symbols).length,
      ivars: Object.keys(result.directEvidence.ivars).length,
      strings: Object.keys(result.directEvidence.strings).length,
      safety: result.safety
    }, null, 2)}\n`
  );
}
