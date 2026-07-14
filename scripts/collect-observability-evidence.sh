#!/usr/bin/env bash

set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/fixtures/observability/latest.json"
CHATGPT_APP="${CHATGPT_APP:-/Applications/ChatGPT.app}"
CU_APP="${CODEX_CU_APP_BUNDLE:-$HOME/.codex/computer-use/Codex Computer Use.app}"
CU_BINARY="$CU_APP/Contents/MacOS/SkyComputerUseService"
ASAR="$CHATGPT_APP/Contents/Resources/app.asar"
SKY_NODE="$CHATGPT_APP/Contents/Resources/native/sky.node"
CUA_GROUP="$HOME/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService"
CUA_CACHE="$HOME/Library/Caches/com.openai.sky.CUAService"
CUA_HTTP_STORAGE="$HOME/Library/HTTPStorages/com.openai.sky.CUAService"
ANALYTICS_DB="$CUA_GROUP/Library/Application Support/Software/Analytics.db"
SKYSIGHT_ROOT="${TMPDIR:-/tmp}/skysight/segments"
SKYSIGHT_MEMORY_PROMPT="$CU_APP/Contents/Resources/Package_ComputerUse.bundle/Contents/Resources/SkysightMemoryInstructions.md"
SKYSIGHT_SUMMARIZER_PROMPT="$CU_APP/Contents/Resources/Package_ComputerUse.bundle/Contents/Resources/SkysightSummarizer.md"

while (($# > 0)); do
  case "$1" in
    --out)
      OUT="${2:?--out requires a path}"
      shift 2
      ;;
    --help)
      printf '%s\n' "Usage: $0 [--out PATH]"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

for tool in awk find lsof nm plutil stat strings swift; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'missing required tool: %s\n' "$tool" >&2
    exit 1
  }
done

[[ -f "$CU_BINARY" ]] || {
  printf 'SkyComputerUseService not found: %s\n' "$CU_BINARY" >&2
  exit 1
}
[[ -f "$ASAR" ]] || {
  printf 'ChatGPT ASAR not found: %s\n' "$ASAR" >&2
  exit 1
}
[[ -f "$SKY_NODE" ]] || {
  printf 'sky.node not found: %s\n' "$SKY_NODE" >&2
  exit 1
}
[[ -f "$SKYSIGHT_MEMORY_PROMPT" && -f "$SKYSIGHT_SUMMARIZER_PROMPT" ]] || {
  printf 'Skysight prompt resources not found under %s\n' "$CU_APP" >&2
  exit 1
}

NODE_BIN="${NODE_BIN:-$CHATGPT_APP/Contents/Resources/cua_node/bin/node}"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-cu-observability.XXXXXX")"
TEMP_OUT=""
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "$TEMP_OUT" ]]; then
    rm -f "$TEMP_OUT"
  fi
}
trap cleanup EXIT
SYMBOLS="$TMP_DIR/symbols.txt"
STAT_ROWS="$TMP_DIR/stat-rows.tsv"
FD_ROWS="$TMP_DIR/fd-rows.tsv"

nm -arch arm64 -n "$CU_BINARY" 2>/dev/null |
  awk 'NF >= 3 { $1=$2=""; sub(/^ +/, ""); sub(/^_/, ""); print }' |
  swift demangle --compact >"$SYMBOLS"

has_symbol() {
  grep -Fq "$1" "$SYMBOLS"
}

has_binary_string() {
  strings -a -n 8 "$1" | grep -F "$2" >/dev/null
}

has_asar_anchor() {
  grep -aFq "$1" "$ASAR"
}

require_symbol() {
  local symbol="$1"
  if ! has_symbol "$symbol"; then
    printf 'missing required symbol: %s\n' "$symbol" >&2
    exit 1
  fi
}

require_binary_string() {
  local file="$1"
  local value="$2"
  if ! has_binary_string "$file" "$value"; then
    printf 'missing required string in %s: %s\n' "$file" "$value" >&2
    exit 1
  fi
}

require_asar_anchor() {
  local value="$1"
  if ! has_asar_anchor "$value"; then
    printf 'missing required ASAR anchor: %s\n' "$value" >&2
    exit 1
  fi
}

REQUEST_TYPES=(
  "ComputerUseClient.ComputerUseIPCEventStreamStartRequest"
  "ComputerUseClient.ComputerUseIPCEventStreamStatusRequest"
  "ComputerUseClient.ComputerUseIPCEventStreamStopRequest"
  "ComputerUseClient.ComputerUseIPCSkysightStartRequest"
  "ComputerUseClient.ComputerUseIPCSkysightStatusRequest"
  "ComputerUseClient.ComputerUseIPCSkysightStopRequest"
  "ComputerUseClient.ComputerUseIPCSkysightUpdateExclusionRequest"
  "ComputerUseClient.ComputerUseIPCSkysightListExclusionsRequest"
)

SYMBOL_ANCHORS=(
  "ComputerUse.SkyshotOperation.captureScreenshot"
  "ComputerUse.SystemSelection.writeScreenshotToFile"
  "SlimCore.ScreenshotImplementation.writeScreenshotToFile"
  "SlimCore.TemporaryFile.temporaryDirectory"
  "ComputerUse.AppshotCaptureStore"
  "Appshot.AppshotCaptureTransition.finalFrameSnapshotFile"
  "ComputerUse.EventStreamJSONLWriter"
  "ComputerUse.EventStreamService.start"
  "ComputerUse.EventStreamService.status"
  "ComputerUse.EventStreamService.stop"
  "ComputerUse.SkysightService.start"
  "ComputerUse.SkysightService.status"
  "ComputerUse.SkysightService.stop"
  "ComputerUse.SkysightSegmentWriter"
  "ComputerUse.SkysightMemoryPipeline"
  "ComputerUse.RemoteHostedPIPContentPublisher.publishWindowStream"
  "Logging.EventLogger.configure(databaseURL"
  "Logging.CodexDatadogTelemetryTransport.send"
  "Statsig.StatsigOptions.eventLoggingEnabled"
  "Statsig.StatsigUser.optOutNonSdkMetadata"
  "Statsig.Statsig.getFeatureGateWithExposureLoggingDisabled"
)

for symbol in "${REQUEST_TYPES[@]}" "${SYMBOL_ANCHORS[@]}"; do
  require_symbol "$symbol"
done

require_binary_string "$CU_BINARY" '$TMPDIR/skysight/segments/'
require_binary_string "$CU_BINARY" "events.jsonl"
require_binary_string "$CU_BINARY" "metadata.json"
require_binary_string "$CU_BINARY" "Skysight is not enabled for this user."
require_binary_string "$CU_BINARY" "will be excluded from the recording."
require_binary_string "$SKY_NODE" "RemoteHostedPIPContentService"
require_binary_string "$SKY_NODE" "publishPresentationWithID:threadID:turnID:contextID:width:height:withReply:"
require_asar_anchor "appshotsEnabled"
require_asar_anchor "cuaPIP"
require_asar_anchor "alwaysHidePictureInPicture"
require_asar_anchor "recordAndReplay"
grep -Fq "chronological 10-minute and 6-hour summaries" "$SKYSIGHT_MEMORY_PROMPT" || {
  printf 'Skysight memory prompt drifted\n' >&2
  exit 1
}
grep -Fq "highly untrusted observed content" "$SKYSIGHT_SUMMARIZER_PROMPT" || {
  printf 'Skysight summarizer trust boundary drifted\n' >&2
  exit 1
}
grep -Fq "Untrusted taint is sticky" "$SKYSIGHT_SUMMARIZER_PROMPT" || {
  printf 'Skysight summarizer taint rule drifted\n' >&2
  exit 1
}
grep -Fq "Do not include URLs" "$SKYSIGHT_SUMMARIZER_PROMPT" || {
  printf 'Skysight summarizer URL boundary drifted\n' >&2
  exit 1
}

: >"$STAT_ROWS"

append_stat() {
  local category="$1"
  local path="$2"
  local type mode uid mtime size owner

  [[ -e "$path" || -S "$path" ]] || return 0
  if [[ -S "$path" ]]; then
    type="socket"
  elif [[ -d "$path" ]]; then
    type="directory"
  elif [[ -f "$path" ]]; then
    type="file"
  elif [[ -L "$path" ]]; then
    type="symlink"
  else
    type="other"
  fi
  mode="$(stat -f '%Lp' "$path" 2>/dev/null || printf 'unknown')"
  uid="$(stat -f '%u' "$path" 2>/dev/null || printf 'unknown')"
  mtime="$(stat -f '%m' "$path" 2>/dev/null || printf '0')"
  size="$(stat -f '%z' "$path" 2>/dev/null || printf '0')"
  if [[ "$uid" == "$(id -u)" ]]; then
    owner="current_user"
  elif [[ "$uid" == "0" ]]; then
    owner="root"
  else
    owner="other"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$category" "$type" "$owner" "$mode" "$mtime" "$size" >>"$STAT_ROWS"
}

append_stat "analytics-db" "$ANALYTICS_DB"
append_stat "cua-ipc" "$CUA_GROUP/IPC/computeruse.sock"
append_stat "cua-ipc" "$CUA_GROUP/IPC/computeruse.sock.lock"

if [[ -d "$CUA_CACHE" ]]; then
  while IFS= read -r -d '' path; do
    append_stat "cua-cache" "$path"
  done < <(find "$CUA_CACHE" -maxdepth 1 -type f -print0 2>/dev/null)
fi

if [[ -d "$CUA_HTTP_STORAGE" ]]; then
  while IFS= read -r -d '' path; do
    append_stat "cua-http-storage" "$path"
  done < <(find "$CUA_HTTP_STORAGE" -maxdepth 1 -type f -print0 2>/dev/null)
fi

if [[ -d "$SKYSIGHT_ROOT" ]]; then
  while IFS= read -r -d '' path; do
    append_stat "skysight-segment" "$path"
  done < <(
    find "$SKYSIGHT_ROOT" -maxdepth 4 -type f \
      \( -name "events.jsonl" -o -name "metadata.json" -o -name "suppressed*.jsonl" \) \
      -print0 2>/dev/null
  )
fi

for temp_root in "${TMPDIR:-/tmp}" /tmp; do
  [[ -d "$temp_root" ]] || continue
  while IFS= read -r -d '' path; do
    append_stat "screenshot-temporary-file" "$path"
  done < <(
    find "$temp_root" -maxdepth 4 -type f -name "screenshot_*" -print0 2>/dev/null
  )
done

: >"$FD_ROWS"

append_process_fds() {
  local role="$1"
  local pid="$2"
  local name category

  while IFS= read -r line; do
    [[ "$line" == n* ]] || continue
    name="${line#n}"
    category="other"
    case "$name" in
      "$ANALYTICS_DB") category="analytics-db" ;;
      "$CUA_GROUP/IPC/"*) category="cua-ipc" ;;
      "$SKYSIGHT_ROOT"/*) category="skysight-segment" ;;
      */screenshot_*) category="screenshot-temporary-file" ;;
      "$CUA_GROUP"/*) category="cua-group" ;;
      "$CUA_CACHE"/*) category="cua-cache" ;;
      "$CUA_HTTP_STORAGE"/*) category="cua-http-storage" ;;
      "$HOME/.codex/computer-use/"*) category="canonical-cu-app" ;;
      "$CHATGPT_APP"/*) category="chatgpt-app" ;;
      /tmp/com.openai.sky.CUAService/*) category="cua-tmp-socket" ;;
      /private/var/db/analyticsd/*) category="system-analytics-policy" ;;
      /dev/*) category="device" ;;
      /System/*|/usr/lib/*) category="system" ;;
    esac
    printf '%s\t%s\n' "$role" "$category" >>"$FD_ROWS"
  done < <(lsof -n -P -Fn -p "$pid" 2>/dev/null || true)
}

ELECTRON_MAIN_PID="$(
  ps -axo pid=,comm= |
    awk -v executable="$CHATGPT_APP/Contents/MacOS/ChatGPT" \
      '{
        pid = $1
        $1 = ""
        sub(/^[[:space:]]+/, "", $0)
        if ($0 == executable && !found) {
          print pid
          found = 1
        }
      }'
)"
if [[ -n "$ELECTRON_MAIN_PID" ]]; then
  append_process_fds "electron-main" "$ELECTRON_MAIN_PID"
fi

SKY_SERVICE_COUNT=0
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  SKY_SERVICE_COUNT=$((SKY_SERVICE_COUNT + 1))
  append_process_fds "sky-service" "$pid"
done < <(
  ps -axo pid=,comm= |
    awk -v executable="$CU_BINARY" '
      {
        pid = $1
        $1 = ""
        sub(/^[[:space:]]+/, "", $0)
        if ($0 == executable) print pid
      }
    '
)

OUT_DIR="$(dirname "$OUT")"
mkdir -p "$OUT_DIR"
TEMP_OUT="$(mktemp "$OUT_DIR/.observability.XXXXXX")"

"$NODE_BIN" - \
  "$STAT_ROWS" \
  "$FD_ROWS" \
  "$CHATGPT_APP/Contents/Info.plist" \
  "$CU_APP/Contents/Info.plist" \
  "$ELECTRON_MAIN_PID" \
  "$SKY_SERVICE_COUNT" \
  "${REQUEST_TYPES[*]}" \
  "$SKYSIGHT_MEMORY_PROMPT" \
  "$SKYSIGHT_SUMMARIZER_PROMPT" <<'NODE' >"$TEMP_OUT"
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const [
  statRowsPath,
  fdRowsPath,
  chatgptInfoPath,
  cuInfoPath,
  electronMainPid,
  skyServiceCount,
  requestTypeString,
  skysightMemoryPromptPath,
  skysightSummarizerPromptPath
] = process.argv.slice(2);

function readTsv(filePath, columns) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

function plistValue(filePath, key) {
  try {
    return execFileSync(
      "/usr/bin/plutil",
      ["-extract", key, "raw", "-o", "-", filePath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return "unknown";
  }
}

function aggregateMetadata(rows) {
  const categories = [
    "analytics-db",
    "cua-cache",
    "cua-http-storage",
    "cua-ipc",
    "screenshot-temporary-file",
    "skysight-segment"
  ];
  return Object.fromEntries(categories.map((category) => {
    const selected = rows.filter((row) => row.category === category);
    const mtimes = selected.map((row) => Number(row.mtime)).filter(Number.isFinite);
    const sizes = selected.map((row) => Number(row.size)).filter(Number.isFinite);
    return [category, {
      count: selected.length,
      types: [...new Set(selected.map((row) => row.type))].sort(),
      owners: [...new Set(selected.map((row) => row.owner))].sort(),
      modes: [...new Set(selected.map((row) => row.mode))].sort(),
      mtimeUnixSeconds: selected.length === 0 ? null : {
        minimum: Math.min(...mtimes),
        maximum: Math.max(...mtimes)
      },
      sizeBytes: selected.length === 0 ? {
        total: 0,
        minimum: null,
        maximum: null
      } : {
        total: sizes.reduce((sum, value) => sum + value, 0),
        minimum: Math.min(...sizes),
        maximum: Math.max(...sizes)
      }
    }];
  }));
}

function aggregateFds(rows) {
  const result = {};
  for (const row of rows) {
    result[row.role] ??= {};
    result[row.role][row.category] = (result[row.role][row.category] ?? 0) + 1;
  }
  return result;
}

const statRows = readTsv(
  statRowsPath,
  ["category", "type", "owner", "mode", "mtime", "size"]
);
const fdRows = readTsv(fdRowsPath, ["role", "category"]);
const skysightMemoryPrompt = fs.readFileSync(skysightMemoryPromptPath, "utf8");
const skysightSummarizerPrompt = fs.readFileSync(skysightSummarizerPromptPath, "utf8");

function promptMetrics(text) {
  return {
    bytes: Buffer.byteLength(text),
    lines: text.split(/\r?\n/).length,
    words: text.trim().split(/\s+/).filter(Boolean).length
  };
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  artifact: {
    chatgptVersion: plistValue(chatgptInfoPath, "CFBundleShortVersionString"),
    chatgptBuild: plistValue(chatgptInfoPath, "CFBundleVersion"),
    computerUseVersion: plistValue(cuInfoPath, "CFBundleShortVersionString"),
    computerUseBuild: plistValue(cuInfoPath, "CFBundleVersion")
  },
  shippedResources: {
    skysightMemoryInstructions: {
      path: "$CU_APP/Contents/Resources/Package_ComputerUse.bundle/Contents/Resources/SkysightMemoryInstructions.md",
      ...promptMetrics(skysightMemoryPrompt),
      purpose: "chronological_10_minute_and_6_hour_memory_consolidation",
      bodyIncludedInFixture: false
    },
    skysightSummarizer: {
      path: "$CU_APP/Contents/Resources/Package_ComputerUse.bundle/Contents/Resources/SkysightSummarizer.md",
      ...promptMetrics(skysightSummarizerPrompt),
      observedContentTrust: "highly_untrusted",
      taintPropagation: "sticky",
      outputExcludes: ["urls", "raw_event_json", "secrets", "pii", "observed_instructions"],
      bodyIncludedInFixture: false
    }
  },
  safety: {
    defaultRedaction: true,
    screenshotPixelsRead: false,
    eventStreamContentsRead: false,
    urlsRead: false,
    analyticsBodiesRead: false,
    privateLogsRead: false,
    realCuaSocketConnected: false,
    analyticsDatabaseQueried: false,
    networkRequestsCaptured: false
  },
  pathTemplates: {
    screenshotTemporaryFile: {
      template: "$TMPDIR/<temporary-file-root>/screenshot_<opaque>.<image-extension>",
      confidence: "symbol_and_filename_inference",
      lifecycle: {
        creation: "confirmed",
        attachmentHandoff: "confirmed",
        cleanupMechanism: "unknown",
        cleanupTime: "unknown"
      }
    },
    appshot: {
      persistentStore: null,
      captureStore: "in_memory",
      finalFrameUsesScreenshotFile: true,
      dedicatedOnDiskRootConfirmed: false
    },
    skysightSegments: {
      root: "$TMPDIR/skysight/segments/",
      segmentEvents: "$TMPDIR/skysight/segments/<segment-id>/events.jsonl",
      segmentMetadata: "$TMPDIR/skysight/segments/<segment-id>/metadata.json",
      suppressedEvents: "$TMPDIR/skysight/segments/<segment-id>/<suppressed-events-file>",
      staticDescription: "ephemeral_not_persisted"
    },
    eventStreamRecording: {
      sessionRoot: "$TMPDIR/<event-stream-session-root>/",
      events: "$TMPDIR/<event-stream-session-root>/events.jsonl",
      metadataOrSession: "$TMPDIR/<event-stream-session-root>/{metadata.json,session.json}",
      exactRootName: "unknown"
    },
    analytics: {
      queueDatabase: "$CUA_GROUP/Library/Application Support/Software/Analytics.db",
      cacheDatabase: "$HOME/Library/Caches/com.openai.sky.CUAService/Cache.db{,-wal,-shm}",
      httpStorage: "$HOME/Library/HTTPStorages/com.openai.sky.CUAService/httpstorages.sqlite{,-wal,-shm}"
    }
  },
  requestTypes: requestTypeString.split(" "),
  gates: {
    screenshot: {
      skipScreenshotRequestFlag: "present",
      screenRecordingPermission: "required",
      currentCaptureActive: "unknown"
    },
    appshot: {
      featureGate: "appshotsEnabled",
      managedServiceEnableCondition: "appshotsEnabled || nodeReplEnabled",
      currentEnabled: "unknown"
    },
    pip: {
      featureGate: "cuaPIP",
      userOptOut: "alwaysHidePictureInPicture == true",
      effectiveCondition: "cuaPIP && alwaysHidePictureInPicture != true",
      currentEnabled: "unknown"
    },
    skysight: {
      featureEligibility: "ComputerUseIPCRequestRequiringSkysightFeature",
      explicitStartStop: true,
      approvalElicitation: true,
      exclusions: ["application", "url_domain", "private_browsing"],
      currentEnabled: "unknown",
      currentRecording: "unknown"
    },
    eventStream: {
      featureGate: "recordAndReplay",
      explicitStartStatusStop: true,
      userStopOrCancel: true,
      urlPolicyFilter: true,
      currentEnabled: "unknown",
      currentRecording: "unknown"
    },
    analytics: {
      statsigEventLoggingOption: "eventLoggingEnabled",
      statsigMetadataOptOut: "optOutNonSdkMetadata",
      exposureLoggingDisabledApis: true,
      productWideAnalyticsOptOut: "not_confirmed_in_selected_static_surfaces",
      currentStatsigInitialized: "unknown",
      currentNetworkSending: "unknown"
    }
  },
  staticBoundaries: {
    screenshotFileIsNotAppshotStore: true,
    appshotIsCaptureUxWithInMemoryStore: true,
    skysightSubscribesToEventStreamCapture: true,
    eventStreamHasIndependentStartStatusStopRequests: true,
    pipUsesIndependentXpcPresentationChannel: true,
    analyticsUsesLocalQueueAndTransportTypes: true,
    compiledCodeDoesNotProveCurrentEnablement: true
  },
  runtime: {
    processes: {
      electronMainObserved: electronMainPid.length > 0,
      skyServiceCount: Number(skyServiceCount),
      identification: "exact_ps_comm_executable_path"
    },
    fileDescriptorCountsByRoleAndCategory: aggregateFds(fdRows),
    metadataAggregates: aggregateMetadata(statRows),
    analyticsDatabaseOpenByObservedSkyService:
      fdRows.some((row) => row.role === "sky-service" && row.category === "analytics-db"),
    activePipPresentation: "unknown",
    activeSkysightRecording: "unknown",
    activeEventStreamRecording: "unknown",
    activeScreenshotTemporaryFiles:
      statRows.filter((row) => row.category === "screenshot-temporary-file").length
  }
};

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
NODE

chmod 600 "$TEMP_OUT"
mv -f "$TEMP_OUT" "$OUT"
TEMP_OUT=""
printf 'wrote redacted observability evidence to %s\n' "$OUT"
