# Codex App Computer Use 全链路逆向 V5

## 0. 本版定位

V5 在 V4 的 15 场景动态闭环上继续推进到：

- 标准多窗口；
- 真实跨显示器窗口往返；
- stale target 消失和 refetch 后歧义；
- 旧截图坐标命中 decoy；
- `@oai/sky 0.4.20` 全 mac JS / d.ts 审计；
- native element / coordinate / keyboard dispatch 分流；
- MCP event 1 MiB 截断导致 Desktop Computer Use 身份丢失。

所有真实动作仍只作用于：

```text
bundle id: com.openai.codex.cualab
```

未修改 TCC、Authorization Services、Locked Use、持久 approval 或其他 App。

## 1. 新动态结论

### 1.1 Multi-window

第二个标准 AppKit window 的 production 闭环：

```text
main window:
  screenshot 886 x 768

open secondary window
  get_app_state switches to focused secondary window
  screenshot 520 x 392
  element indices restart in that window

secondary button:
  element index 2
  click count 0 -> 1

secondary scroll:
  element index 3
  offset 0 -> 150

close secondary:
  element index 11
  get_app_state returns to main window
  screenshot 886 x 768
```

结论：

```text
get_app_state(app)
  = current focused window state
  != all app windows merged
```

element index 是当前返回window tree内的局部序号，不是app级稳定ID。

fixture：

```text
codex-computer-use-lab/fixtures/real-cua/
runner-multi-window-result-v2.json
```

### 1.2 Cross-display window movement

本机拓扑：

```text
primary: x=0
secondary left: x=-1920
```

每一步：

```text
fresh full get_app_state
  -> read current window frame
  -> read current screenshot dimensions
  -> scale AppKit local handle point to screenshot pixels
  -> one drag
  -> fresh full get_app_state
```

主窗口 X：

```text
447
 -> 166
 -> -115
 -> -396
 -> -677   secondary screen
 -> -397
 -> -117
 -> 163
 -> 443    primary screen
```

每次 screenshot：

```text
886 x 768
```

但 content hash 随窗口遮挡和跨屏位置显著变化。

fixture：

```text
runner-window-move-cross-display-result-v3.json
```

### 1.3 Coordinate mapping

真实窗口和截图并非 1:1：

```text
AppKit outer window: 1025 x 889 points
Sky screenshot:       886 x 768 pixels
```

正确换算：

```text
pixel.x = local.x * screenshot.width  / window.width
pixel.y = local.y * screenshot.height / window.height
```

不允许直接把 AppKit point 当截图pixel。

### 1.4 No screenshot revision binding

实验：

```text
fresh screenshot A
capture target coordinate = (426, 322)
swap target and decoy
do not call get_app_state
click old coordinate
```

结果：

```text
action executed = true
target count = 0
decoy count = 1
no stale/revision error
```

fresh observation B：

```text
new target coordinate = (701, 322)
target count = 1
```

结论：

```text
coordinate request has no screenshot revision token
service does not bind action to the screenshot that produced the coordinate
freshness is caller-enforced
```

fixture：

```text
runner-coordinate-stale-revision-result.json
```

## 2. Stale element 负向矩阵

### 2.1 Unique replacement

V4已确认：

```text
old index
  -> target replaced
  -> unique refetch
  -> replacement clicked
  -> decoy untouched
```

### 2.2 Target missing

时序：

```text
capture old target index 23
remove all matching targets
no re-observation
click old index
```

结果：

```text
SkyComputerUseError
code = -10005
message = The element ID is no longer valid...
action executed = false
target count = 0
decoy count = 0
```

### 2.3 Refetch ambiguous

时序：

```text
capture old target index 23
replace with two matching targets
no re-observation
click old index
```

结果：

```text
SkyComputerUseError
code = -10005
message = ...multiple elements were found that match the criteria...
action executed = false
target count = 0
decoy count = 0
```

结论：

```text
unique -> refetch and execute
none   -> fail closed
many   -> fail closed
```

但两个语义明确的 accessibility error都被外层映射为通用：

```text
unknownError -10005
```

不是 `accessibilityError -10008`。

fixtures：

```text
runner-stale-element-missing-result.json
runner-stale-element-ambiguous-result.json
```

## 3. Native input dispatch

固定 service：

```text
version 26.710.1000387
SHA-256 27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58
```

### 3.1 Element click

```text
PerformAction
  -> AppController.click(elementID)       0x1000747bc
  -> prepareToInteract                    0x100072880
  -> refetchElementIfNeeded(validate=true)0x1001b1eb0
  -> optional positionElement             0x100072fec
  -> UIElementProtocol.click thunk        0x100710f6c
  -> strategy body                        0x100714c90
```

AXPress候选被淘汰的条件：

```text
clickCount >= 2
mouseButton != left
alwaysSimulateClick == true
```

另需：

- element有合适AX action；
- clickable-point / hit-test gate通过。

AX执行：

```text
UIElementProtocol.perform(action:) 0x1006ec854
AXUIElementRef.perform              0x10063d0ac
_AXUIElementPerformAction          0x10063d224
```

virtual cursor非空时优先：

```text
VirtualCursor.press 0x1007208ac
```

### 3.2 Synthetic element click

AXPress不可用且无virtual cursor时：

```text
mouse target / OOP resolution
SyntheticAppFocusEnforcer.enforceActiveState 0x100673078
waitUntilAppBelievesItIsFrontmost            0x1006491a8
synthetic event dispatch
```

element click没有到 `ApplicationUIElement.sendClick` 的direct branch。

### 3.3 Coordinate click and drag

```text
AppController.click(at:andDragTo:) 0x10007f44c
  -> orderedWindows                0x100080e9c
  -> target(forMouseEventAt:)      0x10064727c
  -> sendClick                     0x10063fca8
```

drag仅通过非空 `andDragTo` 区分。

空window cache：

```text
noWindowsAvailable
```

`sendClick`消费：

- `insideWebView`；
- `clickingByCoordinate`；
- focus enforcer；
- OOP target；
- virtual cursor。

WebView coordinate存在单独activation分支。

### 3.4 Keyboard

```text
type_text:
  SynthesizedEvent.type      0x10067ecf0

press_key:
  SynthesizedEvent.pressKeys 0x10067e378

send:
  SynthesizedEvent.send      0x10067d838
```

press-key调用：

```text
targetForKeyboardEvent 0x100648204
```

可将实际接收者改写到OOP PID。

### 3.5 Settle

直接settle continuation：

```text
element click:    0x1000752bc / 0x100075b6c / 0x100075d24
coordinate/drag:  0x1000800e4
type:             0x100132bcc
press-key:        0x10013397c
```

`returnSkyshot=true`：

```text
wait approximately 0.25s
update Skyshot
```

否则：

```text
set needsUISettleBeforeSkyshot
next get_app_state performs settle-first
```

## 4. `@oai/sky 0.4.20` 修正

### 4.1 `list_apps`

V4的“每次operation先发policy”不准确。

`list_apps`：

```text
set codex/toolSurface with app = null
log tool telemetry
listApps request
no app policy
no elicitation
```

### 4.2 Two lazy layers

包根：

```text
sky Proxy first property access
  -> create facade
```

mac facade：

```text
first action
  -> lazy import internal client.js
```

Codex wrapper直接import mac `create_client.js`，绕过包根Proxy。

### 4.3 `create_client(options)` ignores options

公开facade忽略：

- apiVersion；
- timeoutSeconds；
- codexMetadata。

只有内部 `MacComputerUseClient`支持。

### 4.4 Policy snapshot is shallow

确认：

```text
top-level own string-key data properties copied
all accessors rejected
top-level snapshot frozen
inherited properties ignored
Symbol properties ignored
nested references retained and mutable
```

hermetic callback：

```text
topLevel before -> remains before
nested before -> becomes after
top-level frozen = true
nested frozen = false
```

### 4.5 Policy metadata ordering

`codex/toolSurface`在decision检查前设置。

因此：

```text
denied / forbidden
  -> action request not sent
  -> no elicitation
  -> result may still carry Computer Use app metadata
```

### 4.6 Transport

Frame：

```text
4-byte unsigned little-endian length
UTF-8 JSON
max payload = 8,388,608 bytes
```

Request queue：

```text
same transport strictly serial
timeout starts when request reaches dispatch
queue waiting is not counted
```

Timeout：

```text
reject local promise
no cancel frame
socket remains open
late server action/response may continue
next queued request dispatches
```

Disconnect：

```text
current request fails
transport removed
no automatic replay
next API call reconnects and re-pings
JSON-RPC id restarts
```

### 4.7 Metadata

Priority：

```text
request option
  > client option
  > nodeRepl.requestMeta["x-codex-turn-metadata"]
```

explicit `null` suppresses fallback。

metadata在actual dispatch时转换，排队期间对象仍可能变化。

### 4.8 App-specific instructions

```text
per client + app: injected once
subsequent states: omitted
com.apple.iWork.Numbers: always skipped
```

### 4.9 Runtime/type drift

`errors.d.ts`声明：

```text
formatOSStatus(status)
```

`errors.js`未实现、未导出。

## 5. Desktop UI 1 MiB identity loss

Desktop Computer Use source依赖：

```text
server == "node_repl"
result._meta["codex/toolSurface"].kind == "computerUse"
```

`item/started`没有result，因此只能在`item/completed` late bind。

Rust event copy cap：

```text
DEFAULT_OUTPUT_BYTES_CAP = 1,048,576
```

完整序列化：

```text
<= 1,048,576 bytes
  preserve content
  preserve structuredContent
  preserve _meta

> 1,048,576 bytes
  collapse to one text preview
  structuredContent = null
  _meta = null
  image structure lost
```

精确fixture：

```text
serialized bytes 1,048,576
  _meta retained
  Desktop source = computerUse

serialized bytes 1,048,577
  _meta cleared
  Desktop source = null
```

即使preview文本里包含`codex/toolSurface`字样，UI也不会从文本解析。

模型context截断是另一条边界：

```text
model truncation policy 10,000 tokens
effective approximately 12,000 tokens
```

它与UI event 1 MiB cap不是同一机制。

移动端`thread/resume`还会单独清洗MCP result/meta；实时completed不受该resume
redaction影响。

fixture：

```text
codex-computer-use-lab/fixtures/electron/mcp-event-truncation.json
```

## 6. 新增自动测试

```text
multi-window focused-state and per-window indices
cross-display fresh-coordinate movement
stale missing fail-closed
stale ambiguous fail-closed
stale coordinate decoy hit
Sky request timeout without cancel
Sky reconnect without replay
policy shallow snapshot
denied policy metadata ordering
app instructions once / Numbers skip
d.ts/runtime export parity
MCP event CAP / CAP+1 UI identity
```

## 7. Native Error Mapping

Server error enum：

```text
descriptor 0x100dc7910
field table 0x100e2c73c
rawValue 0x100b8effc
rawValue = -10000 - caseTag
```

Native `Error -> code/message`主switch：

```text
0x10015b01c
```

未匹配默认分支：

```text
0x10015b4e8-0x10015b508
tag 5
-10005 unknownError
```

### 7.1 Confirmed mapping

| Native error | IPC code |
|---|---:|
| `UIElementError.axError` | `-10008` |
| remaining `UIElementError` | `-10005` |
| all `RefetchableSkyshotAXTree.Error` | `-10005` |
| `invalidElementID` | `-10005` |
| `noWindowsAvailable` | `-10005` |
| `windowNotFound*` | `-10005` |
| `StageManager.Error.windowNotFound` | `-10005` |
| `AppController.noCapturableWindow` | `-10005` |
| `AppController.menuClickFailed` | `-10005` |
| OOP `EventTargetingError` | `-10005` |
| user intervention | `-10016` |
| ambiguous bundle lookup | `-10018` |
| lock `AccessError` | `-10020` |

`UIElementError` cases：

```text
axError
unexpectedAttributeValueType
failedToUnwrapAttributeValue
failedInit
failedToWrapAXValue
```

只有`axError`进入`accessibilityError -10008`。

Permission code修正：

```text
-10009 <- ComputerUseIPCPermissionResult.denied
-10014 <- ComputerUseIPCPermissionResult.pending
```

不能把它们固定归因到：

```text
SystemSettingsPrivacyPermissionError.requiresUserDragAndDrop
SystemSettingsPrivacyPermissionError.userCancelled
```

该 exception 类型不在主映射 switch 的特判集合中；若原样冒泡会落 `-10005`。

### 7.2 Refetch mapping

`RefetchableSkyshotAXTree.Error`：

```text
invalidElementID
noInvalidationMonitorProvided
elementAmbiguousBeforeRefetch
elementAmbiguousAfterRefetch
elementNoLongerValid
elementNoLongerValidAfterRefetch
```

全部落`-10005`。

message仍保留语义：

```text
ambiguous before -> refetch couldn't be started
ambiguous after  -> refetch couldn't be finished
missing          -> element ID is no longer valid
```

### 7.3 Lock mapping

```text
missingThreadID
suppressedUntilManualUnlock
unlockFailed
```

三者都映射`-10020`，但保留不同业务message。

### 7.4 JS and MCP

`@oai/sky/errors.js`只保存：

```text
code
reverse-mapped errorName
native message
request = null
requestType = "jsonRPC"
```

wrapper不catch或重新分类。

因此：

```text
specific stale/window failure
  -> precise message
  -> generic -10005 code
```

## 8. `_windows` Cache State Machine

### 8.1 Initial population

Controller：

```text
init entry  0x10006c470
init body   0x10006c54c
empty map   0x10006c8d0-0x10006c8ec
primaryWindow read 0x10006c958 -> 0x100656f0c
```

初始化只收集：

```text
primaryWindow
direct sheet children of primaryWindow
```

不会枚举全部独立`AXWindows`，也不调用`matchingCGWindow`。

primaryWindow为nil时cache保持空。

插入：

```text
AX windowID                  0x10063d8f8
_windows[windowID] mutator  0x1000843a8
update observedWindowIDs    0x10006cf20 -> 0x1006e448c
```

### 8.2 Notification population

固定application-level observer订阅：

```text
windowCreated
menuOpened
menuClosed
sheetCreated
windowMoved
windowResized
```

observer：

```text
construct 0x10006d35c-0x10006d4e4
handler   0x1000890f8 -> 0x10006d7d0
```

`windowCreated`和`sheetCreated`构造wrapper并插入cache。

因此第二个独立窗口：

```text
present before controller init
  -> may be absent from cache

created after observer active
  -> incrementally inserted
```

### 8.3 Lazy invalidation

`windows` getter：

```text
0x10006c45c -> 0x100084ce0
```

每次读取先调用过滤器：

```text
0x100083d74
```

逐项读取`WindowUIElementProtocol.windowID`。windowID为0的条目被删除；count变化
后原位替换map并重建observedWindowIDs。

明确失效模型：

```text
AX window invalidated
  -> cache entry remains
  -> next windows getter
  -> windowID == 0
  -> lazy removal
```

不是destroy notification立即删除。

### 8.4 Move, resize and minimize

`windowMoved`和`windowResized`：

```text
do not rediscover windows
do not AX/CG rematch
rebuild observedWindowIDs from current cache keys
```

Controller不订阅miniaturized/deminiaturized。

最小化通常不让AX windowID立即归零，因此cache项可保留；但
`orderedWindows()`只使用onscreen CG list，最小化窗口不会进入ordered结果。

### 8.5 `orderedWindows()`

```text
entry 0x100080e9c
windows getter          0x100080ec0
CGWindowListCreate(0x11,0) 0x100080ed4
CG windowID lookup      0x10008102c-0x100081038
return intersection     0x10008115c
```

它计算：

```text
live onscreen CG window order
  intersect
AX _windows cache by windowID
```

没有fallback：

-不回退`lastWindow`；
-不回退`primaryWindow`；
-不追加CG list之外的cache项；
-不执行全量AX window重扫。

### 8.6 Why state can succeed while input fails

`get_app_state`使用：

- FocusedUIElementContext；
- ApplicationWindow；
- Skyshot/capture；
- AX→CG matching。

bounded xref没有调用`windows getter`或`orderedWindows`。

所以可以同时成立：

```text
focused/main window available
AX tree available
screenshot available
CG ApplicationWindow available
_windows cache empty
orderedWindows empty
coordinate/scroll -> noWindowsAvailable
```

### 8.7 Dynamic confirmation

Multi-window fixture：

```text
secondary created after observer active
secondary button works
secondary scroll works
secondary close returns main window
```

这符合notification增量填充。

Generic AppKit accessibility包装破坏标准`AXWindows`时：

```text
get_app_state and element click can still work
scroll/coordinate window targeting fails
```

这符合capture链和cache链分离。

## 9. Guardian And Authorization Private Protocol

固定产物：

| Artifact | SHA-256 |
|---|---|
| Guardian | `d99b3d927b06677444a9b5de237e5470cb2289aa30676a21976ad8e32320c6bb` |
| Authorization Plugin | `8abcf8373e6f3b734f905ce0e351df6291aa289252b2409761b2edc9881093d9` |

### 9.1 Guardian transport

```text
service creates Mach bootstrap rendezvous
Guardian receives rendezvous name
Guardian creates anonymous NSXPCListener
Guardian sends NSXPCListenerEndpoint over Mach port
service connects to anonymous endpoint
```

没有named Guardian Unix socket。

### 9.2 Exact XPC interface

Service -> Guardian：

```text
beginUnlockGuard(threadID) -> Error?
completeUnlockGuard(threadID, didUnlock)
retainAutoUnlockedLease(threadID)
releaseAutoUnlockedLease(threadID)
```

Guardian -> Service：

```text
lockScreenGuardianDetectedPhysicalInput()
```

协议字段：

```text
threadID only
no turnID
no session ID
no nonce
no timestamp
no heartbeat
```

`beginUnlockGuard`是唯一带reply block的命令。

### 9.3 Lease and relock

Guardian维护：

- pending unlock thread IDs；
- auto-unlocked thread IDs；
- overlay assertion；
- relock settling assertion。

最后一个thread lease释放会主动relock，并保持overlay直到锁屏UI settle。

connection invalidation和physical input都进入fail-closed cleanup。

### 9.4 Physical input meaning

“physical input”静态判定实际是：

```text
event source PID != Guardian PID
```

这能排除Guardian自身合成事件，但不能证明事件来自真实硬件。其他进程合成的输入
也可能被归入physical input。

### 9.5 Per-display overlay

Overlay：

```text
one window per display
level = CGShieldingWindowLevel() + 1
observe display topology changes
```

这与公开“覆盖所有显示器”的产品行为一致，但overlay私有实现来自本地二进制。

### 9.6 Authorization broker

固定socket：

```text
/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock
```

协议不是JSON/protobuf，也没有request body。

Plugin：

```text
connect
verify server peer
read up to 15 bytes
first five bytes == "ALLOW" -> Allow
otherwise -> Deny
```

Service reply：

```text
ALLOW\n
DENY\n
```

active attempt是one-shot：

```text
consumed
revoked
timedOut
pending
```

### 9.7 Authentication asymmetry

Plugin验证service：

```text
LOCAL_PEERTOKEN
signing identifier = com.openai.sky.CUAService
Team ID = 2DC432GLL2
```

但broker accept端未观察到对client做：

- audit token；
- PID；
- signing ID；
- Team ID。

因此是单向认证。

潜在影响：

```text
arbitrary local process cannot impersonate the signed service to the Plugin
but may race to consume a pending one-shot attempt and cause denial of service
```

### 9.8 XPC peer-auth and Parent constraint

Guardian XPC依赖随机rendezvous、Mach send right和anonymous endpoint，具有
capability特征。专用accept path已经确认不读取audit token，不调用`SecCode*`、
`SkyIPCRequirement`或Team ID helper；它采用first-connection-wins。

`CUALockScreenGuardian_Parent.coderequirement`是合法的
`codesign --launch-constraint-parent`输入，不是XPC peer-auth配置。当前成品Guardian
签名未显示Parent Launch Constraint已嵌入，Mach-O也没有运行时loader证据。

因此当前边界是：

```text
NSTask direct child launch
random Mach rendezvous capability
anonymous NSXPC endpoint
first-connection-wins
no explicit peer identity check in accept path
```

完整报告：

```text
codex-computer-use-lab/docs/
17-lock-screen-guardian-authorization-private-protocol.md
```

## 10. 当前剩余硬问题

1. AXPress最终witness和event backend；
2. OOP WebView动态fixture；
3.多窗口重叠时coordinate target选择；
4.混合1x/2x真实跨屏动作；
5. service timeout后迟到action是否真实继续执行；
6. Guardian XPC显式peer-auth与Parent requirement用途；
7. Authorization broker抢先消费attempt的运行时可达性；
8. `lastWindow`全部写入点和精确语义；
9. windowCreated通知丢失后的完整cache重扫是否存在；
10. 解锁后20场景统一V5矩阵。

## 11. 当前验证状态

已完成：

```text
multi-window production fixture
cross-display production fixture
stale missing production fixture
stale ambiguous production fixture
coordinate stale-revision production fixture
V5 baseline: 119 / 119 tests
current lab after V6: 141 / 141 tests
unified reproduce completed
secret scan passed
```

统一V5矩阵尝试发生在用户会话锁定后：

```text
list_apps
  -> screenLocked / automatic unlock unavailable
  -> zero UI actions
  -> persistent approval store absent
```

证据：

```text
runner-final-semantic-matrix-v3-locked-attempt.json
```

该文件不是最终矩阵。最终文件名`runner-final-semantic-matrix-v3.json`保留给用户
手动解锁后的20场景同一binary/hash运行。

防休眠：

```text
launchctl job:
  com.openai.codex.cua-lab-caffeinate

program:
  /usr/bin/caffeinate -dimsu
```

它阻止自动显示器/系统/磁盘休眠，但不会绕过用户锁屏。
