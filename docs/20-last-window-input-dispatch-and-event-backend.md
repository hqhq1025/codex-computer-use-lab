# Last Window, Input Dispatch, And Event Backend

## Scope

This chapter fixes three native execution details for:

```text
SkyComputerUseService 26.710.1000387
UUID 9E40FA2F-FC6C-3EE2-824A-E4975CA022AD
SHA-256 27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58
```

1. the exact `lastWindow` state machine;
2. element versus coordinate input dispatch;
3. the final mouse and keyboard event backend.

All addresses are unslid arm64 virtual addresses. No process was attached and
no input event was executed.

## Reproduce LastWindow Xrefs

```bash
npm run collect:native-last-window
node --test tests/native-last-window.test.mjs
```

Fixture:

```text
fixtures/native/last-window.json
```

The collector parses the Mach-O `__TEXT,__text` section and decodes every ARM64
`BL imm26` instruction to enumerate direct getter and assignment-helper calls.

## LastWindow Storage

Controller initialization allocates a 60-byte lock object:

```text
0x10006c628  allocate
0x10006c62c  zero optional tuple payload
0x10006c638  store lock object at controller + 0x18
```

The value is:

```text
Optional<(UInt32 windowID, WindowUIElement window)>
```

Getter:

```text
0x10006bc64
```

Assignment helper:

```text
0x10006bdc0
```

The lock protects the full tuple from torn reads and retains the window before
unlocking.

## Exact Writes

The assignment helper has exactly three direct call sites:

```text
0x100070b68  business write
0x10007130c  business write
0x100088d34  compiler-generated setter closure thunk
```

Both business writes have the same source:

```text
focused UI context
  -> SkyshotOperation
  -> RefetchableSkyshotAXTree.systemSelection
  -> SystemSelection.applicationWindow
  -> applicationWindow.id + applicationWindow.axWindow
  -> lastWindow
```

The extraction ranges are:

```text
0x100070ab8-0x100070b14
0x10007125c-0x1000712b8
```

Therefore `lastWindow` means:

> the application window captured by the most recently completed successful
> Skyshot branch that reached the assignment.

It does not mean:

- most recently focused window notification;
- most recently interacted window;
- newest request by start time;
- currently onscreen window.

If two captures can overlap, writes are completion-order last-writer-wins. The
unfair lock provides tuple consistency, not request ordering.

## Retention And Staleness

The value starts as `nil`.

No confirmed path clears it on:

- focus changes;
- `AXWindowCreated`;
- window move or resize;
- minimize;
- window invalidation;
- controller activate or deactivate.

A failed later capture can leave the previous value intact. It may therefore
refer to a no-longer-focused, minimized, or invalid AX window.

## Reads

Direct getter call sites:

```text
0x100026f10  PiP interaction window ownership
0x100027360  PiP window stream publication
```

Coordinate click reads the same lock object directly instead of calling the
getter:

```text
0x10007fe20
ldr x20, [x20, #0x18]
```

The historical window is passed as auxiliary window/focus context after the
current mouse target has already been selected.

## OrderedWindows Is Deliberately Separate

`orderedWindows()`:

```text
0x100080e9c-0x100081194
```

It calls the `_windows` getter, then:

```text
0x100080ecc  option = 0x11
0x100080ed0  relativeToWindow = 0
0x100080ed4  CGWindowListCreate
```

It intersects current onscreen CoreGraphics z-order with the controller's AX
window cache.

It has:

```text
no direct call to lastWindow getter
no direct call to lastWindow assignment
no primary-window fallback
no full AXWindows rescan fallback
```

The semantic split is:

```text
orderedWindows
  current plural window set for coordinate hit testing

lastWindow
  historical single-window capture anchor for PiP and click assistance
```

Using `lastWindow` as a hit-test fallback would admit a stale or offscreen
window. That design rationale is an inference from the data flow, not a source
comment.

## Final Event Delivery

Regular action delivery is per target PID:

```text
SynthesizedEvent.send(to: pid, delay:)  0x10067d838
CGEventAPI.setTimestamp                 0x1001ddeec
CGEventAPI.postToPid                    0x1001ddd94
```

Call sites:

```text
first pass:
  0x10067d9c0 setTimestamp
  0x10067d9cc postToPid

after delayed resume:
  0x10067dcc0 setTimestamp
  0x10067dccc postToPid
```

Each event receives a fresh timestamp and is posted separately. If a non-empty
delay is configured, the delay is applied after each event, including the last
event.

The synchronous per-PID sender is:

```text
SynthesizedEvent.send(to:) 0x10067df00
```

The global sender:

```text
SynthesizedEvent.send(delay:) 0x10067f36c
CGEventAPI.post(event, tap: 1)
```

is a different path. Regular AppController mouse, scroll, keyboard, and
coordinate `sendClick` use per-PID delivery. The global variant is used by
separate recording/replay code paths.

## Soft-Linked Event API

`CGEventAPI` is resolved through a private soft-link table:

```text
initializer     0x1001dd088
table           0x100fae100
post slot       0x100fae158
postToPid slot  0x100fae160
timestamp slot  0x100fae180
source slot     0x100fae190
```

The resolver hashes symbol requests and scans system image export tries.
Therefore static analysis confirms the logical `postToPid` API but cannot
prove whether the current OS selected `_CGEventPostToPid` or a private
`_SLEventPostToPid` compatibility candidate.

## Mouse Construction

Key entries:

```text
SynthesizedEvent.click      0x10067d4d0
click/drag builder          0x10067f978
mouseEvent                  0x10067e4ec
moveMouse                   0x10067ea78
scroll                      0x10067e778
```

Mouse events are built through:

```text
[NSEvent mouseEventWithType:...]
  -> [NSEvent CGEvent]
```

Event type table:

| Button | Down | Up | Dragged |
|---|---:|---:|---:|
| left | 1 | 2 | 6 |
| right | 3 | 4 | 7 |
| other | 25 | 26 | 27 |

Sequences:

```text
click count N:
  [down(point), up(point)] repeated N times

drag:
  down(start)
  dragged(start)
  dragged(midpoint)
  dragged(end)
  up(end)

move:
  mouseMoved type 5
```

Scroll uses `CGEventAPI.createScrollWheelEvent` at `0x1001ddac8`.

Window-relative events also write a private WindowServer window-local location
through `WindowServerSPI.setWindowLocation` at `0x1001ed9c0`. That operation
does not deliver the event.

## Keyboard Construction

```text
type(string:)                 0x10067ecf0
pressKeys                     0x10067e378
pressKeysForHolding           0x10067f0b8
key expansion helper          0x10066f944
```

`type(string:)` first asks `SAIVirtualKeyPress` to map text to layout-aware key
descriptions. Each key press expands to:

```text
flagsChanged  type 12
keyDown       type 10
keyUp         type 11
flagsChanged  type 12
```

Key down and key up can both receive the same UTF-16 text through
`CGEventAPI.keyboardSetUnicodeString` at `0x1001ddd14`.

`SAIVirtualKeyPress` determines key code, modifiers, and string. Final
delivery remains per-PID CGEvent.

## Element Click Strategy

```text
UIElementProtocol.click  0x100710f6c
strategy body            0x100714c90
```

Priority:

1. A single left click that is not forced synthetic and passes the AX
   action/clickable gates can use AXPick or AXPress.
2. Otherwise the element strategy enters the synthetic event path.
3. If a virtual cursor exists, that path first awaits
   `VirtualCursor.press`.
4. The same path then builds synthetic events and sends them per PID.

The cursor is not a third event backend. It is an optional visual press before
the ordinary synthetic CG event.

Equivalent control flow:

```text
if left single click
   && !alwaysSimulateClick
   && AXPick/AXPress supported
   && clickable-point / hit-test gate passes:
    perform AXPick or AXPress
else:
    require clickable point
    if virtualCursor != nil:
        await virtualCursor.press()
    build SynthesizedEvent.click
    send(to: targetPID)
```

If `VirtualCursor.press` throws, the later CG event is not sent.

AX chain:

```text
UIElementProtocol.perform(action:)  0x1006ec854
AXUIElementRef.perform              0x10063d0ac
AXUIElementPerformAction stub       0x100cd2620
```

Element synthetic click does not reuse `ApplicationUIElement.sendClick`.

Coordinate click and drag do:

```text
ApplicationUIElement.sendClick  0x10063fca8
builders                        0x100640254 / 0x10064054c
per-PID send                    0x100640480 / 0x100640778
```

## OOP Web Content

Mouse:

```text
target(forMouseEventAt:)  0x10064727c
OOP rewrite               0x100647e84
```

Keyboard:

```text
targetForKeyboardEvent  0x100648204
OOP rewrite             0x100648410
```

For WKWebView or other out-of-process content, the final target PID may be
rewritten from the host application to the actual WebContent process.

`insideWebView` also influences synthetic activation but does not choose a
different input backend.

## Source PID Boundary

Events use:

```text
CGEventSourceCreate(stateID: 1)
```

which is the HID system state source.

The binary exposes source PID and target PID fields, but the action builders do
not call the source PID setter. There is no confirmed source-PID spoofing.

Static evidence cannot determine whether the OS later reports the service PID,
zero, or a private source identity.

No regular action path was found using:

- IOHID event creation/posting;
- Apple Events for input;
- a global cursor warp;
- global `CGEventPost` instead of per-PID delivery.

## Virtual Cursor Lifecycle

```text
createVirtualCursorIfNeeded        0x10006e970
deactivate continuation            0x100072770
ComputerUseCursor.orderOut         0x10008c980
ComputerUseCursor deinit           0x10008ae68
ComputerUseCursor.press            0x10008afb0
VirtualCursor.press default        0x1007208ac
synthetic continuation             0x1007172dc
```

The controller starts with `virtualCursor=nil`. Creation is lazy and
idempotent. Deactivate orders the cursor out but does not clear the field, so a
later action can reuse it. Controller deinit releases it.

Target-app instrumentation can distinguish AX action from synthetic CG, but
cannot distinguish synthetic CG with versus without a preceding virtual cursor
press. That narrower question requires a cursor-overlay witness or function
tracing outside the target app.
