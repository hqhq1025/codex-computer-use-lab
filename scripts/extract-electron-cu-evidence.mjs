#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(new URL("..", import.meta.url).pathname);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readExactly(fileDescriptor, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(
      fileDescriptor,
      buffer,
      offset,
      buffer.length - offset,
      position + offset
    );
    if (bytesRead === 0) {
      throw new Error(`Unexpected end of file at byte ${position + offset}`);
    }
    offset += bytesRead;
  }
}

function openAsar(asarPath) {
  const fileDescriptor = openSync(asarPath, "r");
  try {
    const sizePickle = Buffer.alloc(8);
    readExactly(fileDescriptor, sizePickle, 0);
    const headerSize = sizePickle.readUInt32LE(4);

    const headerPickle = Buffer.alloc(headerSize);
    readExactly(fileDescriptor, headerPickle, 8);
    const headerStringSize = headerPickle.readUInt32LE(4);
    const header = JSON.parse(
      headerPickle.subarray(8, 8 + headerStringSize).toString("utf8")
    );
    const dataStart = 8 + headerSize;
    const entries = [];

    function visit(node, prefix = "") {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const archivePath = prefix ? `${prefix}/${name}` : name;
        if (entry.files) {
          visit(entry, archivePath);
          continue;
        }
        entries.push({
          path: archivePath,
          size: entry.size ?? 0,
          offset: entry.unpacked ? null : dataStart + Number(entry.offset),
          unpacked: entry.unpacked === true
        });
      }
    }

    visit(header);
    return {
      archiveBytes: fstatSync(fileDescriptor).size,
      dataStart,
      entries,
      fileDescriptor,
      headerSize
    };
  } catch (error) {
    closeSync(fileDescriptor);
    throw error;
  }
}

function readArchiveEntry(archive, entry) {
  if (entry.unpacked || entry.offset == null) {
    throw new Error(`Refusing to read unpacked ASAR entry: ${entry.path}`);
  }
  const buffer = Buffer.alloc(entry.size);
  readExactly(archive.fileDescriptor, buffer, entry.offset);
  return buffer.toString("utf8");
}

function selectRoleFile(archive, role, predicate, anchor) {
  const candidates = archive.entries
    .filter(predicate)
    .sort((left, right) => right.size - left.size);
  let scannedBytes = 0;

  for (const entry of candidates) {
    const content = readArchiveEntry(archive, entry);
    scannedBytes += entry.size;
    if (content.includes(anchor)) {
      return {
        content,
        entry,
        scan: {
          candidateCount: candidates.length,
          scannedBytes
        }
      };
    }
  }

  throw new Error(`Could not locate ${role} ASAR file using anchor ${anchor}`);
}

function nearbySymbols(content, anchorOffset) {
  const prefix = content.slice(Math.max(0, anchorOffset - 1200), anchorOffset);
  const symbols = [];
  for (const expression of [
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
    /\b([A-Za-z_$][\w$]*)=class\b/g
  ]) {
    for (const match of prefix.matchAll(expression)) {
      symbols.push(match[1]);
    }
  }
  return [...new Set(symbols)].slice(-4);
}

function extractContext(source, definition) {
  let searchOffset = 0;
  while (searchOffset < source.content.length) {
    const anchorOffset = source.content.indexOf(definition.anchor, searchOffset);
    if (anchorOffset < 0) {
      break;
    }
    const start = Math.max(0, anchorOffset - definition.before);
    const end = Math.min(
      source.content.length,
      anchorOffset + definition.anchor.length + definition.after
    );
    const rawContext = source.content.slice(start, end);
    if (definition.markers.every((marker) => rawContext.includes(marker))) {
      return {
        id: definition.id,
        role: definition.role,
        file: source.entry.path,
        fileOffset: anchorOffset,
        anchor: definition.anchor,
        nearbySymbols: nearbySymbols(source.content, anchorOffset),
        markers: definition.markers,
        context: rawContext.replace(/\s+/g, " ").trim()
      };
    }
    searchOffset = anchorOffset + definition.anchor.length;
  }

  throw new Error(
    `Missing ${definition.id} context in ${source.entry.path}; anchor=${definition.anchor}`
  );
}

function parseSimpleToml(content) {
  const sections = new Map();
  let section = "";
  sections.set(section, new Map());

  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (!sections.has(section)) {
        sections.set(section, new Map());
      }
      continue;
    }

    const valueMatch = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/);
    if (!valueMatch) {
      continue;
    }
    sections.get(section).set(valueMatch[1], parseSimpleTomlValue(valueMatch[2]));
  }

  return sections;
}

function parseSimpleTomlValue(rawValue) {
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("[") && rawValue.endsWith("]"))
  ) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }
  return rawValue;
}

function selectedSection(sections, sectionName, keys) {
  const section = sections.get(sectionName);
  if (!section) {
    return null;
  }
  return Object.fromEntries(
    keys.filter((key) => section.has(key)).map((key) => [key, section.get(key)])
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function commandOutput(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout ?? 5000
    }).trim();
  } catch {
    return null;
  }
}

function plistValue(plistPath, key) {
  return commandOutput("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    plistPath
  ]);
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function normalizeString(value, { appPath, homeDirectory }) {
  return value
    .replaceAll(homeDirectory, "$HOME")
    .replaceAll(appPath, "$APP");
}

function normalizeObject(value, paths) {
  if (typeof value === "string") {
    return normalizeString(value, paths);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeObject(item, paths));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeObject(item, paths)
      ])
    );
  }
  return value;
}

async function findCachedPluginRoot(cacheRoot, expectedVersion) {
  if (!existsSync(cacheRoot)) {
    return null;
  }
  const versions = (await readdir(cacheRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (versions.includes(expectedVersion)) {
    return path.join(cacheRoot, expectedVersion);
  }

  for (const version of versions) {
    const pluginRoot = path.join(cacheRoot, version);
    const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
    if (existsSync(manifestPath) && readJson(manifestPath).name === "computer-use") {
      return pluginRoot;
    }
  }
  return null;
}

function processSnapshot({ appPath, canonicalServicePath }) {
  const output = commandOutput("/bin/ps", ["-axo", "pid=,ppid=,command="]);
  if (output == null) {
    return {
      electronMain: { running: false },
      appServer: { running: false },
      skyService: { running: false }
    };
  }

  const rows = output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }]
      : [];
  });
  const electronExecutable = path.join(appPath, "Contents", "MacOS", "ChatGPT");
  const codexExecutable = path.join(
    appPath,
    "Contents",
    "Resources",
    "codex"
  );
  const skyExecutable = path.join(
    canonicalServicePath,
    "Contents",
    "MacOS",
    "SkyComputerUseService"
  );
  const electron = rows.find((row) => row.command === electronExecutable);
  const appServer = rows.find(
    (row) =>
      row.ppid === electron?.pid &&
      row.command.startsWith(codexExecutable) &&
      /(?:^|\s)app-server(?:\s|$)/.test(row.command)
  );
  const skyService = rows.find(
    (row) => row.ppid === electron?.pid && row.command === skyExecutable
  );

  return {
    electronMain: {
      running: electron != null,
      command: electron?.command ?? null
    },
    appServer: {
      running: appServer != null,
      parentIsElectronMain: appServer != null && electron != null,
      command: appServer?.command ?? null
    },
    skyService: {
      running: skyService != null,
      parentIsElectronMain: skyService != null && electron != null,
      executableMatchesCanonicalPath: skyService?.command === skyExecutable,
      command: skyService?.command ?? null
    }
  };
}

function fileFingerprint(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return {
    bytes: statSync(filePath).size,
    sha256: sha256(filePath)
  };
}

const topicDefinitions = [
  {
    id: "bundled-cache-materialization",
    role: "main",
    anchor: "copy_plugins",
    before: 500,
    after: 1800,
    markers: ["copy_plugins", "replace_target", "rename_staging", "Eo({"]
  },
  {
    id: "node-repl-content-variant",
    role: "main",
    anchor: "computer-use-node-repl.md",
    before: 500,
    after: 1300,
    markers: ["computer-use-node-repl.md", "bundledContentVariant", "node-repl"]
  },
  {
    id: "local-to-bundled-migration",
    role: "main",
    anchor: "computer_use_local_to_bundled_migration_uninstalled_local",
    before: 900,
    after: 2300,
    markers: [
      "uninstallPlugin",
      "trashItem",
      "computer_use_local_to_bundled_migration_removed_config",
      "computer_use_local_to_bundled_migration_installed_bundled"
    ]
  },
  {
    id: "variant-selection",
    role: "main",
    anchor: "legacy-mcp",
    before: 500,
    after: 350,
    markers: ["computerUseNodeRepl", "node-repl", "legacy-mcp"]
  },
  {
    id: "config-batch-write",
    role: "main",
    anchor: "config/batchWrite",
    before: 750,
    after: 450,
    markers: ["features.js_repl", "config/batchWrite", "reloadUserConfig"]
  },
  {
    id: "legacy-mcp-disabled",
    role: "main",
    anchor: "SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
    before: 350,
    after: 500,
    markers: ["args:[`mcp`]", "cwd:`.`", "enabled:!1"]
  },
  {
    id: "node-repl-computer-use-env",
    role: "main",
    anchor: "SKY_CUA_SERVICE_PATH",
    before: 350,
    after: 750,
    markers: [
      "NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE",
      "SKY_CUA_SERVICE_PATH",
      "serviceAppPath"
    ]
  },
  {
    id: "canonical-service-sync",
    role: "main",
    anchor: "CODEX_ELECTRON_SKIP_COMPUTER_USE_CANONICAL_REFRESH",
    before: 550,
    after: 1150,
    markers: ["Codex Computer Use.app", "ditto", "--noqtn"]
  },
  {
    id: "managed-service-spawn",
    role: "main",
    anchor: "Failed to spawn managed Computer Use service",
    before: 1800,
    after: 300,
    markers: [
      "SkyComputerUseService",
      "spawnService",
      "Failed to spawn managed Computer Use service"
    ]
  },
  {
    id: "approval-result-persistence",
    role: "main",
    anchor: "approvalPersistence",
    before: 1900,
    after: 500,
    markers: ["persist", "always", "session", "_meta?.persist"]
  },
  {
    id: "approval-store",
    role: "main",
    anchor: "ComputerUseAppApprovals.json",
    before: 1000,
    after: 2100,
    markers: [
      "approvedBundleIdentifiers",
      "Group Containers",
      "ComputerUseAppApprovals.json",
      "JSON.stringify"
    ]
  },
  {
    id: "locked-use-installer",
    role: "main",
    anchor: "Codex Computer Use Installer.app",
    before: 500,
    after: 1900,
    markers: ["install", "uninstall", "status", "OK: installed"]
  },
  {
    id: "sound-defaults-persistence",
    role: "main",
    anchor: "computerUseSoundMode",
    before: 300,
    after: 650,
    markers: ["/usr/bin/defaults", "read", "write", "computerUseSoundMode"]
  },
  {
    id: "pip-host-setting",
    role: "main",
    anchor: "Remote hosted PiP availability changed",
    before: 950,
    after: 350,
    markers: ["cuaPIP", "alwaysHidePictureInPicture", "settingsStore.getEffective"]
  },
  {
    id: "settings-install-surface",
    role: "settings",
    anchor: "settings.computerUse.install.button",
    before: 700,
    after: 800,
    markers: [
      "Computer Use plugins unavailable",
      "Button label for installing a computer use plugin",
      "Install"
    ]
  },
  {
    id: "settings-sound-modes",
    role: "settings",
    anchor: "settings.computerUse.sounds.foregroundClicks",
    before: 200,
    after: 900,
    markers: [
      "foregroundClicks",
      "foregroundAndBackgroundClicks",
      "Don’t play sounds"
    ]
  },
  {
    id: "settings-pip",
    role: "settings",
    anchor: "settings.computerUse.pictureInPicture.alwaysHide.label",
    before: 350,
    after: 1050,
    markers: ["Always hide picture in picture", "alwaysHidePictureInPicture"]
  },
  {
    id: "settings-locked-use",
    role: "settings",
    anchor: "settings.computerUse.backgroundAuth.label",
    before: 850,
    after: 2200,
    markers: [
      "Locked use",
      "Let ChatGPT use your Mac when it's locked",
      "settings.computerUse.backgroundAuth.ariaLabel"
    ]
  },
  {
    id: "settings-always-allowed-apps",
    role: "settings",
    anchor: "settings.computerUse.allowedApps.removeDialogTitle",
    before: 850,
    after: 1450,
    markers: [
      "always allowed apps",
      "next computer use session",
      "settings.computerUse.allowedApps.removeDialogConfirm"
    ]
  },
  {
    id: "app-approval-ui",
    role: "approval-ui",
    anchor: "composer.computerUseAppApproval.action.alwaysApprove",
    before: 1250,
    after: 1500,
    markers: [
      "Allow ChatGPT to use {appDisplayName}?",
      "Always allow",
      "Allow this conversation",
      "persistModes.includes(`session`)",
      "l(`accept`,`always`)"
    ]
  }
];

export async function extractElectronComputerUseEvidence(options = {}) {
  const appPath = options.appPath ?? "/Applications/ChatGPT.app";
  const homeDirectory = options.homeDirectory ?? process.env.HOME;
  if (!homeDirectory) {
    throw new Error("HOME is required");
  }
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const asarPath =
    options.asarPath ?? path.join(resourcesPath, "app.asar");
  const configPath = path.join(homeDirectory, ".codex", "config.toml");
  const sourcePluginRoot = path.join(
    resourcesPath,
    "plugins",
    "openai-bundled",
    "plugins",
    "computer-use"
  );
  const sourceManifestPath = path.join(
    sourcePluginRoot,
    ".codex-plugin",
    "plugin.json"
  );
  const sourceManifest = readJson(sourceManifestPath);
  const cacheRoot = path.join(
    homeDirectory,
    ".codex",
    "plugins",
    "cache",
    "openai-bundled",
    "computer-use"
  );
  const cachedPluginRoot = await findCachedPluginRoot(
    cacheRoot,
    sourceManifest.version
  );
  if (cachedPluginRoot == null) {
    throw new Error("Installed Computer Use plugin cache was not found");
  }
  const cachedManifestPath = path.join(
    cachedPluginRoot,
    ".codex-plugin",
    "plugin.json"
  );
  const cachedManifest = readJson(cachedManifestPath);
  const canonicalServicePath = path.join(
    homeDirectory,
    ".codex",
    "computer-use",
    "Codex Computer Use.app"
  );
  const sourceServicePath = path.join(
    sourcePluginRoot,
    "Codex Computer Use.app"
  );
  const cachedServicePath = path.join(
    cachedPluginRoot,
    "Codex Computer Use.app"
  );
  const installerPath = path.join(
    canonicalServicePath,
    "Contents",
    "SharedSupport",
    "Codex Computer Use Installer.app",
    "Contents",
    "MacOS",
    "Codex Computer Use Installer"
  );
  const approvalStorePath = path.join(
    homeDirectory,
    "Library",
    "Group Containers",
    "2DC432GLL2.com.openai.sky.CUAService",
    "Library",
    "Application Support",
    "Software",
    "ComputerUseAppApprovals.json"
  );

  const archive = openAsar(asarPath);
  try {
    const roles = {
      main: selectRoleFile(
        archive,
        "main process bundle",
        (entry) =>
          /^\.vite\/build\/main-[^/]+\.js$/.test(entry.path) &&
          !entry.unpacked,
        "ComputerUseLocalToBundledMigration"
      ),
      settings: selectRoleFile(
        archive,
        "Computer Use settings chunk",
        (entry) =>
          /^webview\/assets\/computer-use-settings-[^/]+\.js$/.test(
            entry.path
          ) && !entry.unpacked,
        "settings.computerUse.backgroundAuth.label"
      ),
      "approval-ui": selectRoleFile(
        archive,
        "Computer Use approval UI chunk",
        (entry) =>
          /^webview\/assets\/app-initial[^/]*\.js$/.test(entry.path) &&
          !entry.unpacked,
        "composer.computerUseAppApproval.action.alwaysApprove"
      )
    };
    const staticEvidence = topicDefinitions.map((definition) =>
      extractContext(roles[definition.role], definition)
    );

    const config = parseSimpleToml(readFileSync(configPath, "utf8"));
    const normalizedPaths = { appPath, homeDirectory };
    const sourceBinary = path.join(
      sourceServicePath,
      "Contents",
      "MacOS",
      "SkyComputerUseService"
    );
    const cacheBinary = path.join(
      cachedServicePath,
      "Contents",
      "MacOS",
      "SkyComputerUseService"
    );
    const canonicalBinary = path.join(
      canonicalServicePath,
      "Contents",
      "MacOS",
      "SkyComputerUseService"
    );
    const sourceFingerprint = fileFingerprint(sourceBinary);
    const cacheFingerprint = fileFingerprint(cacheBinary);
    const canonicalFingerprint = fileFingerprint(canonicalBinary);
    const soundMode = commandOutput("/usr/bin/defaults", [
      "read",
      "com.openai.sky.CUAService",
      "computerUseSoundMode"
    ]);
    const processState = processSnapshot({
      appPath,
      canonicalServicePath
    });
    const approvalStoreExists = existsSync(approvalStorePath);

    return normalizeObject(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: {
          appPath,
          appVersion: plistValue(
            path.join(appPath, "Contents", "Info.plist"),
            "CFBundleShortVersionString"
          ),
          appBuild: plistValue(
            path.join(appPath, "Contents", "Info.plist"),
            "CFBundleVersion"
          ),
          asarPath,
          asarBytes: archive.archiveBytes,
          asarHeaderBytes: archive.headerSize,
          asarEntryCount: archive.entries.length,
          selectedFiles: Object.fromEntries(
            Object.entries(roles).map(([role, value]) => [
              role,
              {
                path: value.entry.path,
                bytes: value.entry.size,
                candidateCount: value.scan.candidateCount,
                scannedBytes: value.scan.scannedBytes
              }
            ])
          )
        },
        staticEvidence,
        runtime: {
          bundledPlugin: {
            sourceRoot: sourcePluginRoot,
            sourceVersion: sourceManifest.version,
            sourceBundledContentVariant:
              sourceManifest.bundledContentVariant ?? null,
            cacheRoot: cachedPluginRoot,
            cachedVersion: cachedManifest.version,
            cachedBundledContentVariant:
              cachedManifest.bundledContentVariant ?? null,
            cachedNodeReplSkillExists: existsSync(
              path.join(
                cachedPluginRoot,
                "skills",
                "computer-use",
                "SKILL.md"
              )
            )
          },
          config: {
            path: configPath,
            nodeRepl: selectedSection(config, "mcp_servers.node_repl", [
              "command",
              "args",
              "startup_timeout_sec"
            ]),
            nodeReplEnv: selectedSection(
              config,
              "mcp_servers.node_repl.env",
              [
                "NODE_REPL_NODE_MODULE_DIRS",
                "NODE_REPL_NODE_PATH",
                "NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE",
                "SKY_CUA_SERVICE_PATH"
              ]
            ),
            legacyComputerUse: selectedSection(
              config,
              "mcp_servers.computer-use",
              ["command", "args", "cwd", "enabled"]
            ),
            plugin: selectedSection(
              config,
              'plugins."computer-use@openai-bundled"',
              ["enabled"]
            ),
            desktop: selectedSection(config, "desktop", [
              "computerUseAlwaysHidePictureInPicture"
            ])
          },
          service: {
            sourcePath: sourceServicePath,
            cachePath: cachedServicePath,
            canonicalPath: canonicalServicePath,
            sourceFingerprint,
            cacheFingerprint,
            canonicalFingerprint,
            sourceEqualsCache:
              sourceFingerprint?.sha256 === cacheFingerprint?.sha256,
            cacheEqualsCanonical:
              cacheFingerprint?.sha256 === canonicalFingerprint?.sha256,
            nativeVersion: plistValue(
              path.join(canonicalServicePath, "Contents", "Info.plist"),
              "CFBundleShortVersionString"
            ),
            processes: processState
          },
          approvals: {
            storePath: approvalStorePath,
            storeExists: approvalStoreExists,
            storeBytes: approvalStoreExists
              ? statSync(approvalStorePath).size
              : null,
            contentsCollected: false
          },
          lockedUse: {
            installerPath,
            installerExists: existsSync(installerPath),
            installerStatus: existsSync(installerPath)
              ? commandOutput(installerPath, ["status"], { timeout: 10000 })
              : null
          },
          settings: {
            soundDefaultsDomain: "com.openai.sky.CUAService",
            soundDefaultsKey: "computerUseSoundMode",
            soundMode,
            pipConfigKey:
              "desktop.computerUseAlwaysHidePictureInPicture"
          }
        }
      },
      normalizedPaths
    );
  } finally {
    closeSync(archive.fileDescriptor);
  }
}

async function main() {
  const appPath = argumentValue("--app") ?? "/Applications/ChatGPT.app";
  const asarPath =
    argumentValue("--asar") ??
    path.join(appPath, "Contents", "Resources", "app.asar");
  const outputPath =
    argumentValue("--out") ??
    path.join(root, "fixtures", "electron", "evidence.json");
  const evidence = await extractElectronComputerUseEvidence({
    appPath,
    asarPath
  });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  process.stdout.write(serialized);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}
