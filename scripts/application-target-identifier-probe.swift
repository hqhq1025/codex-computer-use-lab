#!/usr/bin/env swift

import Foundation

struct CaseResult: Codable {
    let name: String
    let input: String
    let identifier: String
}

struct Contracts: Codable {
    let symlinkAliasConverges: Bool
    let dotSegmentsConverge: Bool
    let percentEncodedSpaceDecodes: Bool
    let trailingSlashRemoved: Bool
    let rootSlashPreserved: Bool
    let sameBundleIdDifferentPathsRemainDistinct: Bool
    let existingPathMayRecoverOnDiskCase: Bool
}

struct Safety: Codable {
    let temporaryDirectoryOnly: Bool
    let realComputerUseSocketContacted: Bool
    let uiActionsExecuted: Bool
}

struct Result: Codable {
    let schemaVersion: Int
    let algorithm: [String]
    let cases: [CaseResult]
    let contracts: Contracts
    let safety: Safety
}

func applicationTargetIdentifier(for bundleURL: URL) -> String {
    var value = bundleURL
        .resolvingSymlinksInPath()
        .standardizedFileURL
        .path(percentEncoded: false)
    while value.count > 1 && value.hasSuffix("/") {
        value.remove(at: value.index(before: value.endIndex))
    }
    return value
}

func argumentValue(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name) else {
        return nil
    }
    let valueIndex = CommandLine.arguments.index(after: index)
    guard valueIndex < CommandLine.arguments.endIndex else {
        return nil
    }
    return CommandLine.arguments[valueIndex]
}

let fileManager = FileManager.default
let root = URL(
    fileURLWithPath: "/tmp/codex-cua-application-target-identifier-probe",
    isDirectory: true
)
try? fileManager.removeItem(at: root)
defer {
    try? fileManager.removeItem(at: root)
}

let realApp = root.appendingPathComponent("Real App.app", isDirectory: true)
let secondApp = root.appendingPathComponent("Second App.app", isDirectory: true)
let alias = root.appendingPathComponent("Alias.app", isDirectory: true)
try fileManager.createDirectory(
    at: realApp,
    withIntermediateDirectories: true
)
try fileManager.createDirectory(
    at: secondApp,
    withIntermediateDirectories: true
)
try fileManager.createSymbolicLink(
    at: alias,
    withDestinationURL: realApp
)

let inputs: [(String, URL)] = [
    ("real", realApp),
    ("symlink-alias", alias),
    (
        "dot-segments",
        URL(
            fileURLWithPath:
                "\(root.path)/./temporary/../Real App.app/",
            isDirectory: true
        )
    ),
    (
        "percent-encoded-space",
        URL(
            string:
                "file:///tmp/codex-cua-application-target-identifier-probe/Real%20App.app/"
        )!
    ),
    ("root", URL(fileURLWithPath: "/", isDirectory: true)),
    ("same-bundle-id-second-path", secondApp),
    (
        "case-spelling-of-existing-path",
        URL(
            fileURLWithPath:
                "/tmp/CODEX-CUA-APPLICATION-TARGET-IDENTIFIER-PROBE/REAL APP.APP/",
            isDirectory: true
        )
    )
]

let cases = inputs.map { name, url in
    CaseResult(
        name: name,
        input: url.absoluteString,
        identifier: applicationTargetIdentifier(for: url)
    )
}
let identifiers = Dictionary(
    uniqueKeysWithValues: cases.map { ($0.name, $0.identifier) }
)
let realIdentifier = identifiers["real"]!

let result = Result(
    schemaVersion: 1,
    algorithm: [
        "URL.resolvingSymlinksInPath()",
        "URL.standardizedFileURL",
        "URL.path(percentEncoded: false)",
        "remove trailing slash while count > 1"
    ],
    cases: cases,
    contracts: Contracts(
        symlinkAliasConverges:
            identifiers["symlink-alias"] == realIdentifier,
        dotSegmentsConverge:
            identifiers["dot-segments"] == realIdentifier,
        percentEncodedSpaceDecodes:
            identifiers["percent-encoded-space"] == realIdentifier,
        trailingSlashRemoved: !realIdentifier.hasSuffix("/"),
        rootSlashPreserved: identifiers["root"] == "/",
        sameBundleIdDifferentPathsRemainDistinct:
            identifiers["same-bundle-id-second-path"] != realIdentifier,
        existingPathMayRecoverOnDiskCase:
            identifiers["case-spelling-of-existing-path"] == realIdentifier
    ),
    safety: Safety(
        temporaryDirectoryOnly: true,
        realComputerUseSocketContacted: false,
        uiActionsExecuted: false
    )
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let data = try encoder.encode(result)
let output = data + Data([0x0A])

if let outputPath = argumentValue("--out") {
    try output.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
} else {
    FileHandle.standardOutput.write(output)
}
