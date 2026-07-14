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

const ADDRESSES = Object.freeze({
  applicationTargetInitializer: "0x1001e6544",
  exportedEntry: "0x1001e6624",
  implementationBody: "0x1001e9128",
  resolveApplicationTarget: "0x1001e6940",
  applicationTargets: "0x1001e6dbc",
  resolvePreferringRunningApplication: "0x1001e7324",
  runningApplicationTargets: "0x1001e7548",
  runningApplicationMatcher: "0x1001e7608",
  ambiguityBuilder: "0x1001e7048",
  candidateResolver: "0x1001e9324",
  runningTargetsBody: "0x1001e956c",
  resolvingSymlinksCall: "0x1001e919c",
  standardizedFileUrlCall: "0x1001e91a8",
  decodedPathCall: "0x1001e91c4",
  countCall: "0x1001e91e8",
  indexBeforeCall: "0x1001e9228",
  removeCall: "0x1001e9230",
  slashLiteral: "0x1001e9254",
  hasSuffixCall: "0x1001e9264"
});

const CALLSITES = Object.freeze([
  {
    address: "0x1000547e8",
    callTarget: "0x1001e6624",
    owner: "AppUsageCatalog running/installed application catalog",
    evidence: "recovered static callsite"
  },
  {
    address: "0x100056b98",
    callTarget: "0x1001e6624",
    owner: "AppUsageCatalog Spotlight kMDItemPath catalog",
    evidence: "recovered static callsite"
  },
  {
    address: "0x100057edc",
    callTarget: "0x1001e6624",
    owner: "AppUsageCatalog .app fallback",
    evidence: "recovered static callsite"
  },
  {
    address: "0x1000a99f0",
    callTarget: "0x1001e6624",
    owner: "ComputerUseUserInteractionMonitor target resolution",
    evidence: "recovered static callsite"
  },
  {
    address: "0x1001e65e4",
    callTarget: "0x1001e9128",
    owner: "ApplicationTarget.init cached identifier",
    evidence: "direct symbol control flow"
  },
  {
    address: "0x1001e6d1c",
    callTarget: "0x1001e9128",
    owner: "NSBundle(path:) to ApplicationTarget helper",
    evidence: "direct selector and control flow"
  },
  {
    address: "0x1001e76c8",
    callTarget: "0x1001e9128",
    owner: "running application bundle URL identity comparison",
    evidence: "direct selector and control flow"
  },
  {
    address: "0x1001e7870",
    callTarget: "0x1001e9128",
    owner: "running application to ApplicationTarget construction",
    evidence: "direct selector and control flow"
  }
]);

const IMPORTS = Object.freeze([
  {
    callTarget: "0x100ccdaf0",
    got: "0x100EFE760",
    symbol: "_$s10Foundation3URLV23resolvingSymlinksInPathACyF",
    api: "Foundation.URL.resolvingSymlinksInPath()"
  },
  {
    callTarget: "0x100ccda48",
    got: "0x100EFE6D0",
    symbol: "_$s10Foundation3URLV016standardizedFileB0ACvg",
    api: "Foundation.URL.standardizedFileURL"
  },
  {
    callTarget: "0x100ccdb44",
    got: "0x100EFE798",
    symbol: "_$s10Foundation3URLV4path14percentEncodedSSSb_tF",
    api: "Foundation.URL.path(percentEncoded:)"
  },
  {
    callTarget: "0x100ccf884",
    got: "0x100F01478",
    symbol: "_$sSS5countSivg",
    api: "Swift.String.count"
  },
  {
    callTarget: "0x100ccf89c",
    got: "0x100F01488",
    symbol: "_$sSS5index6beforeSS5IndexVAD_tF",
    api: "Swift.String.index(before:)"
  },
  {
    callTarget: "0x100ccf914",
    got: "0x100F014D8",
    symbol: "_$sSS6remove2atSJSS5IndexV_tF",
    api: "Swift.String.remove(at:)"
  },
  {
    callTarget: "0x100ccfa10",
    got: "0x100F01598",
    symbol: "_$sSS9hasSuffixySbSSF",
    api: "Swift.String.hasSuffix(_:)"
  }
]);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeHome(value) {
  return value.replace(os.homedir(), "$HOME");
}

function run(command, args, maxBuffer = 32 * 1024 * 1024) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer
  });
}

function requireIncludes(output, marker, description) {
  if (!output.includes(marker)) {
    throw new Error(`Missing ${description}: ${marker}`);
  }
}

function fixupLine(output, got, symbol) {
  const normalizedGot = got.toUpperCase();
  const line = output
    .split("\n")
    .find(
      (candidate) =>
        candidate.toUpperCase().includes(normalizedGot) &&
        candidate.includes(symbol)
    );
  if (!line) {
    throw new Error(`Missing fixup ${got} -> ${symbol}`);
  }
  return line.trim().replace(/\s+/gu, " ");
}

export async function runApplicationTargetIdentifierStaticProbe({
  outputPath,
  servicePath = SERVICE_PATH
} = {}) {
  const bytes = await readFile(servicePath);
  const nm = run("nm", ["-arch", "arm64", "-an", servicePath]);
  const fixups = run("xcrun", ["dyld_info", "-fixups", servicePath]);
  const strings = run("strings", ["-a", "-t", "x", servicePath]);
  const lldb = run("/usr/bin/lldb", [
    "-b",
    "-o",
    `target create '${servicePath}'`,
    "-o",
    "disassemble -s 0x1001e6624 -c 2",
    "-o",
    "disassemble -s 0x1001e9128 -c 95",
    "-o",
    "disassemble -s 0x1001e6544 -c 56",
    "-o",
    "disassemble -s 0x1001e6bcc -c 112",
    "-o",
    "disassemble -s 0x1001e6dbc -c 70",
    "-o",
    "disassemble -s 0x1001e7324 -c 142",
    "-o",
    "disassemble -s 0x1001e754c -c 138",
    "-o",
    "disassemble -s 0x1001e79e4 -c 82",
    "-o",
    "disassemble -s 0x1000547d8 -c 8",
    "-o",
    "disassemble -s 0x100056b88 -c 8",
    "-o",
    "disassemble -s 0x100057ecc -c 8",
    "-o",
    "disassemble -s 0x1000a99e0 -c 8",
    "-o",
    "disassemble -s 0x1001e65dc -c 6",
    "-o",
    "disassemble -s 0x1001e6d14 -c 6",
    "-o",
    "disassemble -s 0x1001e76c0 -c 6",
    "-o",
    "disassemble -s 0x1001e7868 -c 6",
    "-o",
    "quit"
  ]);

  requireIncludes(
    nm,
    "00000001001e6624 T _$s14SystemSoftware17ApplicationTargetV10identifier3forSS10Foundation3URLV_tFZ",
    "exported identifier(for:) symbol"
  );
  requireIncludes(
    lldb,
    "b      0x1001e9128",
    "export-to-body trampoline"
  );

  for (const imported of IMPORTS) {
    requireIncludes(
      lldb,
      `bl     ${imported.callTarget}`,
      `${imported.api} call`
    );
  }
  requireIncludes(lldb, "mov    w0, #0x0", "percentEncoded false literal");
  requireIncludes(lldb, "cmp    x0, #0x2", "minimum-length guard");
  requireIncludes(lldb, "mov    w0, #0x2f", "slash literal");
  requireIncludes(lldb, "tbz    w0, #0x0", "hasSuffix false exit");
  requireIncludes(
    lldb,
    "ldr    x1, [x8, #0x228]",
    "initWithPath selector reference"
  );
  requireIncludes(
    lldb,
    "ldr    x1, [x8, #0x570]",
    "URLsForApplicationsWithBundleIdentifier selector reference"
  );
  requireIncludes(
    lldb,
    "ldr    x1, [x8, #0x338]",
    "runningApplicationsWithBundleIdentifier selector reference"
  );
  requireIncludes(
    lldb,
    "ldr    x1, [x8, #0x870]",
    "bundleURL selector reference"
  );
  for (const selector of [
    "initWithPath:",
    "URLsForApplicationsWithBundleIdentifier:",
    "runningApplicationsWithBundleIdentifier:",
    "bundleURL"
  ]) {
    requireIncludes(strings, selector, `${selector} selector string`);
  }
  requireIncludes(
    strings,
    "Ambiguous app identifier '",
    "ambiguous bundle identifier message"
  );
  requireIncludes(
    strings,
    ". Use an app name or full app path instead.",
    "ambiguity resolution guidance"
  );
  for (const callsite of CALLSITES) {
    requireIncludes(
      lldb,
      `SkyComputerUseService[${callsite.address}]`,
      `${callsite.owner} address`
    );
    const callsiteOffset = lldb.indexOf(
      `SkyComputerUseService[${callsite.address}]`
    );
    const callsiteWindow = lldb.slice(callsiteOffset, callsiteOffset + 180);
    requireIncludes(
      callsiteWindow,
      `bl     ${callsite.callTarget}`,
      `${callsite.owner} canonicalizer call`
    );
  }

  const callOffsets = IMPORTS.map((imported) => lldb.indexOf(
    `bl     ${imported.callTarget}`
  ));
  if (callOffsets.some((offset) => offset < 0)) {
    throw new Error("Could not recover every identifier call offset");
  }
  if (
    !(
      callOffsets[0] < callOffsets[1] &&
      callOffsets[1] < callOffsets[2] &&
      callOffsets[2] < callOffsets[3] &&
      callOffsets[3] < callOffsets[4] &&
      callOffsets[4] < callOffsets[5] &&
      callOffsets[5] < callOffsets[6]
    )
  ) {
    throw new Error("Identifier call sequence changed");
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
    addresses: ADDRESSES,
    callsites: CALLSITES,
    imports: IMPORTS.map((imported) => ({
      ...imported,
      fixupEvidence: fixupLine(fixups, imported.got, imported.symbol)
    })),
    recoveredSource: [
      "static func identifier(for bundleURL: URL) -> String {",
      "  var value = bundleURL.resolvingSymlinksInPath()",
      "    .standardizedFileURL",
      "    .path(percentEncoded: false)",
      "  while value.count > 1 && value.hasSuffix(\"/\") {",
      "    value.remove(at: value.index(before: value.endIndex))",
      "  }",
      "  return value",
      "}"
    ],
    targetConstruction: {
      initializer:
        "ApplicationTarget.init stores bundleIdentifier, canonicalizes bundleURL, then caches identifier",
      pathInput:
        "NSBundle(path:) -> bundleIdentifier -> ApplicationTarget",
      installedLookup:
        "NSWorkspace.URLsForApplications(withBundleIdentifier:)",
      runningLookup:
        "NSRunningApplication.runningApplications(withBundleIdentifier:)",
      candidateDeduplication:
        "canonical ApplicationTarget.identifier",
      noCandidate:
        "BundleIDLookupError.appNotFound",
      multipleCandidates:
        "BundleIDLookupError.ambiguousBundleIdentifier",
      preferredResolution:
        "running candidates first; installed candidates only when no running candidate exists"
    },
    contracts: {
      sourceRepresentation: "decoded standardized filesystem path",
      resolvesSymlinks: true,
      standardizesFileUrl: true,
      percentEncodedPath: false,
      stripsTrailingSlashExceptRoot: true,
      hashesPath: false,
      usesBundleIdentifier: false,
      includesUrlScheme: false,
      lowercasesExplicitly: false
    },
    resolutionContracts: {
      identifierCachedAtTargetInitialization: true,
      symlinkAliasesDeduplicate: true,
      separateInstallPathsRemainDistinct: true,
      installedAndRunningCandidateSetsAreMergedByCanonicalIdentifier: true,
      singleCandidateReturned: true,
      zeroCandidatesFailClosed: true,
      multipleCandidatesFailClosed: true,
      ambiguousBundleIdDoesNotSelectArbitraryFirstCandidate: true,
      preferRunningFallsBackOnlyWhenNoRunningCandidateExists: true,
      ambiguityGuidance: "Use an app name or full app path instead."
    },
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
    path.resolve("fixtures/native/application-target-identifier-static.json");
  const result = await runApplicationTargetIdentifierStaticProbe({
    outputPath
  });
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      sha256: result.service.sha256,
      implementationBody: result.addresses.implementationBody,
      imports: result.imports.length,
      safety: result.safety
    }, null, 2)}\n`
  );
}
