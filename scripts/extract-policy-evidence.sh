#!/usr/bin/env bash

set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/fixtures/policy/evidence.json"
SKY_ROOT="${SKY_ROOT:-/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky}"
APP="${CODEX_CU_APP_BUNDLE:-$HOME/.codex/computer-use/Codex Computer Use.app}"
APP_ASAR="${CODEX_APP_ASAR:-/Applications/ChatGPT.app/Contents/Resources/app.asar}"
CODEX_SOURCE_DIR="${CODEX_SOURCE_DIR:-}"

while (($# > 0)); do
  case "$1" in
    --out)
      OUT="${2:?--out requires a path}"
      shift 2
      ;;
    --sky-root)
      SKY_ROOT="${2:?--sky-root requires a path}"
      shift 2
      ;;
    --app)
      APP="${2:?--app requires a path}"
      shift 2
      ;;
    --asar)
      APP_ASAR="${2:?--asar requires a path}"
      shift 2
      ;;
    --codex-source)
      CODEX_SOURCE_DIR="${2:?--codex-source requires a path}"
      shift 2
      ;;
    --help)
      printf '%s\n' \
        "Usage: $0 [--out PATH] [--sky-root PATH] [--app PATH] [--asar PATH] [--codex-source PATH]"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

for tool in node strings plutil rg git; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'Missing required tool: %s\n' "$tool" >&2
    exit 1
  }
done

ERRORS_JS="$SKY_ROOT/dist/project/cua/sky_js/src/targets/mac/errors.js"
POLICY_JS="$SKY_ROOT/dist/project/cua/sky_js/src/targets/mac/computer-use-policy.js"
PACKAGE_JSON="$SKY_ROOT/package.json"
SERVICE_BINARY="$APP/Contents/MacOS/SkyComputerUseService"
SERVICE_INFO="$APP/Contents/Info.plist"

for required in \
  "$ERRORS_JS" \
  "$POLICY_JS" \
  "$PACKAGE_JSON" \
  "$SERVICE_BINARY" \
  "$SERVICE_INFO" \
  "$APP_ASAR"; do
  [[ -f "$required" ]] || {
    printf 'Required artifact not found: %s\n' "$required" >&2
    exit 1
  }
done

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-cu-policy.XXXXXX")"
TMP_OUT=""
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "$TMP_OUT" ]]; then
    rm -f "$TMP_OUT"
  fi
}
trap cleanup EXIT

strings -a -n 4 "$SERVICE_BINARY" >"$TMP_DIR/native.strings"
cat >"$TMP_DIR/asar-patterns.txt" <<'EOF'
ComputerUseAppApprovals.json
approvedBundleIdentifiers
Always allow
Allow this conversation
EOF
rg -a -o -F -f "$TMP_DIR/asar-patterns.txt" "$APP_ASAR" |
  LC_ALL=C sort -u >"$TMP_DIR/asar-matches.txt"

bool_value() {
  if "$@"; then
    printf 'true'
  else
    printf 'false'
  fi
}

SKY_VERSION="$(node -e '
  const packageJson = require(process.argv[1]);
  process.stdout.write(String(packageJson.version));
' "$PACKAGE_JSON")"
SERVICE_VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$SERVICE_INFO")"
SERVICE_BUILD="$(plutil -extract CFBundleVersion raw -o - "$SERVICE_INFO")"

SOURCE_PRESENT=false
SOURCE_COMMIT=""
SOURCE_MCP_APPROVAL_MODES=false
SOURCE_LOCKED_USE_REQUIREMENT=false
SOURCE_APP_POLICY_LISTS_PRESENT=false
if [[ -n "$CODEX_SOURCE_DIR" && -d "$CODEX_SOURCE_DIR/.git" ]]; then
  SOURCE_PRESENT=true
  SOURCE_COMMIT="$(git -C "$CODEX_SOURCE_DIR" rev-parse HEAD)"
  SOURCE_MCP_APPROVAL_MODES="$(bool_value bash -c \
    'rg -q "MCP_TOOL_APPROVAL_PERSIST_SESSION" "$1/codex-rs/core/src/mcp_tool_call.rs" &&
     rg -q "MCP_TOOL_APPROVAL_PERSIST_ALWAYS" "$1/codex-rs/core/src/mcp_tool_call.rs"' \
    _ "$CODEX_SOURCE_DIR")"
  SOURCE_LOCKED_USE_REQUIREMENT="$(bool_value rg -q \
    'allow_locked_computer_use' \
    "$CODEX_SOURCE_DIR/codex-rs/config/src/config_requirements.rs")"
  SOURCE_APP_POLICY_LISTS_PRESENT="$(bool_value rg -q \
    'allowed_bundle_ids|denied_bundle_ids' \
    "$CODEX_SOURCE_DIR/codex-rs")"
fi

export POLICY_ERRORS_JS="$ERRORS_JS"
export POLICY_POLICY_JS="$POLICY_JS"
export POLICY_SKY_VERSION="$SKY_VERSION"
export POLICY_SERVICE_VERSION="$SERVICE_VERSION"
export POLICY_SERVICE_BUILD="$SERVICE_BUILD"
export POLICY_NATIVE_STRINGS="$TMP_DIR/native.strings"
export POLICY_ASAR_MATCHES="$TMP_DIR/asar-matches.txt"
export POLICY_SOURCE_PRESENT="$SOURCE_PRESENT"
export POLICY_SOURCE_COMMIT="$SOURCE_COMMIT"
export POLICY_SOURCE_MCP_APPROVAL_MODES="$SOURCE_MCP_APPROVAL_MODES"
export POLICY_SOURCE_LOCKED_USE_REQUIREMENT="$SOURCE_LOCKED_USE_REQUIREMENT"
export POLICY_SOURCE_APP_POLICY_LISTS_PRESENT="$SOURCE_APP_POLICY_LISTS_PRESENT"

OUT_DIR="$(dirname "$OUT")"
mkdir -p "$OUT_DIR"
TMP_OUT="$(mktemp "$OUT_DIR/.policy-evidence.XXXXXX")"

node --input-type=module >"$TMP_OUT" <<'NODE'
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const env = process.env;
const flag = (name) => env[name] === "true";
const errors = await import(pathToFileURL(env.POLICY_ERRORS_JS));
const policySource = await readFile(env.POLICY_POLICY_JS, "utf8");
const nativeStrings = await readFile(env.POLICY_NATIVE_STRINGS, "utf8");
const asarMatches = new Set(
  (await readFile(env.POLICY_ASAR_MATCHES, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
);
const hasNative = (marker) => nativeStrings.includes(marker);
const hasAsar = (marker) => asarMatches.has(marker);
const policyDecisions = ["allowed", "denied", "forbidden"].filter((decision) =>
  policySource.includes(`case"${decision}"`)
);

const transitions = [
  {
    from: "target_resolved",
    event: "policy_allowed",
    to: "approval_gate",
    effect: "no_action",
    recovery: "approval_or_persisted_match",
    failClosed: true
  },
  {
    from: "target_resolved",
    event: "policy_denied",
    to: "organization_policy_blocked",
    effect: "no_action",
    recovery: "policy_change_required",
    failClosed: true
  },
  {
    from: "target_resolved",
    event: "policy_forbidden",
    to: "safety_forbidden",
    effect: "no_action",
    recovery: "none_exposed",
    failClosed: true
  },
  {
    from: "approval_gate",
    event: "approval_session",
    to: "authorized_unobserved",
    effect: "session_approval_recorded",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "approval_gate",
    event: "approval_always",
    to: "authorized_unobserved",
    effect: "persistent_approval_requested",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "approval_gate",
    event: "approval_always_persistence_failed",
    to: "approval_persistence_failed",
    effect: "no_action_no_silent_session_downgrade",
    recovery: "request_approval_again",
    failClosed: true
  },
  {
    from: "approval_gate",
    event: "approval_declined_or_canceled",
    to: "current_call_denied",
    effect: "no_action",
    recovery: "new_explicit_approval",
    failClosed: true
  },
  {
    from: "authorized_unobserved",
    event: "action_requested",
    to: "authorized_unobserved",
    errorName: "noActiveSession",
    errorCode: -10011,
    effect: "no_action",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "authorized_unobserved",
    event: "get_app_state_succeeded",
    to: "active_observed",
    effect: "fresh_state_bound_to_session",
    recovery: "none",
    failClosed: false
  },
  {
    from: "active_observed",
    event: "blocked_url",
    to: "blocked_url_terminal",
    errorName: "blockedURL",
    errorCode: -10015,
    effect: "session_stopped_no_action",
    recovery: "new_session_after_url_is_allowed",
    sameSessionRetry: false,
    failClosed: true
  },
  {
    from: "active_observed",
    event: "user_stopped_session",
    to: "user_stopped_turn",
    errorName: "userStoppedSession",
    errorCode: -10012,
    effect: "turn_stopped_no_action",
    recovery: "next_assistant_turn",
    sameTurnRetry: false,
    failClosed: true
  },
  {
    from: "active_observed",
    event: "user_input_detected",
    to: "intervention_debounce",
    errorName: "userIntervened",
    errorCode: -10016,
    effect: "no_action",
    recovery: "wait_then_reobserve",
    failClosed: true
  },
  {
    from: "intervention_debounce",
    event: "debounce_elapsed",
    to: "reobserve_required",
    effect: "no_action",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "reobserve_required",
    event: "action_requested",
    to: "reobserve_required",
    errorName: "userIntervened",
    errorCode: -10016,
    effect: "no_action",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "reobserve_required",
    event: "get_app_state_succeeded",
    to: "active_observed",
    effect: "intervention_cleared_after_state_requery",
    recovery: "none",
    failClosed: false
  },
  {
    from: "active_observed",
    event: "screen_locked",
    to: "screen_locked_blocked",
    errorName: "screenLocked",
    errorCode: -10020,
    effect: "no_action",
    recovery: "unlock_then_get_app_state",
    failClosed: true
  },
  {
    from: "screen_locked_blocked",
    event: "unlock_confirmed",
    to: "reobserve_required",
    effect: "no_action",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "target_resolved",
    event: "ambiguous_app",
    to: "ambiguous_target",
    errorName: "ambiguousApp",
    errorCode: -10018,
    effect: "no_action",
    recovery: "use_app_name_or_full_path",
    failClosed: true
  },
  {
    from: "active_observed",
    event: "stale_element_unique_refetch",
    to: "active_observed",
    effect: "identity_preserving_refetch_may_continue",
    recovery: "none",
    failClosed: false
  },
  {
    from: "active_observed",
    event: "stale_element_missing_or_ambiguous",
    to: "reobserve_required",
    effect: "no_action",
    recovery: "get_app_state",
    failClosed: true
  },
  {
    from: "active_observed",
    event: "system_security_process",
    to: "system_security_target_blocked",
    effect: "no_action",
    recovery: "none_exposed",
    failClosed: true
  }
];

const evidence = {
  schemaVersion: 1,
  extraction: {
    nativeStringsPasses: 1,
    nativeSymbolTableScanned: false,
    asarSearchPasses: 1,
    outputReplacement: "same_directory_atomic_rename",
    timestampsCollected: false,
    deterministicForIdenticalInputs: true
  },
  sources: {
    sky: {
      package: "@oai/sky",
      version: env.POLICY_SKY_VERSION,
      modules: [
        "targets/mac/errors.js",
        "targets/mac/computer-use-policy.js"
      ]
    },
    native: {
      artifact: "SkyComputerUseService",
      version: env.POLICY_SERVICE_VERSION,
      build: env.POLICY_SERVICE_BUILD
    },
    electron: {
      artifact: "ChatGPT app.asar",
      approvalSchemaMarkersPresent:
        hasAsar("ComputerUseAppApprovals.json") &&
        hasAsar("approvedBundleIdentifiers"),
      approvalModeLabelsPresent:
        hasAsar("Always allow") &&
        hasAsar("Allow this conversation")
    },
    publicCodexSource: {
      repository: "openai/codex",
      inspected: flag("POLICY_SOURCE_PRESENT"),
      commit: env.POLICY_SOURCE_COMMIT || null,
      genericMcpSessionAndPersistentApprovalPresent: flag(
        "POLICY_SOURCE_MCP_APPROVAL_MODES"
      ),
      lockedComputerUseRequirementPresent: flag(
        "POLICY_SOURCE_LOCKED_USE_REQUIREMENT"
      ),
      nativeAppPolicyListFieldsPresent: flag(
        "POLICY_SOURCE_APP_POLICY_LISTS_PRESENT"
      )
    }
  },
  privacy: {
    approvalStoreContentsRead: false,
    approvalStorePathProbed: false,
    urlHistoryRead: false,
    browserHistoryRead: false,
    userAppInventoryRead: false,
    unifiedLogsRead: false,
    realCuaSocketConnected: false,
    uiActionsExecuted: false
  },
  serverErrorCodes: errors.ServerErrorCode,
  appPolicy: {
    decisions: policyDecisions,
    evaluationOrder: [
      "resolve_target",
      "evaluate_current_app_policy",
      "request_or_reuse_approval",
      "bind_fresh_app_session",
      "perform_action"
    ],
    nativeProviderPresent: hasNative(
      "CodexAppServerComputerUsePolicyProvider"
    ),
    nativePolicyFieldsPresent:
      hasNative("allow_persistent_approval") &&
      hasNative("denied_bundle_ids") &&
      hasNative("allowed_bundle_ids"),
    persistentApprovalOfferedOnlyWhenPolicyAllows: policySource.includes(
      'n.allowPersistentApproval?["session","always"]:["session"]'
    ),
    deniedEffect: "organization_policy_block_no_approval",
    forbiddenEffect: "safety_block_no_approval",
    allowedEffect: "continue_to_approval_gate_not_direct_action"
  },
  approvals: {
    modes: ["session", "always"],
    sessionApprovalSymbolPresent: hasNative(
      "sessionApprovedBundleIdentifiers"
    ),
    persistentApprovalSymbolPresent: hasNative("persistentApprovals"),
    approvalStoreSymbolPresent: hasNative("AppApprovalStore"),
    electronStoreSchemaPresent:
      hasAsar("ComputerUseAppApprovals.json") &&
      hasAsar("approvedBundleIdentifiers"),
    permanentPersistenceFailurePathPresent: hasNative(
      "could not persist the approval permanently"
    ),
    contentsCollected: false,
    invariants: [
      "policy_is_rechecked_before_approval_reuse",
      "persistent_approval_does_not_override_denied_or_forbidden",
      "persistent_approval_does_not_create_an_active_observed_session",
      "permanent_persistence_failure_is_not_a_silent_session_downgrade"
    ]
  },
  nativeRules: {
    forbiddenTargets: {
      decisionPresent: policyDecisions.includes("forbidden"),
      developerOverrideKeyPresent: hasNative(
        "ComputerUseAllowForbiddenTargets"
      ),
      listRecovered: false,
      entries: [],
      boundary: "no_complete_default_forbidden_target_list_was_exposed"
    },
    systemSecurityProcesses: {
      classifierMarkerPresent: hasNative(
        "systemSecurityTargetNotAllowed"
      ),
      actionRejectionPresent: hasNative(
        "Computer use actions are not allowed for system security process: "
      ),
      listRecovered: false,
      entries: [],
      boundary: "classification_exists_but_membership_was_not_enumerated"
    },
    defaultBlockedUrls: {
      cachePresent: hasNative("ComputerUseURLBlocklistCache"),
      remotePolicyCheckerPresent: hasNative(
        "AuraSiteStatusURLPolicyChecker"
      ),
      failClosedStopMessagePresent: hasNative(
        "Computer Use stopped due to encountering a disallowed URL: "
      ),
      listRecovered: false,
      entries: [],
      boundary: "runtime_site_status_policy_not_an_embedded_domain_list"
    }
  },
  runtimeEvidence: {
    noActiveSessionGuidancePresent: hasNative(
      "Computer Use is not active for '"
    ),
    userInterventionWaitGuidancePresent: hasNative(
      "The user is still interacting with '"
    ),
    userInterventionRequeryGuidancePresent: hasNative(
      "Re-query the latest state with `get_app_state` before sending more actions."
    ),
    interventionClearsAfterStateRequerySymbolPresent: hasNative(
      "clearUserInterruptedInterventionAfterStateRequery"
    ),
    screenLockedGuidancePresent: hasNative(
      "The Mac is locked and automatic unlock could not unlock it."
    ),
    ambiguousAppGuidancePresent: hasNative("Ambiguous app identifier '"),
    staleElementGuidancePresent: hasNative(
      "The element ID is no longer valid."
    ),
    ambiguousStaleRefetchRejectedPresent: hasNative(
      "multiple elements were found that match the criteria"
    )
  },
  stateMachine: {
    actionAllowedOnlyIn: "active_observed",
    transitions
  }
};

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
NODE

chmod 600 "$TMP_OUT"
mv -f "$TMP_OUT" "$OUT"
TMP_OUT=""
printf 'Wrote %s\n' "$OUT"
