# Native AX Diff, Refetch, And Instance Isolation

## Evidence boundary

This chapter combines three evidence classes:

1. exported Swift symbols and strings from the signed
   `SkyComputerUseService`;
2. bounded disassembly tied to service SHA-256
   `27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58`;
3. behavior mirrors in `lib/native-ax-behavior-model.mjs`.

The behavior mirror is executable documentation. It is not original service
source code.

## Revision IDs

Root revisions assign zero-based element IDs in depth-first order:

```text
R
|- A
`- B
   `- C

R=0, A=1, B=2, C=3
```

An appended revision first preserves IDs for structurally matched nodes, then
assigns new IDs starting at the current maximum plus one. It does not fill
holes and does not renumber a matched node because its sibling position moved.

Core addresses:

```text
setElementIDs                       0x100693920
nextAvailableElementIDIterator      0x100693bac
iterator next                       0x1006948d8
inheritElementID                    0x10069515c
root revision                       0x1006b9afc
appending revision                  0x1006b9270
```

## Render difference algorithm

Sibling identity is `UIElementRender.id`, not `elementID` and not visible
text. Matched nodes inherit the old `elementID`.

For a matched pair:

```text
old.text == new.text  -> none
old.text != new.text  -> update
```

`detailText` does not participate in that decision. Children are still diffed
when the parent is an update.

Change tags recovered from the binary:

```text
0 none
1 insert
2 update
3 remove
```

Changes sort by ascending index path. At an equal path the rank is:

```text
none < remove < insert < update
```

This means a replacement at one path renders remove before insert. Removed
element IDs are sorted and compressed into maximal consecutive ranges.

## Difference line budget

The budget is not a fixed threshold such as 100 or 1000 lines. It is the line
count of the current complete render tree.

The service checks:

1. whether the removed-ID summary alone exceeds the full-tree budget;
2. whether the complete diff exceeds the same budget.

Either condition returns the full tree. An empty effective change list emits
the no-change message instead of falling back to a full tree.

`eventStreamDescription(...ignoreDifferenceLineBudget:true)` bypasses the
budget.

## Stale element refetch

The refetch state machine is fail closed:

```text
element still valid
  -> return existing element

element invalid
  -> find equivalent candidate in old tree
     0 -> missing-before
     2+ -> elementAmbiguousBeforeRefetch
     1 -> refetch tree
          0 new matches -> elementNoLongerValidAfterRefetch
          2+ new matches -> elementAmbiguousAfterRefetch
          1 new match -> replace wrapper element and continue
```

The old-tree phase is strict. `ignoreValueChange=true` only relaxes the value
comparison in the after-refetch phase. It does not ignore role, title,
identifier, or candidate uniqueness, and it does not disable validity checks.

The recovered identity projection compares:

```text
role
subrole
roleDescription
title
description
value
valueDescription
placeholderValue
help
identifier
url
```

It does not use geometry, source path, element ID, or child position as the
identity proof.

## Reproduction

Static contract:

```bash
node scripts/native-ax-contract-probe.mjs \
  --out fixtures/native/ax-diff-refetch.json
```

Behavior vectors:

```bash
node --test tests/native-ax-diff-refetch.test.mjs
```

The test vectors cover root ID assignment, append ID preservation,
insert-before, sibling reorder, text versus detail-text changes, same-path
ordering, removed ranges, diff budget, no-change, and all stale refetch
outcomes.

## App-instance manager scope

The service owns one process-global
`ComputerUseAppInstanceManager.shared`. Its lookup key is
`SystemSoftware.ApplicationTarget.identifier`, derived from the application
target's bundle URL.

The underlying storage is a lock-protected `Array<ComputerUseAppInstance>`,
not a Swift dictionary. "Key" describes the lookup and uniqueness contract:
the manager linearly searches `targetIdentifier`, removes/replaces any
matching entry, and appends the new instance.

The key is not:

```text
PID
socket connection
node_repl process
thread
conversation
chatID
```

The consequence is that independent clients targeting the same application
target converge on one `ComputerUseAppInstance`, one app controller, one
per-instance serial executor, and strongly appear to share one `lastAXTree`
baseline. Different target identifiers receive independent executors and may
run concurrently.

Core addresses:

```text
ApplicationTarget.identifier        0x1001e6508
Manager.shared                      0x10009b964
Manager.instance(for:)              0x10009c1a4
Manager.setInstance                 0x10009c22c
Manager.removeInstance              0x10009a1e0
SerialExecutor enqueue body         0x10009b418
SerialExecutor unownedExecutor      0x10009b7c0
AppController.chatID                0x10006be34
AppController.lastAXTree get/set    0x10006c370 / 0x10006c3bc
```

`SerialExecutor.tail` is at offset `+0x70`. Operations for the same target
link behind that tail.

## Conversation lifecycle correction

The session tracker shape is:

```text
conversationID -> Set<targetIdentifier>
```

This map is a lifecycle index, not an ownership or reference-count table.
When a conversation ends, cleanup:

1. removes the conversation entry;
2. clears stopped-by-user state for each target;
3. asynchronously deactivates each shared app instance.

It does not call `removeInstance(for:)` and does not check whether another
conversation still references the same target. A second conversation can
therefore encounter a deactivate/reactivate boundary on a shared instance.

`lastAXTree` belongs to `ComputerUseAppController`. The normal deactivate path
does not clear it, and conversation cleanup does not delete the instance.
Static evidence and the cross-node_repl experiment therefore establish
cross-conversation diff-baseline reuse while the target process remains alive.

The controller replacement boundary is now recovered:

```text
manager lookup by canonical target identifier
  -> no instance
       -> create AppController
       -> create AppInstance
       -> insert into manager

  -> existing instance
       -> existing controller.runningApplication.isTerminated == false
            -> return the same AppInstance and controller

       -> existing controller.runningApplication.isTerminated == true
            -> clear intervention state
            -> remove old instance
            -> deactivate and release old controller
            -> create a new AppController and AppInstance
            -> insert the replacement
```

Important addresses:

```text
request instance resolution body        0x10013fbd8
existing instance lookup                0x100140008
runningApplication read                 0x100140050
isTerminated check                      0x10014006c
live-instance fast return               0x100140070
terminated-instance removal             0x1001400a8
new controller allocation               0x10014015c
new controller initialization           0x10014018c
new AppInstance controller store        0x100140234
new AppInstance manager insertion       0x100140258
```

The baseline lifetime is therefore:

```text
canonical ApplicationTarget.identifier
  + current live NSRunningApplication instance
```

Conversation end deactivates but preserves the controller and `lastAXTree`.
Actual app termination replaces the controller, so the new process starts
without the old controller's AX baseline.

## Cross-node_repl dynamic confirmation

V8 completed an observation-only experiment against only
`com.openai.codex.cualab`:

```text
Client A / Node kernel A
  -> disableDiff=true
  -> complete 2,891-character tree
  -> establish native lastAXTree

node_repl js_reset
  -> kernel A exits
  -> every JS binding and wrapper Symbol cache disappears

Client B / Node kernel B
  -> first call uses default diff
  -> no client-local full observation exists
  -> service returns native no-change diff
```

Phase B output:

```text
There has been no change in the accessibility tree for Window:
"Codex CUA Lab".
```

The Phase A in-memory marker was absent at Phase B start. Both phases created
their own wrapper runtime after a kernel reset, and every production call
confirmed that the persistent approval store remained absent.

This dynamically confirms that the native AX baseline survives a node_repl
kernel, JavaScript client, and transport boundary. The baseline cannot be a
client-local `Set`, wrapper Symbol cache, or `MacComputerUseClient` field.

Fixture:

```text
fixtures/real-cua/cross-client-baseline.json
```

Reproduction is intentionally two-phase:

```js
var experiment = await import(
  "/Users/haoqing/Documents/Learning/codex-computer-use-lab/scripts/real-cua-cross-client-baseline.mjs"
);
await experiment.runCrossClientPhaseA();
```

Then call `mcp__node_repl.js_reset`, and in the new kernel:

```js
var experiment = await import(
  "/Users/haoqing/Documents/Learning/codex-computer-use-lab/scripts/real-cua-cross-client-baseline.mjs"
);
await experiment.runCrossClientPhaseB();
```

The remaining debugger-only question is pointer-level confirmation that both
phases use the same exact `AppInstance`, controller, executor, and
`lastAXTree` objects. Static control flow now excludes a hidden production
controller replacement while the existing target process is still alive.

Static reproduction:

```bash
node scripts/native-app-instance-contract-probe.mjs \
  --out fixtures/native/app-instance-isolation.json

node --test tests/native-app-instance-isolation.test.mjs
node --test tests/cross-client-baseline.test.mjs
```
