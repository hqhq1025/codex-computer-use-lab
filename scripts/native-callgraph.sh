#!/usr/bin/env bash

set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/fixtures/native-callgraph"
DEFAULT_CANONICAL_APP="$HOME/.codex/computer-use/Codex Computer Use.app"
DEFAULT_BUNDLED_APP="/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app"
APP="${CUA_APP:-$DEFAULT_CANONICAL_APP}"

if [[ ! -d "$APP" && -d "$DEFAULT_BUNDLED_APP" ]]; then
  APP="$DEFAULT_BUNDLED_APP"
fi

BIN="${CUA_BINARY:-$APP/Contents/MacOS/SkyComputerUseService}"

while (($# > 0)); do
  case "$1" in
    --app)
      APP="${2:?--app requires a path}"
      BIN="$APP/Contents/MacOS/SkyComputerUseService"
      shift 2
      ;;
    --binary)
      BIN="${2:?--binary requires a path}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:?--out requires a path}"
      shift 2
      ;;
    --help)
      printf '%s\n' \
        "Usage: $0 [--app APP] [--binary BIN] [--out DIR]" \
        "" \
        "Read-only static extraction. LLDB creates a target but never runs or attaches."
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

for tool in awk cut dyld_info lldb nm otool paste plutil sed shasum sort xcrun; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'missing required tool: %s\n' "$tool" >&2
    exit 1
  }
done

LLVM_OBJDUMP="$(xcrun --find llvm-objdump)"
SWIFT_DEMANGLE="$(xcrun --find swift-demangle)"
DWARFDUMP="$(xcrun --find dwarfdump)"

[[ -f "$BIN" ]] || {
  printf 'SkyComputerUseService not found: %s\n' "$BIN" >&2
  exit 1
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/native-callgraph.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/out/disassembly"

nm -arch arm64 -n "$BIN" 2>/dev/null |
  awk '
    length($1) == 16 && $1 ~ /^[[:xdigit:]]+$/ && NF >= 3 {
      address=$1
      type=$2
      $1=$2=""
      sub(/^ +/, "", $0)
      sub(/^_/, "", $0)
      print address "\t" type "\t" $0
    }
  ' > "$TMP/nm.tsv"

cut -f3 "$TMP/nm.tsv" | "$SWIFT_DEMANGLE" --compact > "$TMP/demangled.txt"
paste "$TMP/nm.tsv" "$TMP/demangled.txt" > "$TMP/symbols.tsv"

"$LLVM_OBJDUMP" --macho --function-starts=both "$BIN" |
  awk 'length($1) == 16 && $1 ~ /^[[:xdigit:]]+$/ { print tolower($1) }' \
  > "$TMP/function-starts.txt"

otool -Iv "$BIN" > "$TMP/indirect-symbols.txt"
dyld_info -imports "$BIN" > "$TMP/imports.txt"

cat > "$TMP/specs.tsv" <<'EOF'
id	area	demangled_needle
ipc_request_dispatch	ipc-dispatch	ComputerUse.ExecutableComputerUseIPCRequest.handle() async throws -> A.Response
perform_action_request	action-dispatch	ComputerUseClient.ComputerUseIPCAppPerformActionRequest.handle(senderContext:
get_skyshot_request	skyshot-dispatch	ComputerUseClient.ComputerUseIPCAppGetSkyshotRequest.handle(senderContext:
skyshot_capture_ax_tree	ax-capture	ComputerUse.SkyshotOperation.captureAXTree(treeCache:
skyshot_capture_screenshot	screenshot-capture	ComputerUse.SkyshotOperation.captureScreenshot(imageSize:
wait_for_ui_to_settle	ui-settle	AccessibilitySupport.ApplicationUIElement.waitForUIToSettle(delay:
EOF

printf 'id\tarea\tentry\tentry_end\tentry_size_bytes\tasync\tmangled\tdemangled\n' \
  > "$TMP/out/functions.tsv"
printf 'caller_id\tsite\tkind\ttarget\ttarget_symbol\n' \
  > "$TMP/out/transfers.tsv"
printf 'workflow\trelation\tentry\tasync_pointer\tdemangled\tcaveat\n' \
  > "$TMP/out/related-async-targets.tsv"

declare -a LLDB_ARGS
LLDB_ARGS=(--batch -o "target create '$BIN'")

resolve_target() {
  local target="$1"
  local normalized address symbol

  if [[ ! "$target" =~ ^0x[[:xdigit:]]+$ ]]; then
    printf 'register:%s' "$target"
    return
  fi

  normalized="$(printf '%016x' "$((target))")"
  symbol="$(awk -F '\t' -v address="$normalized" '
    $1 == address && $4 !~ /^<redacted function/ {
      print $4
      exit
    }
  ' "$TMP/symbols.tsv")"
  if [[ -n "$symbol" ]]; then
    printf '%s' "$symbol"
    return
  fi

  address="0x$normalized"
  symbol="$(awk -v address="$address" '
    $1 == address && $2 != "LOCAL" {
      print $NF
      exit
    }
  ' "$TMP/indirect-symbols.txt")"
  if [[ -n "$symbol" ]]; then
    printf '%s' "$symbol"
    return
  fi

  if grep -Fq "$address LOCAL ABSOLUTE" "$TMP/indirect-symbols.txt"; then
    printf 'local-stub@%s' "$address"
  else
    printf 'anonymous-function@%s' "$address"
  fi
}

while IFS=$'\t' read -r id area needle; do
  [[ "$id" == "id" ]] && continue

  row="$(awk -F '\t' -v needle="$needle" '
    $2 == "T" && index($4, needle) {
      print
      count++
    }
    END {
      if (count != 1) exit 2
    }
  ' "$TMP/symbols.tsv")" || {
    printf 'expected exactly one symbol for %s (%s)\n' "$id" "$needle" >&2
    exit 1
  }

  IFS=$'\t' read -r start _type mangled demangled <<< "$row"
  end="$(awk -v start="$start" '
    found { print; exit }
    $1 == start { found=1 }
  ' "$TMP/function-starts.txt")"

  [[ -n "$end" ]] || {
    printf 'no next function boundary after %s at %s\n' "$id" "$start" >&2
    exit 1
  }

  size="$((16#$end - 16#$start))"
  printf '%s\t%s\t0x%s\t0x%s\t%d\ttrue\t%s\t%s\n' \
    "$id" "$area" "$start" "$end" "$size" "$mangled" "$demangled" \
    >> "$TMP/out/functions.tsv"

  "$LLVM_OBJDUMP" \
    --arch-name=arm64 \
    --no-symbolic-operands \
    --start-address="$((16#$start))" \
    --stop-address="$((16#$end))" \
    -d "$BIN" |
    awk '/^[[:space:]]*[[:xdigit:]]+:/ {
      sub(/^[[:space:]]*/, "")
      print
    }' > "$TMP/out/disassembly/$id.txt"

  first_address="$(awk -F ':' 'NR == 1 { print $1 }' "$TMP/out/disassembly/$id.txt")"
  first_address="$(printf '%016x' "$((16#$first_address))")"
  [[ "$first_address" == "$start" ]] || {
    printf 'disassembly for %s starts at %s, expected %s\n' \
      "$id" "$first_address" "$start" >&2
    exit 1
  }

  while IFS=$'\t' read -r site mnemonic target; do
    case "$mnemonic" in
      bl) kind="direct-bl" ;;
      b) kind="direct-tail-b" ;;
      br|blr) kind="indirect-branch" ;;
      *) continue ;;
    esac
    printf '%s\t0x%s\t%s\t%s\t%s\n' \
      "$id" "$site" "$kind" "$target" "$(resolve_target "$target")" \
      >> "$TMP/out/transfers.tsv"
  done < <(
    awk '
      $3 == "bl" || $3 == "b" || $3 == "br" || $3 == "blr" {
        sub(/:$/, "", $1)
        print $1 "\t" $3 "\t" $4
      }
    ' "$TMP/out/disassembly/$id.txt"
  )

  LLDB_ARGS+=(
    -o "image lookup -a 0x$start"
    -o "disassemble --start-address 0x$start --count 1"
  )
done < "$TMP/specs.tsv"

while IFS=$'\t' read -r workflow needle; do
  entry_row="$(awk -F '\t' -v needle="$needle" '
    $2 == "T" && index($4, needle) {
      print
      count++
    }
    END {
      if (count != 1) exit 2
    }
  ' "$TMP/symbols.tsv")" || {
    printf 'expected exactly one related target for %s (%s)\n' \
      "$workflow" "$needle" >&2
    exit 1
  }
  IFS=$'\t' read -r entry _type _mangled demangled <<< "$entry_row"
  pointer_row="$(awk -F '\t' -v needle="$needle" '
    $2 == "S" && $4 ~ /^async function pointer to / && index($4, needle) {
      print
      count++
    }
    END {
      if (count != 1) exit 2
    }
  ' "$TMP/symbols.tsv")" || {
    printf 'expected exactly one async pointer for %s (%s)\n' \
      "$workflow" "$needle" >&2
    exit 1
  }
  IFS=$'\t' read -r pointer _type _mangled _pointer_demangled <<< "$pointer_row"
  printf '%s\tcompiled-async-target\t0x%s\t0x%s\t%s\t%s\n' \
    "$workflow" "$entry" "$pointer" "$demangled" \
    "symbol presence only; not a direct edge from the bounded request entry" \
    >> "$TMP/out/related-async-targets.tsv"
done <<'EOF'
perform_action_request	ComputerUse.ComputerUseAppController.click(elementID:
get_skyshot_request	ComputerUse.ComputerUseAppController.updateSkyshot(treeCache:
EOF

lldb "${LLDB_ARGS[@]}" > "$TMP/lldb.txt" 2>&1
sed "s#${BIN//\#/\\#}#<SkyComputerUseService>#g" "$TMP/lldb.txt" \
  > "$TMP/out/lldb-entry-check.txt"

printf 'id\tentry\tlldb_instruction_observed\n' > "$TMP/out/lldb-entry-check.tsv"
while IFS=$'\t' read -r id _area entry _end _size _async _mangled _demangled; do
  [[ "$id" == "id" ]] && continue
  address="$(printf '%x' "$((entry))")"
  observed=false
  if grep -Fq "SkyComputerUseService[0x$address]" "$TMP/lldb.txt"; then
    observed=true
  fi
  printf '%s\t%s\t%s\n' "$id" "$entry" "$observed" \
    >> "$TMP/out/lldb-entry-check.tsv"
done < "$TMP/out/functions.tsv"

{
  printf 'source\taddress\tsymbol\n'
  awk '
    $1 == "0x0000000100cd400c" ||
    $1 == "0x0000000100cd409c" {
      print "otool-indirect\t" $1 "\t" $NF
    }
  ' "$TMP/indirect-symbols.txt"
  awk '
    /_swift_task_alloc|_swift_task_switch/ {
      print "dyld-import\timport-index:" $1 "\t" $2
    }
  ' "$TMP/imports.txt"
} > "$TMP/out/runtime-targets.tsv"

INFO="$APP/Contents/Info.plist"
VERSION="unknown"
BUILD="unknown"
BUNDLE_ID="unknown"
if [[ -r "$INFO" ]]; then
  VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$INFO" 2>/dev/null || printf unknown)"
  BUILD="$(plutil -extract CFBundleVersion raw -o - "$INFO" 2>/dev/null || printf unknown)"
  BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "$INFO" 2>/dev/null || printf unknown)"
fi

UUID="$("$DWARFDUMP" --uuid "$BIN" | awk 'NR == 1 { print $2 }')"
SHA256="$(shasum -a 256 "$BIN" | awk '{ print $1 }')"
CPU_TYPE="$(otool -hv "$BIN" | awk 'NR == 4 { print $2 }')"

{
  printf 'key\tvalue\n'
  printf 'artifact\tSkyComputerUseService\n'
  printf 'bundle_id\t%s\n' "$BUNDLE_ID"
  printf 'version\t%s\n' "$VERSION"
  printf 'build\t%s\n' "$BUILD"
  printf 'architecture\tarm64\n'
  printf 'mach_cpu_type\t%s\n' "$CPU_TYPE"
  printf 'uuid\t%s\n' "$UUID"
  printf 'sha256\t%s\n' "$SHA256"
  printf 'function_count\t6\n'
  printf 'scope\tentry-functions-only\n'
  printf 'process_started\tfalse\n'
  printf 'process_attached\tfalse\n'
} > "$TMP/out/metadata.tsv"

for pattern in \
  'ExecutableComputerUseIPCRequest.handle()' \
  'ComputerUseIPCAppPerformActionRequest.handle' \
  'ComputerUseIPCAppGetSkyshotRequest.handle' \
  'SkyshotOperation.captureAXTree' \
  'SkyshotOperation.captureScreenshot' \
  'ApplicationUIElement.waitForUIToSettle'; do
  grep -Fq "$pattern" "$TMP/out/functions.tsv" || {
    printf 'critical callgraph anchor missing: %s\n' "$pattern" >&2
    exit 1
  }
done

grep -Fq $'\t_swift_task_alloc' "$TMP/out/runtime-targets.tsv" || {
  printf 'swift_task_alloc import/stub anchor missing\n' >&2
  exit 1
}
grep -Fq $'\t_swift_task_switch' "$TMP/out/runtime-targets.tsv" || {
  printf 'swift_task_switch import/stub anchor missing\n' >&2
  exit 1
}
if grep -Evq $'^id\tentry\tlldb_instruction_observed$|^.*\ttrue$' \
  "$TMP/out/lldb-entry-check.tsv"; then
  printf 'LLDB failed to observe one or more entry instructions\n' >&2
  exit 1
fi

mkdir -p "$OUT_DIR/disassembly"
for file in functions.tsv transfers.tsv lldb-entry-check.txt \
  lldb-entry-check.tsv related-async-targets.tsv runtime-targets.tsv \
  metadata.tsv; do
  mv "$TMP/out/$file" "$OUT_DIR/$file"
done
for file in "$TMP/out/disassembly/"*.txt; do
  mv "$file" "$OUT_DIR/disassembly/$(basename "$file")"
done

printf 'generated 6 bounded function-entry fixtures in %s\n' "$OUT_DIR"
