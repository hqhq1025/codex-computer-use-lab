#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const steps = [
  ["node", [
    "scripts/extract-model-tool-surface.mjs",
    "--thread-id",
    "019f55b2-9ab9-7253-a9e4-c7005a14e87b",
    "--out",
    "fixtures/model-tool-surface/latest.json"
  ]],
  ["node", ["scripts/app-server-probe.mjs", "--out", "fixtures/app-server/probe.json"]],
  ["node", ["scripts/node-repl-mcp-probe.mjs", "--out", "fixtures/node-repl/probe.json"]],
  ["node", ["scripts/sky-client-wire-probe.mjs", "--out", "fixtures/sky-wire/captured.json"]],
  ["node", ["scripts/wrapper-policy-probe.mjs", "--out", "fixtures/wrapper-policy/captured.json"]],
  ["bash", ["test-app/build.sh"]],
  ["bash", ["scripts/display-geometry-probe.sh", "--out", "fixtures/display/current.json"]],
  ["bash", ["scripts/native-symbol-map.sh"]],
  ["bash", ["scripts/native-callgraph.sh"]],
  ["node", ["scripts/extract-electron-cu-evidence.mjs"]],
  [
    "node",
    [
      "scripts/plugin-model-context-probe.mjs",
      "--out",
      "fixtures/model-tool-surface/plugin-model-context.json"
    ]
  ],
  [
    "node",
    [
      "scripts/mcp-event-truncation-probe.mjs",
      "--out",
      "fixtures/electron/mcp-event-truncation.json"
    ]
  ],
  [
    "node",
    [
      "scripts/electron-presentation-contract-probe.mjs",
      "--out",
      "fixtures/electron/presentation-contract.json"
    ]
  ],
  [
    "node",
    [
      "scripts/native-last-window-probe.mjs",
      "--out",
      "fixtures/native/last-window.json"
    ]
  ],
  [
    "node",
    [
      "scripts/native-ax-contract-probe.mjs",
      "--out",
      "fixtures/native/ax-diff-refetch.json"
    ]
  ],
  [
    "node",
    [
      "scripts/native-app-instance-contract-probe.mjs",
      "--out",
      "fixtures/native/app-instance-isolation.json"
    ]
  ],
  [
    "node",
    [
      "scripts/application-target-identifier-static-probe.mjs",
      "--out",
      "fixtures/native/application-target-identifier-static.json"
    ]
  ],
  [
    "swift",
    [
      "scripts/application-target-identifier-probe.swift",
      "--out",
      "fixtures/native/application-target-identifier-behavior.json"
    ]
  ],
  [
    "node",
    [
      "scripts/native-oop-targeting-probe.mjs",
      "--out",
      "fixtures/native/oop-targeting.json"
    ]
  ],
  [
    "node",
    [
      "scripts/native-url-policy-probe.mjs",
      "--out",
      "fixtures/native/url-policy.json"
    ]
  ],
  ["bash", [
    "scripts/extract-policy-evidence.sh",
    "--codex-source",
    "/private/tmp/openai-codex-rust-v0.144.0-alpha.4"
  ]],
  ["bash", ["scripts/collect-observability-evidence.sh"]],
  ["bash", ["scripts/collect-readonly-security-evidence.sh"]],
  ["node", [
    "scripts/real-cua-lab-runner.mjs",
    "--out",
    "fixtures/real-cua/dry-run-plan.json"
  ]],
  ["node", ["scripts/check-no-secrets.mjs"]],
  ["node", ["--test", "tests/*.test.mjs"]]
];

for (const [command, args] of steps) {
  const scriptArgument = args.find((argument) =>
    argument.startsWith("scripts/") && !argument.includes("*")
  );
  if (scriptArgument && !existsSync(path.join(root, scriptArgument))) {
    process.stdout.write(`SKIP ${scriptArgument}: not present yet\n`);
    continue;
  }

  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, CODEX_CU_LAB: "1" },
    encoding: "utf8",
    shell: args.some((argument) => argument.includes("*"))
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\nAll available reproduction steps completed.\n");
