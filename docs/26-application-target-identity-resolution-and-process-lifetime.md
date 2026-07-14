# Application Target Identity, Resolution, And Process Lifetime

This chapter closes the `SystemSoftware.ApplicationTarget.identifier(for:)`
unknown and follows the result through target resolution, manager lookup, and
controller replacement.

## Fixed Sample

```text
binary:
  ~/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/
  SkyComputerUseService

version:
  26.710.1000387

UUID:
  9E40FA2F-FC6C-3EE2-824A-E4975CA022AD

SHA-256:
  27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58
```

The exported method is a trampoline:

```text
ApplicationTarget.identifier(for:)  0x1001e6624
  -> implementation body           0x1001e9128
```

## Exact Canonicalization

The body imports and calls:

```text
0x1001e919c -> URL.resolvingSymlinksInPath()
0x1001e91a8 -> URL.standardizedFileURL
0x1001e91c4 -> URL.path(percentEncoded: false)
0x1001e91e8 -> String.count
0x1001e9228 -> String.index(before:)
0x1001e9230 -> String.remove(at:)
0x1001e9264 -> String.hasSuffix(_:)
```

The GOT bindings prove the exact APIs:

```text
0x100EFE760 -> Foundation.URL.resolvingSymlinksInPath()
0x100EFE6D0 -> Foundation.URL.standardizedFileURL
0x100EFE798 -> Foundation.URL.path(percentEncoded:)
0x100F01478 -> Swift.String.count
0x100F01488 -> Swift.String.index(before:)
0x100F014D8 -> Swift.String.remove(at:)
0x100F01598 -> Swift.String.hasSuffix(_:)
```

Recovered Swift:

```swift
static func identifier(for bundleURL: URL) -> String {
    var value = bundleURL
        .resolvingSymlinksInPath()
        .standardizedFileURL
        .path(percentEncoded: false)

    while value.count > 1 && value.hasSuffix("/") {
        value.remove(at: value.index(before: value.endIndex))
    }
    return value
}
```

The identifier is not:

```text
bundle identifier
PID
hash
file:// absolute string
socket
conversation
thread
chat ID
```

It is a decoded, standardized, symlink-resolved filesystem path.

## Construction Is Eager

`ApplicationTarget.init(bundleIdentifier:bundleURL:)` at `0x1001e6544`:

1. stores the supplied bundle identifier;
2. resolves symlinks in the bundle URL;
3. standardizes the file URL;
4. stores the canonical URL;
5. calls `identifier(for:)`;
6. stores the resulting string in the struct.

The `identifier` getter at `0x1001e6508` only reads the cached field. It does
not recanonicalize the filesystem on every manager lookup.

Consequences:

- retargeting a symlink after target construction does not mutate the existing
  target's cached identifier;
- a newly resolved target can receive a different identifier after the
  filesystem changes;
- the manager key remains stable for the lifetime of that
  `ApplicationTarget` value.

The same canonicalizer is reused beyond the constructor:

| Callsite | Consumer |
|---|---|
| `0x1000547e8` | AppUsageCatalog running/installed application catalog |
| `0x100056b98` | AppUsageCatalog Spotlight `kMDItemPath` catalog |
| `0x100057edc` | AppUsageCatalog `.app` fallback |
| `0x1000a99f0` | ComputerUseUserInteractionMonitor target resolution |
| `0x1001e65e4` | ApplicationTarget initializer |
| `0x1001e6d1c` | `NSBundle(path:)` target construction |
| `0x1001e76c8` | running app URL identity comparison |
| `0x1001e7870` | running app target construction |

This keeps app discovery, user-interruption targeting, running-app matching,
and manager identity on the same canonical path semantics.

## Collision Matrix

The hermetic Swift probe creates only temporary paths and confirms:

| Input shape | Result |
|---|---|
| real app path | canonical real path |
| symlink alias | converges to real path |
| `.` / `..` segments | converge |
| `%20` in file URL | decoded space |
| trailing `/` | removed |
| filesystem root `/` | preserved |
| different installation path | remains distinct |
| case-variant spelling of an existing path on default APFS | may recover on-disk spelling |

The implementation does not explicitly lowercase. Case recovery in the probe
comes from Foundation resolving an existing path on the current
case-insensitive filesystem.

Fixture:

```text
fixtures/native/application-target-identifier-behavior.json
```

## NSWorkspace Target Resolution

The path-input constructor at `0x1001e6bcc` uses:

```text
NSBundle.init(path:)
  -> NSBundle.bundleIdentifier
  -> ApplicationTarget(bundleIdentifier:bundleURL:)
```

Installed applications are obtained through:

```text
NSWorkspace.URLsForApplicationsWithBundleIdentifier:
```

Running applications are obtained through:

```text
NSRunningApplication.runningApplicationsWithBundleIdentifier:
  -> each runningApplication.bundleURL
  -> ApplicationTarget
```

Candidate arrays are deduplicated with the canonical
`ApplicationTarget.identifier`, not only the bundle identifier.

Therefore:

- one physical app reachable through aliases becomes one target;
- two real copies at different canonical paths remain two targets even when
  their bundle identifiers are identical;
- installed and running discovery can converge on the same physical target.

## Fail-Closed Selection

The candidate resolver has three outcomes:

```text
0 candidates
  -> BundleIDLookupError.appNotFound

1 candidate
  -> return it

2 or more canonical candidates
  -> BundleIDLookupError.ambiguousBundleIdentifier
```

The ambiguity description is:

```text
Ambiguous app identifier '<input>'.
Multiple apps share this bundle identifier: <paths>.
Use an app name or full app path instead.
```

The implementation does not silently select the first installed copy.

`resolveApplicationTargetPreferringRunningApplication(for:)` changes only the
candidate priority:

```text
running candidates exist
  -> resolve within running candidates

no running candidates
  -> fall back to normal installed/path/name resolution
```

Multiple running copies still fail closed as ambiguous.

## Manager Identity

The service-global manager behaves as:

```text
ComputerUseAppInstanceManager.shared
  lock-protected Array<AppInstance>
    -> linear targetIdentifier lookup
    -> remove/replace same identifier
    -> append new instance
```

This means:

```text
symlink alias A
symlink alias B
real path
  -> same manager key
  -> same AppInstance
  -> same serial executor
  -> same AppController
  -> same lastAXTree

different physical copy with same bundle ID
  -> different manager key
  -> independent AppInstance and executor
```

The manager's state isolation follows canonical installation path, not product
identity.

## Live Process Boundary

The request slow path at `0x10013fbd8` resolves or creates an AppInstance.

For an existing manager entry:

```text
read existing AppInstance.appController
  -> read appController.runningApplication
  -> call isTerminated
```

If the process is alive:

```text
isTerminated == false
  -> return the existing instance
```

There is no controller setter call and no direct controller field replacement
on this branch.

If the process has terminated:

```text
clearUserInterruptedIntervention(target)
  -> remove old instance from manager
  -> deactivate/release old instance
  -> allocate new AppController
  -> allocate new AppInstance and SerialExecutor
  -> store controller once
  -> insert replacement into manager
```

Key addresses:

```text
existing manager lookup                 0x100140008
controller.runningApplication read      0x100140050
isTerminated selector call              0x10014006c
live instance return branch             0x100140070
terminated entry removal                0x1001400a8
new controller allocation               0x10014015c
new controller initialization           0x10014018c
new controller field store              0x100140234
new instance insertion                  0x100140258
```

## AX Baseline Lifetime

`lastAXTree` belongs to the AppController.

Conversation cleanup:

```text
deactivate existing instance
  -> controller remains
  -> lastAXTree remains
```

Target process termination:

```text
remove old instance
  -> old controller released
  -> new controller initialized with lastAXTree = nil
```

The precise lifetime is:

```text
canonical app path
  + current live NSRunningApplication process instance
```

It is broader than a conversation or socket, but narrower than an app install
across process restarts.

## Reproduction

```bash
cd codex-computer-use-lab

npm run collect:application-target-identifier-static
npm run collect:application-target-identifier-behavior
npm run collect:native-instance

node --test \
  tests/application-target-identifier.test.mjs \
  tests/native-app-instance-isolation.test.mjs
```

The probes:

- do not connect to the real Computer Use socket;
- do not synthesize input;
- do not attach a debugger to the running service;
- only read the signed binary and create temporary filesystem fixtures.

## Public Contract Versus Local Implementation

OpenAI's public Computer Use documentation states that Codex can see and
operate macOS and Windows GUIs, requires the Computer Use plugin, and on macOS
requires Screen Recording and Accessibility permissions:

- https://learn.chatgpt.com/docs/computer-use
- https://learn.chatgpt.com/use-cases/use-your-computer-with-codex

The public documentation does not promise:

- path-based native instance identity;
- symlink or percent-decoding behavior;
- bundle-ID ambiguity semantics;
- cross-conversation AX baseline reuse;
- controller replacement only after process termination.

Those are build-specific local implementation findings, not public API
contracts.
