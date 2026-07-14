#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  parsePostedResponsesRequest,
  summarizeResponsesRequest
} from "../lib/model-tool-surface.mjs";
import { redactSecrets } from "../lib/redaction.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const databasePath = argumentValue("--database") ?? path.join(
  process.env.HOME,
  ".codex",
  "logs_2.sqlite"
);
const outputPath = argumentValue("--out");
const threadId = argumentValue("--thread-id");
const threadFilter = threadId
  ? `AND thread_id = '${threadId.replaceAll("'", "''")}'`
  : "";

const sql = `
SELECT
  rowid,
  datetime(ts, 'unixepoch', 'localtime') AS observed_at
FROM logs
WHERE target = 'codex_http_client::transport'
  AND feedback_log_body LIKE '%POST to %/v1/responses:%'
  ${threadFilter}
ORDER BY ts DESC, ts_nanos DESC
LIMIT ${threadId ? 16 : 32}
`;

const rawCandidates = execFileSync(
  "sqlite3",
  ["-readonly", "-separator", "\t", databasePath, sql],
  { encoding: "utf8", maxBuffer: 1024 * 1024 }
);
const rows = rawCandidates
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const separator = line.indexOf("\t");
    return {
      rowid: line.slice(0, separator),
      observed_at: line.slice(separator + 1)
    };
  });
let selected = null;
for (const row of rows) {
  try {
    const feedbackLogBody = execFileSync(
      "sqlite3",
      [
        "-readonly",
        databasePath,
        `SELECT feedback_log_body FROM logs WHERE rowid = ${row.rowid}`
      ],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
    );
    selected = {
      observedAt: row.observed_at,
      request: parsePostedResponsesRequest(feedbackLogBody)
    };
    break;
  } catch {
    continue;
  }
}
if (selected == null) {
  throw new Error(
    "No recent structurally valid Responses request was found"
  );
}

const summary = summarizeResponsesRequest(selected.request);

const result = {
  observedAt: selected.observedAt,
  source: "sanitized-summary-of-local-codex-log",
  requestSurface: summary,
  rolloutDeferredSequence: null
};

if (threadId) {
  const findOutput = execFileSync(
    "find",
    [
      path.join(process.env.HOME, ".codex", "sessions"),
      "-type",
      "f",
      "-name",
      `*${threadId}.jsonl`
    ],
    { encoding: "utf8" }
  ).trim();
  const rolloutPath = findOutput.split("\n").find(Boolean);
  if (rolloutPath) {
    const rollout = await readFile(rolloutPath, "utf8");
    const events = [];
    for (const line of rollout.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const record = JSON.parse(line);
      if (record.type !== "response_item") {
        continue;
      }
      const payload = record.payload ?? {};
      const isToolSearch = payload.type === "tool_search_call";
      const isNodeRepl =
        payload.type === "function_call" &&
        payload.namespace === "mcp__node_repl" &&
        payload.name === "js";
      if (isToolSearch || isNodeRepl) {
        events.push({
          timestamp: record.timestamp,
          type: payload.type,
          namespace: payload.namespace ?? null,
          name: payload.name ?? null
        });
      }
    }

    const firstToolSearch = events.findIndex((event) => event.type === "tool_search_call");
    const firstNodeRepl = events.findIndex((event) => event.namespace === "mcp__node_repl");
    result.rolloutDeferredSequence = {
      source: "sanitized-event-types-from-local-rollout",
      eventCount: events.length,
      events,
      toolSearchPrecedesNodeRepl:
        firstToolSearch >= 0 &&
        firstNodeRepl >= 0 &&
        firstToolSearch < firstNodeRepl
    };
  }
}
const serialized = `${JSON.stringify(result, null, 2)}\n`;

if (outputPath) {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, redactSecrets(serialized), "utf8");
}

process.stdout.write(redactSecrets(serialized));
