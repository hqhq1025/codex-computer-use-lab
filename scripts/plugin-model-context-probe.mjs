#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const APP_ROOT = "/Applications/ChatGPT.app";
const CODEX_SOURCE_ROOT =
  "/private/tmp/openai-codex-rust-v0.144.0-alpha.4/codex-rs";
const PLUGIN_ROOT = path.join(
  os.homedir(),
  ".codex",
  "plugins",
  "cache",
  "openai-bundled",
  "computer-use",
  "1.0.1000387"
);
const NODE_REPL_PATH = path.join(
  APP_ROOT,
  "Contents",
  "Resources",
  "cua_node",
  "bin",
  "node_repl"
);
const NODE_PATH = path.join(
  APP_ROOT,
  "Contents",
  "Resources",
  "cua_node",
  "bin",
  "node"
);
const COMPUTER_USE_SKILL_PATH = path.join(
  PLUGIN_ROOT,
  "skills",
  "computer-use",
  "SKILL.md"
);
const WRAPPER_PATH = path.join(
  PLUGIN_ROOT,
  "scripts",
  "computer-use-client.mjs"
);
const POLICY_PATH = path.join(
  APP_ROOT,
  "Contents",
  "Resources",
  "cua_node",
  "lib",
  "node_modules",
  "@oai",
  "sky",
  "dist",
  "project",
  "cua",
  "sky_js",
  "src",
  "targets",
  "mac",
  "computer-use-policy.js"
);
const USE_CASES = Object.freeze({
  browser:
    "Control the in-app browser in conjunction with the Browser Plugin.",
  chrome:
    "Control the Chrome browser in conjunction with the Chrome Plugin. Prefer this method of controlling Chrome over alternatives (such as Computer Use) unless the user explicitly mentions an alternative.",
  computerUse: "Control desktop apps on macOS through Computer Use."
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPath(value) {
  return value
    .replace(APP_ROOT, "$APP")
    .replace(os.homedir(), "$HOME")
    .replace(CODEX_SOURCE_ROOT, "$CODEX_SOURCE");
}

async function artifact(filePath) {
  const bytes = await readFile(filePath);
  return {
    path: normalizedPath(filePath),
    bytes: bytes.length,
    sha256: sha256(bytes)
  };
}

function frontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(markdown);
  if (!match) {
    throw new Error("Computer Use SKILL.md is missing frontmatter");
  }
  const values = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/u, "$1");
  }
  return values;
}

function sourceAnchor(source, marker, filePath) {
  const offset = source.indexOf(marker);
  if (offset < 0) {
    throw new Error(`Missing source anchor ${marker} in ${filePath}`);
  }
  return {
    marker,
    byteOffset: Buffer.byteLength(source.slice(0, offset), "utf8")
  };
}

async function sourceEvidence(filePath, markers) {
  const source = await readFile(filePath, "utf8");
  return {
    ...(await artifact(filePath)),
    anchors: markers.map((marker) => sourceAnchor(source, marker, filePath))
  };
}

async function readPlistKey(key) {
  const infoPlist = path.join(APP_ROOT, "Contents", "Info.plist");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "plutil",
      ["-extract", key, "raw", "-o", "-", infoPlist],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`plutil ${key} failed: ${stderr.trim()}`));
      }
    });
  });
}

async function captureNodeReplInitializeInstructions() {
  const temporaryHome = await mkdtemp(
    path.join(os.tmpdir(), "node-repl-context-probe-")
  );
  const child = spawn(NODE_REPL_PATH, [], {
    cwd: temporaryHome,
    env: {
      HOME: temporaryHome,
      PATH: "/usr/bin:/bin",
      TMPDIR: temporaryHome,
      NO_COLOR: "1",
      NODE_REPL_NODE_PATH: NODE_PATH,
      NODE_REPL_DISABLE_ANALYTICS: "1",
      NODE_REPL_UNTRUSTED_ENV_ALLOWLIST: "",
      NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER: USE_CASES.browser,
      NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: USE_CASES.chrome,
      NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE: USE_CASES.computerUse
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const result = await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("node_repl initialize timed out"));
      }, 10_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        const newline = stdout.indexOf("\n");
        if (newline < 0) {
          return;
        }
        clearTimeout(timer);
        const message = JSON.parse(stdout.slice(0, newline));
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.once("exit", (code) => {
        if (code !== 0 && stdout.length === 0) {
          clearTimeout(timer);
          reject(
            new Error(
              `node_repl exited during initialize (code=${code}): ${stderr}`
            )
          );
        }
      });
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: {
              name: "codex-cu-lab-model-context-probe",
              version: "0.1.0"
            }
          }
        })}\n`
      );
    });
    const instructions = result.instructions ?? "";
    return {
      bytes: Buffer.byteLength(instructions, "utf8"),
      sha256: sha256(instructions),
      protocolVersion: result.protocolVersion,
      serverInfo: result.serverInfo,
      containsUseCases: Object.fromEntries(
        Object.entries(USE_CASES).map(([name, value]) => [
          name,
          instructions.includes(value)
        ])
      ),
      bodyCollected: false
    };
  } finally {
    child.kill("SIGTERM");
    await rm(temporaryHome, { force: true, recursive: true });
  }
}

export async function runPluginModelContextProbe({
  outputPath
} = {}) {
  const [
    appVersion,
    appBuild,
    asar,
    codex,
    nodeRepl,
    skill,
    wrapper,
    policy,
    skillText,
    injectionSource,
    skillInstructionsSource,
    renderSource,
    sessionSource,
    rmcpSource,
    toolSearchSpecSource,
    mcpSearchSource,
    modelsSource,
    mcpToolCallSource,
    modelSurfaceText,
    nodeReplFixtureText,
    electronEvidenceText
  ] = await Promise.all([
    readPlistKey("CFBundleShortVersionString"),
    readPlistKey("CFBundleVersion"),
    artifact(path.join(APP_ROOT, "Contents", "Resources", "app.asar")),
    artifact(path.join(APP_ROOT, "Contents", "Resources", "codex")),
    artifact(NODE_REPL_PATH),
    artifact(COMPUTER_USE_SKILL_PATH),
    artifact(WRAPPER_PATH),
    artifact(POLICY_PATH),
    readFile(COMPUTER_USE_SKILL_PATH, "utf8"),
    sourceEvidence(
      path.join(CODEX_SOURCE_ROOT, "core-skills", "src", "injection.rs"),
      [
        "pub async fn build_skill_injections",
        "pub fn collect_explicit_skill_mentions"
      ]
    ),
    sourceEvidence(
      path.join(
        CODEX_SOURCE_ROOT,
        "core-skills",
        "src",
        "skill_instructions.rs"
      ),
      ['("<skill>", "</skill>")', "fn body(&self) -> String"]
    ),
    sourceEvidence(
      path.join(CODEX_SOURCE_ROOT, "core-skills", "src", "render.rs"),
      [
        "fn render_with_description(&self, description: &str)",
        'format!("- {}: {} (file: {})"'
      ]
    ),
    sourceEvidence(
      path.join(CODEX_SOURCE_ROOT, "core", "src", "session", "mod.rs"),
      [
        "let skills_instructions = AvailableSkillsInstructions::from_available_skills",
        "developer_sections.push(skills_instructions.render())"
      ]
    ),
    sourceEvidence(
      path.join(CODEX_SOURCE_ROOT, "codex-mcp", "src", "rmcp_client.rs"),
      [
        "namespace_description: server_instructions.map(str::to_string)",
        "server_instructions: initialize_result.instructions"
      ]
    ),
    sourceEvidence(
      path.join(
        CODEX_SOURCE_ROOT,
        "core",
        "src",
        "tools",
        "handlers",
        "tool_search_spec.rs"
      ),
      [
        "Searches over deferred tool metadata with BM25",
        "source.description.clone()"
      ]
    ),
    sourceEvidence(
      path.join(
        CODEX_SOURCE_ROOT,
        "core",
        "src",
        "tools",
        "handlers",
        "mcp.rs"
      ),
      ["fn build_mcp_search_text", "parts.extend(schema_properties)"]
    ),
    sourceEvidence(
      path.join(CODEX_SOURCE_ROOT, "protocol", "src", "models.rs"),
      [
        "pub fn as_function_call_output_payload",
        "structured_content",
        "convert_mcp_content_to_items"
      ]
    ),
    sourceEvidence(
      path.join(CODEX_SOURCE_ROOT, "core", "src", "mcp_tool_call.rs"),
      [
        "MCP_TOOL_CALL_EVENT_RESULT_MAX_BYTES",
        "meta: None"
      ]
    ),
    readFile(
      path.resolve("fixtures/model-tool-surface/latest.json"),
      "utf8"
    ),
    readFile(path.resolve("fixtures/node-repl/probe.json"), "utf8"),
    readFile(path.resolve("fixtures/electron/evidence.json"), "utf8")
  ]);

  const skillMetadata = frontmatter(skillText);
  const modelSurface = JSON.parse(modelSurfaceText);
  const nodeReplFixture = JSON.parse(nodeReplFixtureText);
  const electronEvidence = JSON.parse(electronEvidenceText);
  const initializeInstructions =
    await captureNodeReplInitializeInstructions();
  const topLevelTools = modelSurface.requestSurface.tools;

  const result = {
    schemaVersion: 2,
    artifacts: {
      desktop: {
        version: appVersion,
        build: appBuild,
        asar
      },
      codex: {
        ...codex,
        version: "0.144.0-alpha.4",
        sourceCommit: "049586f41571e74b44c841868bca3a2233214a71"
      },
      nodeRepl: {
        ...nodeRepl,
        archive: nodeReplFixture.metadata.nodeReplArchive,
        runtimeArchiveVersion:
          nodeReplFixture.metadata.runtimeArchiveVersion
      },
      plugin: {
        id: "computer-use@openai-bundled",
        version: "1.0.1000387",
        cacheRoot: "$HOME/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387",
        bundledContentVariant:
          electronEvidence.runtime.bundledPlugin.cachedBundledContentVariant,
        skill,
        wrapper
      },
      policy
    },
    promptSurfaces: {
      initialSkillsCatalog: {
        role: "developer",
        fields: ["name", "description", "path"],
        fullSkillBodyIncluded: false,
        computerUseEntry: {
          name: "computer-use:computer-use",
          description: skillMetadata.description,
          path: normalizedPath(COMPUTER_USE_SKILL_PATH)
        },
        source: {
          session: sessionSource,
          render: renderSource
        }
      },
      explicitSkillMention: {
        role: "user",
        structuredInputResolvedByPathFirst: true,
        textMentionSyntaxSupported: true,
        fullSkillBodyIncluded: true,
        wrapper: {
          opening: "<skill>",
          fields: ["name", "path", "contents"],
          closing: "</skill>"
        },
        bodyBytes: skill.bytes,
        bodySha256: skill.sha256,
        productionRequestBodyCaptured: false,
        source: {
          injection: injectionSource,
          fragment: skillInstructionsSource
        }
      },
      nodeReplInitialize: initializeInstructions,
      toolSearchNamespace: {
        namespace: "mcp__node_repl",
        descriptionComesFromMcpInitializeInstructions: true,
        searchIndexFields: [
          "canonical tool name",
          "callable name",
          "raw MCP tool name",
          "server name",
          "title",
          "description",
          "namespace description",
          "schema property names"
        ],
        source: {
          rmcp: rmcpSource,
          toolSearchSpec: toolSearchSpecSource,
          searchText: mcpSearchSource
        }
      }
    },
    responses: {
      observedAt: modelSurface.observedAt,
      toolCount: modelSurface.requestSurface.toolCount,
      topLevelTools,
      hasToolSearch: topLevelTools.some(
        (tool) => tool.type === "tool_search"
      ),
      hasNativeComputerTool:
        modelSurface.requestSurface.hasResponsesComputerTool,
      hasTopLevelNodeRepl:
        modelSurface.requestSurface.nodeReplTools.length > 0,
      deferredSequence: modelSurface.rolloutDeferredSequence,
      deferredCallShape: {
        namespace: "mcp__node_repl",
        name: "js"
      }
    },
    execution: {
      wrapperImport: {
        usesPluginOwnedWrapper: true,
        importsPackagedCreateClientFromNodeModuleDirs: true,
        createClientArguments: {
          target: "mac"
        },
        wrapper
      },
      computerUseFacadeIsMcpToolSet: false,
      computerUseFacadeMethodCount: 10
    },
    resultFlows: {
      model: {
        usesStructuredContentFirst: true,
        fallsBackToContent: true,
        includesMeta: false,
        source: modelsSource
      },
      desktop: {
        includesMetaBelowSerializedBytes: 1_048_576,
        metaClearedAboveSerializedBytes: 1_048_576,
        lateBindingKey: "codex/toolSurface",
        lateBindingValueKind: "computerUse",
        source: {
          eventTruncation: mcpToolCallSource,
          renderer:
            electronEvidence.staticEvidence.find(
              (entry) => entry.id === "node-repl-computer-use-env"
            ) ?? null,
          policy
        }
      }
    },
    schemaDrift: {
      rawMcpJs: {
        timeoutMinimum: 1,
        titleMinimumLength: 1,
        titleMaximumLength: 80
      },
      toolSearchOutput: {
        numericAndStringBoundsPreserved: false,
        typeRequiredAndAdditionalPropertiesPreserved: true
      }
    },
    unknowns: [
      "A current production Responses request containing the explicit Computer Use SKILL.md body was not captured.",
      "The server-side mechanism that authorizes a function exposed only through tool_search_output remains private.",
      "The current app launch was not traced to distinguish a fresh plugin-cache copy from cache reuse."
    ],
    safety: {
      promptBodiesCollected: false,
      toolArgumentsCollected: false,
      screenshotsCollected: false,
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
    path.resolve("fixtures/model-tool-surface/plugin-model-context.json");
  const result = await runPluginModelContextProbe({ outputPath });
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      desktop: result.artifacts.desktop,
      nodeReplInstructions: result.promptSurfaces.nodeReplInitialize,
      responses: {
        toolCount: result.responses.toolCount,
        hasToolSearch: result.responses.hasToolSearch,
        hasNativeComputerTool: result.responses.hasNativeComputerTool,
        hasTopLevelNodeRepl: result.responses.hasTopLevelNodeRepl
      },
      safety: result.safety
    }, null, 2)}\n`
  );
}
