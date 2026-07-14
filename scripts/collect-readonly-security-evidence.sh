#!/usr/bin/env bash

set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/fixtures/security/latest.json"
APP="${CODEX_CU_APP_BUNDLE:-$HOME/.codex/computer-use/Codex Computer Use.app}"
TEAM_ID="2DC432GLL2"
SERVICE_ID="com.openai.sky.CUAService"
GROUP_ROOT="$HOME/Library/Group Containers/$TEAM_ID.$SERVICE_ID"
CUA_SOCKET="$GROUP_ROOT/IPC/computeruse.sock"
LOCK_SOCKET_DIR="/tmp/$SERVICE_ID"
LOCK_SOCKET="$LOCK_SOCKET_DIR/LockScreenLoginAuthorization.sock"
SYSTEM_REQUIREMENTS="/etc/codex/requirements.toml"
LEGACY_REQUIREMENTS="/etc/codex/managed_config.toml"
INSTALLED_AUTH_PLUGIN="/Library/Security/SecurityAgentPlugins/CodexComputerUseAuthorizationPlugin.bundle"
TCC_DB="/Library/Application Support/com.apple.TCC/TCC.db"
CODEX_BIN="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex}"
NODE_BIN="${NODE_BIN:-/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node}"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

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

if [[ ! -d "$APP" ]]; then
  printf 'Computer Use app not found at %s\n' "$APP" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-cu-security.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

bool() {
  if "$@" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

safe_stat() {
  local path="$1"
  local prefix="$2"
  local present=false
  local type="absent"
  local mode="none"
  local owner_current_user=false

  if [[ -e "$path" || -S "$path" ]]; then
    present=true
    if [[ -S "$path" ]]; then
      type="Socket"
    elif [[ -d "$path" ]]; then
      type="Directory"
    elif [[ -f "$path" ]]; then
      type="Regular File"
    elif [[ -L "$path" ]]; then
      type="Symbolic Link"
    else
      type="Other"
    fi
    mode="$(/usr/bin/stat -f '%Lp' "$path" 2>/dev/null || printf 'unknown')"
    if [[ "$(/usr/bin/stat -f '%u' "$path" 2>/dev/null || printf 'unknown')" == "$(id -u)" ]]; then
      owner_current_user=true
    fi
  fi

  printf -v "${prefix}_PRESENT" '%s' "$present"
  printf -v "${prefix}_TYPE" '%s' "$type"
  printf -v "${prefix}_MODE" '%s' "$mode"
  printf -v "${prefix}_OWNER_CURRENT_USER" '%s' "$owner_current_user"
}

read_computer_use_requirement() {
  local file="$1"
  if [[ ! -r "$file" ]]; then
    printf 'unset'
    return
  fi

  /usr/bin/awk '
    BEGIN { in_section = 0; value = "unset" }
    /^[[:space:]]*\[computer_use\][[:space:]]*$/ { in_section = 1; next }
    /^[[:space:]]*\[/ { in_section = 0 }
    in_section && /^[[:space:]]*allow_locked_computer_use[[:space:]]*=/ {
      line = $0
      sub(/#.*/, "", line)
      sub(/^[^=]*=/, "", line)
      gsub(/[[:space:]]/, "", line)
      if (line == "true" || line == "false") value = line
      else value = "invalid"
    }
    END { print value }
  ' "$file"
}

read_effective_computer_use_requirement() {
  "$NODE_BIN" - "$CODEX_BIN" <<'NODE' 2>/dev/null || printf 'query_failed'
const { spawn } = require("node:child_process");

const child = spawn(process.argv[2], ["app-server", "--listen", "stdio://"], {
  env: {
    HOME: process.env.HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    RUST_LOG: "error",
    CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1"
  },
  stdio: ["pipe", "pipe", "ignore"]
});

let buffer = "";
let finished = false;
const timeout = setTimeout(() => finish("query_failed"), 10_000);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(value) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  process.stdout.write(value);
  child.stdin.end();
  child.kill("SIGTERM");
}

child.on("error", () => finish("query_failed"));
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      finish("query_failed");
      return;
    }

    if (message.id === "security-initialize" && !message.error) {
      send({ method: "initialized" });
      send({ id: "security-requirements", method: "configRequirements/read" });
    }

    if (message.id === "security-requirements") {
      if (message.error) {
        finish("query_failed");
        return;
      }
      const value =
        message.result?.requirements?.computerUse?.allowLockedComputerUse;
      finish(value === true ? "true" : value === false ? "false" : "unset");
    }
  }
});

send({
  id: "security-initialize",
  method: "initialize",
  params: {
    clientInfo: {
      name: "codex_computer_use_security_probe",
      title: "Codex Computer Use Security Probe",
      version: "0.1.0"
    },
    capabilities: {
      experimentalApi: false,
      requestAttestation: false,
      mcpServerOpenaiFormElicitation: false
    }
  }
});
NODE
}

tcc_state() {
  local service="$1"
  local value

  if [[ ! -r "$TCC_DB" ]]; then
    printf 'unreadable'
    return
  fi

  value="$(/usr/bin/sqlite3 -readonly "$TCC_DB" \
    "select auth_value from access where service='$service' and client='$SERVICE_ID' order by last_modified desc limit 1;" \
    2>/dev/null || true)"

  case "$value" in
    2) printf 'allowed' ;;
    0) printf 'denied' ;;
    "") printf 'not_observed' ;;
    *) printf 'other' ;;
  esac
}

MAIN_BINARY="$APP/Contents/MacOS/SkyComputerUseService"
INFO_PLIST="$APP/Contents/Info.plist"
PROVISION_PROFILE="$APP/Contents/embedded.provisionprofile"
INSTALLER_APP="$APP/Contents/SharedSupport/Codex Computer Use Installer.app"
EMBEDDED_AUTH_PLUGIN="$INSTALLER_APP/Contents/Resources/CodexComputerUseAuthorizationPlugin.bundle"
AUTH_PLUGIN_BINARY="$EMBEDDED_AUTH_PLUGIN/Contents/MacOS/CodexComputerUseAuthorizationPlugin"
CLIENT_REQUIREMENT="$APP/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Resources/SkyComputerUseClient_Parent.coderequirement"
GUARDIAN_REQUIREMENT="$APP/Contents/SharedSupport/CUALockScreenGuardian.app/Contents/Resources/CUALockScreenGuardian_Parent.coderequirement"

SIGNATURE_VALID="$(bool /usr/bin/codesign --verify --deep --strict "$APP")"
NOTARIZED="$(bool /usr/sbin/spctl -a --type execute "$APP")"
/usr/bin/codesign -d --verbose=4 "$APP" >"$TMP_DIR/codesign.txt" 2>&1 || true
IDENTIFIER="$(/usr/bin/sed -n 's/^Identifier=//p' "$TMP_DIR/codesign.txt" | /usr/bin/head -n 1)"
SIGNED_TEAM_ID="$(/usr/bin/sed -n 's/^TeamIdentifier=//p' "$TMP_DIR/codesign.txt" | /usr/bin/head -n 1)"
AUTHORITY="$(/usr/bin/sed -n 's/^Authority=//p' "$TMP_DIR/codesign.txt" | /usr/bin/head -n 1)"
HARDENED_RUNTIME="$(bool /usr/bin/grep -q 'flags=.*runtime' "$TMP_DIR/codesign.txt")"
VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$INFO_PLIST" 2>/dev/null || printf 'unknown')"
BUNDLE_VERSION="$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$INFO_PLIST" 2>/dev/null || printf 'unknown')"
LSUI_ELEMENT="$(/usr/bin/plutil -extract LSUIElement raw -o - "$INFO_PLIST" 2>/dev/null || printf 'false')"
MAIN_SHA256="$(/usr/bin/shasum -a 256 "$MAIN_BINARY" | /usr/bin/awk '{print $1}')"

/usr/bin/codesign -d --entitlements :- "$APP" >"$TMP_DIR/entitlements.plist" 2>/dev/null || true
APP_SANDBOX="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.app-sandbox' "$TMP_DIR/entitlements.plist" 2>/dev/null || printf 'false')"
APPLICATION_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.application-identifier' "$TMP_DIR/entitlements.plist" 2>/dev/null || printf 'absent')"
ENTITLEMENT_TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.team-identifier' "$TMP_DIR/entitlements.plist" 2>/dev/null || printf 'absent')"
HAS_APP_GROUP="$(bool /usr/libexec/PlistBuddy -c 'Print :com.apple.security.application-groups' "$TMP_DIR/entitlements.plist")"
HAS_KEYCHAIN_GROUP="$(bool /usr/libexec/PlistBuddy -c 'Print :keychain-access-groups' "$TMP_DIR/entitlements.plist")"

PROVISION_PRESENT="$(bool test -f "$PROVISION_PROFILE")"
PROVISION_NAME="absent"
PROVISION_TEAM_ID="absent"
PROVISION_SHA256="absent"
if [[ "$PROVISION_PRESENT" == "true" ]]; then
  /usr/bin/security cms -D -i "$PROVISION_PROFILE" >"$TMP_DIR/provision.plist" 2>/dev/null || true
  PROVISION_NAME="$(/usr/bin/plutil -extract Name raw -o - "$TMP_DIR/provision.plist" 2>/dev/null || printf 'unreadable')"
  PROVISION_TEAM_ID="$(/usr/bin/plutil -extract TeamIdentifier.0 raw -o - "$TMP_DIR/provision.plist" 2>/dev/null || printf 'unreadable')"
  PROVISION_SHA256="$(/usr/bin/shasum -a 256 "$PROVISION_PROFILE" | /usr/bin/awk '{print $1}')"
fi

safe_stat "$GROUP_ROOT" GROUP_ROOT_STAT
safe_stat "$GROUP_ROOT/IPC" IPC_DIR_STAT
safe_stat "$GROUP_ROOT/IPC/computeruse.sock.lock" CUA_LOCK_STAT
safe_stat "$CUA_SOCKET" CUA_SOCKET_STAT
safe_stat "$LOCK_SOCKET_DIR" LOCK_DIR_STAT
safe_stat "$LOCK_SOCKET" LOCK_SOCKET_STAT
safe_stat "$HOME/.codex" TRUST_ROOT_STAT
safe_stat "$HOME/.codex/plugins" TRUST_PLUGINS_STAT
safe_stat "$HOME/.codex/plugins/cache" TRUST_CACHE_STAT
safe_stat "$HOME/.codex/skills" TRUST_SKILLS_STAT

CUA_SOCKET_HELD_BY_SERVICE=false
if [[ "$CUA_SOCKET_STAT_PRESENT" == "true" ]] &&
  /usr/sbin/lsof -nP -U -- "$CUA_SOCKET" 2>/dev/null |
    /usr/bin/awk 'NR > 1 { print $1 }' |
    /usr/bin/grep -q '^SkyComput'; then
  CUA_SOCKET_HELD_BY_SERVICE=true
fi

/usr/bin/strings -a "$MAIN_BINARY" >"$TMP_DIR/service.strings"
/usr/bin/strings -a "$AUTH_PLUGIN_BINARY" >"$TMP_DIR/auth-plugin.strings"

SERVICE_HAS_LOCAL_PEERTOKEN="$(bool /usr/bin/grep -Fq 'LOCAL_PEERTOKEN failed' "$TMP_DIR/service.strings")"
SERVICE_HAS_INVALID_PEER_REJECTION="$(bool /usr/bin/grep -Fq 'invalid peer token length' "$TMP_DIR/service.strings")"
PLUGIN_READS_AUDIT_TOKEN="$(bool /usr/bin/grep -Fq 'Unable to read login authorization socket peer audit token' "$TMP_DIR/auth-plugin.strings")"
PLUGIN_CHECKS_SIGNING_ID="$(bool /usr/bin/grep -Fq 'Unable to copy login authorization socket peer signing identifier' "$TMP_DIR/auth-plugin.strings")"
PLUGIN_CHECKS_TEAM_ID="$(bool /usr/bin/grep -Fq 'Unable to copy login authorization socket peer team identifier' "$TMP_DIR/auth-plugin.strings")"
PLUGIN_REJECTS_MISMATCH="$(bool /usr/bin/grep -Fq 'peer identity mismatch' "$TMP_DIR/auth-plugin.strings")"
PLUGIN_EXPECTS_SERVICE_ID="$(bool /usr/bin/grep -Fq "$SERVICE_ID" "$TMP_DIR/auth-plugin.strings")"
PLUGIN_EXPECTS_TEAM_ID="$(bool /usr/bin/grep -Fq "$TEAM_ID" "$TMP_DIR/auth-plugin.strings")"
GUARDIAN_FAIL_CLOSED="$(bool /usr/bin/grep -Fq 'Guardian fail-closed after Computer Use service connection ended.' "$TMP_DIR/service.strings")"
PHYSICAL_INPUT_RELOCK="$(bool /usr/bin/grep -Fq 'physical input during lock-screen Computer Use auto-unlock' "$TMP_DIR/service.strings")"
STALE_ELEMENT_REFETCH="$(bool /usr/bin/grep -Fq 'Element is invalidated, looking up equivalent' "$TMP_DIR/service.strings")"
STALE_ELEMENT_AMBIGUOUS_REJECT="$(bool /usr/bin/grep -Fq 'Multiple new equivalent elements; cannot guarantee uniqueness' "$TMP_DIR/service.strings")"
REOBSERVE_PATTERN="Re-query the latest state with \`get_app_state\` before sending more actions."
USER_INTERVENTION_REOBSERVE="$(bool /usr/bin/grep -Fq "$REOBSERVE_PATTERN" "$TMP_DIR/service.strings")"
PERSISTENT_APPROVAL_STORE="$(bool /usr/bin/grep -Fq 'AppApprovalStore' "$TMP_DIR/service.strings")"
PERSISTENT_APPROVAL_FAILURE="$(bool /usr/bin/grep -Fq 'could not persist the approval permanently' "$TMP_DIR/service.strings")"
REQUIREMENTS_SCHEMA_FIELD_OBSERVED="$(bool /usr/bin/grep -aFq 'allow_locked_computer_use' "$CODEX_BIN")"

CLIENT_PARENT_TEAM_ID="$(/usr/bin/plutil -extract team-identifier raw -o - "$CLIENT_REQUIREMENT" 2>/dev/null || printf 'unreadable')"
GUARDIAN_PARENT_TEAM_ID="$(/usr/bin/plutil -extract team-identifier raw -o - "$GUARDIAN_REQUIREMENT" 2>/dev/null || printf 'unreadable')"

EMBEDDED_AUTH_PLUGIN_PRESENT="$(bool test -d "$EMBEDDED_AUTH_PLUGIN")"
EMBEDDED_AUTH_PLUGIN_VALID="$(bool /usr/bin/codesign --verify --deep --strict "$EMBEDDED_AUTH_PLUGIN")"
INSTALLED_AUTH_PLUGIN_PRESENT="$(bool test -d "$INSTALLED_AUTH_PLUGIN")"
/usr/bin/security authorizationdb read system.login.console >"$TMP_DIR/authorizationdb.plist" 2>/dev/null || true
AUTHDB_REFERENCES_PLUGIN="$(bool /usr/bin/grep -Fq 'CodexComputerUseAuthorizationPlugin' "$TMP_DIR/authorizationdb.plist")"

SYSTEM_REQUIREMENTS_PRESENT="$(bool test -f "$SYSTEM_REQUIREMENTS")"
LEGACY_REQUIREMENTS_PRESENT="$(bool test -f "$LEGACY_REQUIREMENTS")"
SYSTEM_LOCKED_VALUE="$(read_computer_use_requirement "$SYSTEM_REQUIREMENTS")"
LEGACY_LOCKED_VALUE="$(read_computer_use_requirement "$LEGACY_REQUIREMENTS")"
LOCKED_EFFECTIVE="$(read_effective_computer_use_requirement)"
EFFECTIVE_REQUIREMENTS_QUERIED=true
if [[ "$LOCKED_EFFECTIVE" == "query_failed" ]]; then
  LOCKED_EFFECTIVE="unknown"
  EFFECTIVE_REQUIREMENTS_QUERIED=false
fi

TCC_ACCESSIBILITY="$(tcc_state kTCCServiceAccessibility)"
TCC_SCREEN_CAPTURE="$(tcc_state kTCCServiceScreenCapture)"
TCC_LISTEN_EVENT="$(tcc_state kTCCServiceListenEvent)"
TCC_POST_EVENT="$(tcc_state kTCCServicePostEvent)"

LOCKED_READY=false
if [[ "$INSTALLED_AUTH_PLUGIN_PRESENT" == "true" &&
  "$AUTHDB_REFERENCES_PLUGIN" == "true" &&
  "$LOCKED_EFFECTIVE" == "true" ]]; then
  LOCKED_READY=true
fi

SEC_COLLECTED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
SEC_OS_VERSION="$(/usr/bin/sw_vers -productVersion)"
SEC_ARCH="$(/usr/bin/uname -m)"
export SEC_COLLECTED_AT SEC_OS_VERSION SEC_ARCH
export SEC_VERSION="$VERSION"
export SEC_BUNDLE_VERSION="$BUNDLE_VERSION"
export SEC_IDENTIFIER="$IDENTIFIER"
export SEC_TEAM_ID="$SIGNED_TEAM_ID"
export SEC_AUTHORITY="$AUTHORITY"
export SEC_SIGNATURE_VALID="$SIGNATURE_VALID"
export SEC_NOTARIZED="$NOTARIZED"
export SEC_HARDENED_RUNTIME="$HARDENED_RUNTIME"
export SEC_LSUI_ELEMENT="$LSUI_ELEMENT"
export SEC_MAIN_SHA256="$MAIN_SHA256"
export SEC_APP_SANDBOX="$APP_SANDBOX"
export SEC_APPLICATION_IDENTIFIER="$APPLICATION_IDENTIFIER"
export SEC_ENTITLEMENT_TEAM_ID="$ENTITLEMENT_TEAM_ID"
export SEC_HAS_APP_GROUP="$HAS_APP_GROUP"
export SEC_HAS_KEYCHAIN_GROUP="$HAS_KEYCHAIN_GROUP"
export SEC_PROVISION_PRESENT="$PROVISION_PRESENT"
export SEC_PROVISION_NAME="$PROVISION_NAME"
export SEC_PROVISION_TEAM_ID="$PROVISION_TEAM_ID"
export SEC_PROVISION_SHA256="$PROVISION_SHA256"
export SEC_GROUP_ROOT_PRESENT="$GROUP_ROOT_STAT_PRESENT"
export SEC_GROUP_ROOT_TYPE="$GROUP_ROOT_STAT_TYPE"
export SEC_GROUP_ROOT_MODE="$GROUP_ROOT_STAT_MODE"
export SEC_GROUP_ROOT_OWNER="$GROUP_ROOT_STAT_OWNER_CURRENT_USER"
export SEC_IPC_DIR_PRESENT="$IPC_DIR_STAT_PRESENT"
export SEC_IPC_DIR_TYPE="$IPC_DIR_STAT_TYPE"
export SEC_IPC_DIR_MODE="$IPC_DIR_STAT_MODE"
export SEC_IPC_DIR_OWNER="$IPC_DIR_STAT_OWNER_CURRENT_USER"
export SEC_CUA_LOCK_PRESENT="$CUA_LOCK_STAT_PRESENT"
export SEC_CUA_LOCK_TYPE="$CUA_LOCK_STAT_TYPE"
export SEC_CUA_LOCK_MODE="$CUA_LOCK_STAT_MODE"
export SEC_CUA_LOCK_OWNER="$CUA_LOCK_STAT_OWNER_CURRENT_USER"
export SEC_CUA_SOCKET_PRESENT="$CUA_SOCKET_STAT_PRESENT"
export SEC_CUA_SOCKET_TYPE="$CUA_SOCKET_STAT_TYPE"
export SEC_CUA_SOCKET_MODE="$CUA_SOCKET_STAT_MODE"
export SEC_CUA_SOCKET_OWNER="$CUA_SOCKET_STAT_OWNER_CURRENT_USER"
export SEC_CUA_SOCKET_HELD="$CUA_SOCKET_HELD_BY_SERVICE"
export SEC_LOCK_DIR_PRESENT="$LOCK_DIR_STAT_PRESENT"
export SEC_LOCK_DIR_TYPE="$LOCK_DIR_STAT_TYPE"
export SEC_LOCK_DIR_MODE="$LOCK_DIR_STAT_MODE"
export SEC_LOCK_DIR_OWNER="$LOCK_DIR_STAT_OWNER_CURRENT_USER"
export SEC_LOCK_SOCKET_PRESENT="$LOCK_SOCKET_STAT_PRESENT"
export SEC_LOCK_SOCKET_TYPE="$LOCK_SOCKET_STAT_TYPE"
export SEC_LOCK_SOCKET_MODE="$LOCK_SOCKET_STAT_MODE"
export SEC_LOCK_SOCKET_OWNER="$LOCK_SOCKET_STAT_OWNER_CURRENT_USER"
export SEC_SERVICE_LOCAL_PEERTOKEN="$SERVICE_HAS_LOCAL_PEERTOKEN"
export SEC_SERVICE_INVALID_PEER_REJECTION="$SERVICE_HAS_INVALID_PEER_REJECTION"
export SEC_PLUGIN_AUDIT_TOKEN="$PLUGIN_READS_AUDIT_TOKEN"
export SEC_PLUGIN_SIGNING_ID="$PLUGIN_CHECKS_SIGNING_ID"
export SEC_PLUGIN_TEAM_ID="$PLUGIN_CHECKS_TEAM_ID"
export SEC_PLUGIN_REJECTS_MISMATCH="$PLUGIN_REJECTS_MISMATCH"
export SEC_PLUGIN_EXPECTS_SERVICE_ID="$PLUGIN_EXPECTS_SERVICE_ID"
export SEC_PLUGIN_EXPECTS_TEAM_ID="$PLUGIN_EXPECTS_TEAM_ID"
export SEC_CLIENT_PARENT_TEAM_ID="$CLIENT_PARENT_TEAM_ID"
export SEC_GUARDIAN_PARENT_TEAM_ID="$GUARDIAN_PARENT_TEAM_ID"
export SEC_GUARDIAN_FAIL_CLOSED="$GUARDIAN_FAIL_CLOSED"
export SEC_PHYSICAL_INPUT_RELOCK="$PHYSICAL_INPUT_RELOCK"
export SEC_STALE_REFETCH="$STALE_ELEMENT_REFETCH"
export SEC_STALE_AMBIGUOUS_REJECT="$STALE_ELEMENT_AMBIGUOUS_REJECT"
export SEC_USER_INTERVENTION_REOBSERVE="$USER_INTERVENTION_REOBSERVE"
export SEC_PERSISTENT_APPROVAL_STORE="$PERSISTENT_APPROVAL_STORE"
export SEC_PERSISTENT_APPROVAL_FAILURE="$PERSISTENT_APPROVAL_FAILURE"
export SEC_REQUIREMENTS_SCHEMA_FIELD_OBSERVED="$REQUIREMENTS_SCHEMA_FIELD_OBSERVED"
export SEC_EMBEDDED_PLUGIN_PRESENT="$EMBEDDED_AUTH_PLUGIN_PRESENT"
export SEC_EMBEDDED_PLUGIN_VALID="$EMBEDDED_AUTH_PLUGIN_VALID"
export SEC_INSTALLED_PLUGIN_PRESENT="$INSTALLED_AUTH_PLUGIN_PRESENT"
export SEC_AUTHDB_REFERENCES_PLUGIN="$AUTHDB_REFERENCES_PLUGIN"
export SEC_SYSTEM_REQUIREMENTS_PRESENT="$SYSTEM_REQUIREMENTS_PRESENT"
export SEC_LEGACY_REQUIREMENTS_PRESENT="$LEGACY_REQUIREMENTS_PRESENT"
export SEC_SYSTEM_LOCKED_VALUE="$SYSTEM_LOCKED_VALUE"
export SEC_LEGACY_LOCKED_VALUE="$LEGACY_LOCKED_VALUE"
export SEC_LOCKED_EFFECTIVE="$LOCKED_EFFECTIVE"
export SEC_EFFECTIVE_REQUIREMENTS_QUERIED="$EFFECTIVE_REQUIREMENTS_QUERIED"
export SEC_LOCKED_READY="$LOCKED_READY"
export SEC_TCC_ACCESSIBILITY="$TCC_ACCESSIBILITY"
export SEC_TCC_SCREEN_CAPTURE="$TCC_SCREEN_CAPTURE"
export SEC_TCC_LISTEN_EVENT="$TCC_LISTEN_EVENT"
export SEC_TCC_POST_EVENT="$TCC_POST_EVENT"
export SEC_TRUST_ROOT_PRESENT="$TRUST_ROOT_STAT_PRESENT"
export SEC_TRUST_ROOT_TYPE="$TRUST_ROOT_STAT_TYPE"
export SEC_TRUST_ROOT_MODE="$TRUST_ROOT_STAT_MODE"
export SEC_TRUST_ROOT_OWNER="$TRUST_ROOT_STAT_OWNER_CURRENT_USER"
export SEC_TRUST_PLUGINS_PRESENT="$TRUST_PLUGINS_STAT_PRESENT"
export SEC_TRUST_PLUGINS_TYPE="$TRUST_PLUGINS_STAT_TYPE"
export SEC_TRUST_PLUGINS_MODE="$TRUST_PLUGINS_STAT_MODE"
export SEC_TRUST_PLUGINS_OWNER="$TRUST_PLUGINS_STAT_OWNER_CURRENT_USER"
export SEC_TRUST_CACHE_PRESENT="$TRUST_CACHE_STAT_PRESENT"
export SEC_TRUST_CACHE_TYPE="$TRUST_CACHE_STAT_TYPE"
export SEC_TRUST_CACHE_MODE="$TRUST_CACHE_STAT_MODE"
export SEC_TRUST_CACHE_OWNER="$TRUST_CACHE_STAT_OWNER_CURRENT_USER"
export SEC_TRUST_SKILLS_PRESENT="$TRUST_SKILLS_STAT_PRESENT"
export SEC_TRUST_SKILLS_TYPE="$TRUST_SKILLS_STAT_TYPE"
export SEC_TRUST_SKILLS_MODE="$TRUST_SKILLS_STAT_MODE"
export SEC_TRUST_SKILLS_OWNER="$TRUST_SKILLS_STAT_OWNER_CURRENT_USER"

mkdir -p "$(dirname "$OUT")"
/usr/bin/env node - "$OUT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const out = path.resolve(process.argv[2]);
const env = process.env;
const b = (name) => env[name] === "true";
const s = (name) => env[name] ?? "unknown";
const metadata = (prefix, displayPath) => ({
  path: displayPath,
  present: b(`${prefix}_PRESENT`),
  type: s(`${prefix}_TYPE`),
  mode: s(`${prefix}_MODE`),
  owner: b(`${prefix}_OWNER`) ? "current_user" : "other_or_unknown"
});

const evidence = {
  schemaVersion: 1,
  collectedAt: s("SEC_COLLECTED_AT"),
  host: {
    osVersion: s("SEC_OS_VERSION"),
    architecture: s("SEC_ARCH"),
    hostnameCollected: false,
    usernameCollected: false
  },
  safety: {
    defaultRedaction: true,
    configurationContentsCollected: false,
    environmentDumped: false,
    approvalContentsCollected: false,
    logsCollected: false,
    tccModified: false,
    authorizationDbModified: false,
    installerExecuted: false,
    realCuaSocket: {
      metadataRead: true,
      connected: false,
      written: false
    }
  },
  codeSignature: {
    bundle: "<CODEX_HOME>/computer-use/Codex Computer Use.app",
    version: s("SEC_VERSION"),
    bundleVersion: s("SEC_BUNDLE_VERSION"),
    identifier: s("SEC_IDENTIFIER"),
    teamIdentifier: s("SEC_TEAM_ID"),
    authority: s("SEC_AUTHORITY"),
    validOnDisk: b("SEC_SIGNATURE_VALID"),
    notarizedDeveloperId: b("SEC_NOTARIZED"),
    hardenedRuntime: b("SEC_HARDENED_RUNTIME"),
    lsUiElement: b("SEC_LSUI_ELEMENT"),
    mainExecutableSha256: s("SEC_MAIN_SHA256")
  },
  entitlements: {
    applicationIdentifier: s("SEC_APPLICATION_IDENTIFIER"),
    teamIdentifier: s("SEC_ENTITLEMENT_TEAM_ID"),
    appSandbox: b("SEC_APP_SANDBOX"),
    appGroupPresent: b("SEC_HAS_APP_GROUP"),
    keychainAccessGroupPresent: b("SEC_HAS_KEYCHAIN_GROUP")
  },
  provisionProfile: {
    present: b("SEC_PROVISION_PRESENT"),
    name: s("SEC_PROVISION_NAME"),
    teamIdentifier: s("SEC_PROVISION_TEAM_ID"),
    sha256: s("SEC_PROVISION_SHA256")
  },
  tcc: {
    source: "system_tcc_db_readonly_exact_client_query",
    accessibility: { state: s("SEC_TCC_ACCESSIBILITY") },
    screenCapture: { state: s("SEC_TCC_SCREEN_CAPTURE") },
    inputMonitoring: { state: s("SEC_TCC_LISTEN_EVENT") },
    postEvent: { state: s("SEC_TCC_POST_EVENT") },
    absenceMeaning: "not_observed_is_not_proof_of_unused_code"
  },
  ipc: {
    groupContainer: metadata("SEC_GROUP_ROOT", "<GROUP_CONTAINER>"),
    directory: metadata("SEC_IPC_DIR", "<GROUP_CONTAINER>/IPC"),
    lockFile: metadata("SEC_CUA_LOCK", "<GROUP_CONTAINER>/IPC/computeruse.sock.lock"),
    cuaSocket: {
      ...metadata("SEC_CUA_SOCKET", "<GROUP_CONTAINER>/IPC/computeruse.sock"),
      heldByServiceProcess: b("SEC_CUA_SOCKET_HELD"),
      connectedByCollector: false
    },
    expectedSecureModes: {
      groupContainer: "700",
      directory: "700",
      lockFile: "600",
      cuaSocket: "600"
    },
    secureModeCheck:
      s("SEC_GROUP_ROOT_MODE") === "700" &&
      s("SEC_IPC_DIR_MODE") === "700" &&
      s("SEC_CUA_LOCK_MODE") === "600" &&
      s("SEC_CUA_SOCKET_MODE") === "600" &&
      b("SEC_GROUP_ROOT_OWNER") &&
      b("SEC_IPC_DIR_OWNER") &&
      b("SEC_CUA_LOCK_OWNER") &&
      b("SEC_CUA_SOCKET_OWNER")
  },
  peerIdentity: {
    evidenceClass: "binary_static_strings_and_parent_requirements",
    cuaSocketServerUsesLocalPeerToken: b("SEC_SERVICE_LOCAL_PEERTOKEN"),
    cuaSocketServerRejectsInvalidPeerToken: b("SEC_SERVICE_INVALID_PEER_REJECTION"),
    lockScreenPluginReadsAuditToken: b("SEC_PLUGIN_AUDIT_TOKEN"),
    lockScreenPluginChecksSigningIdentifier: b("SEC_PLUGIN_SIGNING_ID"),
    lockScreenPluginChecksTeamIdentifier: b("SEC_PLUGIN_TEAM_ID"),
    lockScreenPluginRejectsIdentityMismatch: b("SEC_PLUGIN_REJECTS_MISMATCH"),
    expectedSigningIdentifier: b("SEC_PLUGIN_EXPECTS_SERVICE_ID")
      ? "com.openai.sky.CUAService"
      : "not_observed",
    expectedTeamIdentifier: b("SEC_PLUGIN_EXPECTS_TEAM_ID")
      ? "2DC432GLL2"
      : "not_observed",
    clientParentTeamIdentifier: s("SEC_CLIENT_PARENT_TEAM_ID"),
    guardianParentTeamIdentifier: s("SEC_GUARDIAN_PARENT_TEAM_ID"),
    runtimePeerHandshakeExercised: false
  },
  lockScreen: {
    embeddedAuthorizationPlugin: {
      present: b("SEC_EMBEDDED_PLUGIN_PRESENT"),
      signatureValid: b("SEC_EMBEDDED_PLUGIN_VALID")
    },
    installedAuthorizationPlugin: {
      path: "/Library/Security/SecurityAgentPlugins/CodexComputerUseAuthorizationPlugin.bundle",
      present: b("SEC_INSTALLED_PLUGIN_PRESENT")
    },
    authorizationDbReferencesPlugin: b("SEC_AUTHDB_REFERENCES_PLUGIN"),
    brokerDirectory: metadata("SEC_LOCK_DIR", "/tmp/com.openai.sky.CUAService"),
    brokerSocket: metadata(
      "SEC_LOCK_SOCKET",
      "/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock"
    ),
    brokerSocketWorldWritable:
      s("SEC_LOCK_SOCKET_MODE") === "666" || s("SEC_LOCK_SOCKET_MODE") === "777",
    worldWritableSocketReliesOnPeerIdentity: true,
    guardianFailClosedStringPresent: b("SEC_GUARDIAN_FAIL_CLOSED"),
    physicalInputRelockStringPresent: b("SEC_PHYSICAL_INPUT_RELOCK"),
    readyForLockedComputerUse: b("SEC_LOCKED_READY"),
    collectorDecision: b("SEC_LOCKED_READY") ? "observed_ready" : "fail_closed"
  },
  requirements: {
    schemaFieldObservedInInstalledCodex: b("SEC_REQUIREMENTS_SCHEMA_FIELD_OBSERVED"),
    systemRequirements: {
      path: "/etc/codex/requirements.toml",
      present: b("SEC_SYSTEM_REQUIREMENTS_PRESENT"),
      allowLockedComputerUse: s("SEC_SYSTEM_LOCKED_VALUE")
    },
    legacyManagedConfig: {
      path: "/etc/codex/managed_config.toml",
      present: b("SEC_LEGACY_REQUIREMENTS_PRESENT"),
      allowLockedComputerUse: s("SEC_LEGACY_LOCKED_VALUE")
    },
    effectiveAllowLockedComputerUse: s("SEC_LOCKED_EFFECTIVE"),
    effectiveRequirementsRpcQueried: b("SEC_EFFECTIVE_REQUIREMENTS_QUERIED"),
    collectorDecision:
      s("SEC_LOCKED_EFFECTIVE") === "true" ? "observed_enabled" : "fail_closed"
  },
  appApproval: {
    persistentStoreImplementationStringPresent: b("SEC_PERSISTENT_APPROVAL_STORE"),
    persistenceFailureStringPresent: b("SEC_PERSISTENT_APPROVAL_FAILURE"),
    approvalContentsCollected: false,
    securityInterpretation:
      "persistent_app_approval_is_not_content_trust_or_action_freshness"
  },
  freshness: {
    staleElementRefetchStringPresent: b("SEC_STALE_REFETCH"),
    ambiguousRefetchRejectedStringPresent: b("SEC_STALE_AMBIGUOUS_REJECT"),
    userInterventionRequiresReobserveStringPresent: b(
      "SEC_USER_INTERVENTION_REOBSERVE"
    ),
    coordinateRevisionBindingObserved: false,
    coordinateDecision: "fail_closed_without_fresh_observation"
  },
  trustedRoot: {
    codexHome: metadata("SEC_TRUST_ROOT", "<CODEX_HOME>"),
    plugins: metadata("SEC_TRUST_PLUGINS", "<CODEX_HOME>/plugins"),
    pluginCache: metadata("SEC_TRUST_CACHE", "<CODEX_HOME>/plugins/cache"),
    skills: metadata("SEC_TRUST_SKILLS", "<CODEX_HOME>/skills"),
    sameUserWriteRisk: true,
    contentsCollected: false
  },
  mockVsReal: {
    realBundleMetadataInspected: true,
    realTccMetadataInspected: true,
    realSocketMetadataInspected: true,
    realCuaRequestSent: false,
    realAxActionSent: false,
    realInputSynthesized: false,
    provesActionPathWorks: false
  },
  privacy: {
    rawUnifiedLogsCollected: false,
    promptBodiesCollected: false,
    toolArgumentsCollected: false,
    screenshotsCollected: false,
    appApprovalListCollected: false,
    configValuesCollectedApartFromExactBooleanRequirement: false
  }
};

fs.mkdirSync(path.dirname(out), { recursive: true });
const temporaryOut = path.join(
  path.dirname(out),
  `.${path.basename(out)}.${process.pid}.tmp`
);
fs.writeFileSync(temporaryOut, `${JSON.stringify(evidence, null, 2)}\n`, {
  mode: 0o600
});
fs.chmodSync(temporaryOut, 0o600);
fs.renameSync(temporaryOut, out);
process.stdout.write(
  `Wrote redacted security evidence to ${path.relative(process.cwd(), out)}\n`
);
process.stdout.write(
  `Lock-screen decision: ${evidence.lockScreen.collectorDecision}; ` +
    `CUA socket connected: ${evidence.safety.realCuaSocket.connected}\n`
);
NODE
