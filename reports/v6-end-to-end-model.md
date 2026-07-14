# Codex App Computer Use 全链路逆向 V6

## 0. 结论先行

当前 macOS Codex Computer Use 不是 Responses API 的内建 `computer` tool。

它是下面这条组合链：

```text
Responses model
  -> deferred tool_search
  -> node_repl MCP: js(code, timeout_ms?, title?)
  -> trusted/untrusted Node VM boundary
  -> bundled computer-use wrapper
  -> @oai/sky JavaScript facade
  -> app policy + app-level elicitation
  -> trusted nativePipe bridge
  -> local length-prefixed JSON-RPC socket
  -> signed SkyComputerUseService
  -> AX + ScreenCaptureKit observation
  -> AXPress / per-PID CGEvent action
  -> result metadata reinjection
  -> Electron result-time Computer Use rendering
```

最重要的系统事实：

1. 模型只看到 `node_repl.js`，Computer Use 十个方法是 JS facade，不是十个 MCP
   tools。
2. 模型自己生成 JavaScript 和可选 `title`；Desktop 不解析 JS 来识别
   `click/scroll/type_text`。
3. app approval 是应用能力审批，不是单次动作审批。
4. policy、approval 和 action 是三个阶段，不是一个原子事务。
5. 同一个 Sky transport 每次只允许一个 native request in flight，但多个 client、
   connection、apiVersion 和 node_repl 进程可以独立排队。
6. observation 返回 focused/key window 的 AX tree 和 screenshot；多窗口不合并。
7. element index 是当前返回 tree 的局部编号，不是 app 级稳定 ID。
8. element action 有 stale refetch；coordinate action 没有 screenshot revision binding。
9. 常规 mouse/scroll/keyboard 最终逐事件投递到目标 PID，不是全局
   `CGEventPost`。
10. WKWebView/OOP content 可以把最终 target PID 改写为 WebContent 进程。
11. `codex/toolSurface` 在结果阶段才把普通 `node_repl` item 变成 Computer Use item。
12. MCP event 超过 1 MiB 会丢失 `_meta`；native Sky frame 上限则是 8 MiB。
13. Guardian XPC 是 capability + first-connection-wins，不是显式 peer code-sign auth。
14. `CUALockScreenGuardian_Parent.coderequirement` 是 parent launch constraint 输入，
    当前成品签名未嵌入，不是 XPC auth 配置。

## 1. 固定样本

### 1.1 Desktop

```text
Application:
  /Applications/ChatGPT.app

CFBundleShortVersionString:
  26.707.51957

CFBundleVersion:
  5175

app.asar SHA-256:
  26708d5be316b43786ba00ea8581317426e44ff508e0d5cce40f53181582e027

bundled codex SHA-256:
  69c5b16c3e2b0373ed97f3142bfc78c7d27b7b4e0209c2d1c1f528b03181c326

node_repl SHA-256:
  911b1e60ab9e217255a9d80ff67f2bc2db2920e1d03ab673a812cbcf429a363e
```

当前运行的 Codex desktop shell 位于 ChatGPT.app 内，不是
`/Applications/Codex.app`。

### 1.2 Computer Use plugin

```text
plugin:
  ~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387

manifest version:
  1.0.1000387

bundledContentVariant:
  node-repl

wrapper SHA-256:
  6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f
```

### 1.3 Sky JavaScript

```text
package:
  @oai/sky

version:
  0.4.20

root:
  /Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky
```

### 1.4 Native service

```text
canonical app:
  ~/.codex/computer-use/Codex Computer Use.app

version:
  26.710.1000387

build:
  1000387

bundle id:
  com.openai.sky.CUAService

UUID:
  9E40FA2F-FC6C-3EE2-824A-E4975CA022AD

SHA-256:
  27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58
```

### 1.5 Guardian

```text
Guardian SHA-256:
  d99b3d927b06677444a9b5de237e5470cb2289aa30676a21976ad8e32320c6bb

Authorization Plugin SHA-256:
  8abcf8373e6f3b734f905ce0e351df6291aa289252b2409761b2edc9881093d9

Parent constraint SHA-256:
  2be77c819c90048a61809348247598773dee2bce005bc246cdd99b2c0274235b
```

## 2. 安装与启动

### 2.1 Plugin variant materialization

Electron 将 bundled plugin 的 node-repl 说明复制为正式 skill：

```text
.codex-plugin/computer-use-node-repl.md
  -> skills/computer-use/SKILL.md
```

然后更新 cache manifest：

```json
{
  "bundledContentVariant": "node-repl"
}
```

当前启用的 plugin 不注册 direct Computer Use MCP tools。它依赖全局
`node_repl` MCP。

### 2.2 Canonical native app

Electron 从 plugin cache 中取 source service app，复制为：

```text
~/.codex/computer-use/Codex Computer Use.app
```

复制使用：

```text
ditto --noqtn
```

canonical、cache 和 source service executable 当前 hash 相同。

### 2.3 Service ownership

当前进程树：

```text
ChatGPT main
  |- bundled codex app-server
  |- SkyComputerUseService
      `- CUALockScreenGuardian
```

Electron main 是 app-server 和 native service 的直接父进程。Guardian 则由
Sky service 通过 `NSTask` 直接启动。

managed service controller 将操作串行化：

```text
pendingOperation = pendingOperation.then(operation, operation)
```

它按 `appshotsEnabled || nodeReplEnabled` 决定 service 是否需要存在，并验证已有 PID
是否仍指向预期 executable。

## 3. 模型输入

### 3.1 Responses request

本机已捕获的 request surface：

```text
has Responses computer tool:
  false

available deferred tool:
  tool_search

resolved tool:
  namespace mcp__node_repl
  function js
```

模型输入中包含普通：

```text
message
function_call
function_call_output
```

没有 Responses `computer_call` / `computer_call_output` 协议。

### 3.2 Deferred discovery

rollout 顺序：

```text
tool_search
  -> expose node_repl tools
  -> mcp__node_repl.js
```

Computer Use plugin skill 教模型在 `node_repl` 中加载 wrapper；它不是由 app-server
自动将 `sky` 注入每个 turn。

### 3.3 Current MCP schema

当前 `node_repl` surface：

```text
js(code, timeout_ms?, title?)
js_add_node_module_dir(path)
js_reset()
```

Computer Use facade：

```text
sky.list_apps
sky.get_app_state
sky.click
sky.drag
sky.perform_secondary_action
sky.press_key
sky.scroll
sky.select_text
sky.set_value
sky.type_text
```

这些只是 `js` 内的方法。

### 3.4 Legacy schema drift

禁用的 legacy `computer-use` server 仍有 direct tools，但不是当前 surface 的等价替代：

```text
legacy element_index: string
current JS element_index: number

legacy get_app_state:
  no disableDiff

legacy select_text:
  selection

current JS select_text:
  selection_type
```

Desktop 保留 legacy formatter 和 UI 兼容路径，不等于执行仍使用 legacy server。

## 4. Node REPL trust boundary

### 4.1 Two realms

node_repl 有：

```text
ordinary untrusted VM
trusted VM/module path
```

普通 cell 无法直接访问：

- `nativePipe`;
- `createElicitation`;
- `launchServices`;
- `withSuspendedTimeout`;
- authenticated fetch/config bridges.

### 4.2 Trusted import

当前：

```text
NODE_REPL_TRUSTED_CODE_PATHS=/Users/haoqing/.codex
```

wrapper 位于 trusted root 下，因此动态 import 后可以访问 trusted-only bridges。

trust 还有 active exec 约束。跨调用保存 helper 不代表可以在 tool call 结束后的异步
callback 中继续使用。

### 4.3 Wrapper resolution

wrapper 遍历：

```text
NODE_REPL_NODE_MODULE_DIRS
```

加载首个：

```text
@oai/sky/dist/project/cua/sky_js/src/targets/mac/create_client.js
```

验证仅为：

```text
typeof create_client == "function"
```

不验证 package version、hash 或签名来源。

当前 root 位于签名 app bundle 内，但 module root precedence 是 trusted config
boundary。

### 4.4 Runtime injection

wrapper 创建：

```js
const sky = Object.freeze(createClient({ target: "mac" }));
```

然后写：

```text
trusted Symbol.for("openai.computer-use.runtime")
trusted globalThis.sky
caller globals.sky
```

公开 `globalThis.sky` 可以被 untrusted code 覆盖，但再次 setup 会从 trusted realm
隐藏 symbol 恢复真实 client。

`js_reset` 清除当前 kernel state。

### 4.5 Direct Sky import

普通 cell 可以解析/import `@oai/sky`，但第一次使用会失败：

```text
Sky Computer Use requires the trusted nodeRepl runtime
```

import package 本身不等于获得 native pipe。

## 5. Wrapper policy and approval

### 5.1 Flow

app-specific action：

```text
validate and shallow-snapshot input
  -> getAppPolicy(app)
  -> set codex/toolSurface metadata
  -> reject denied/forbidden
  -> request app approval
  -> replace app with canonical app path
  -> withSuspendedTimeout(action)
```

`list_apps` 不走 app policy/approval，但先写：

```json
{
  "codex/toolSurface": {
    "kind": "computerUse",
    "app": null
  }
}
```

### 5.2 Input snapshot

wrapper：

1. 读取 own property descriptors；
2. 要求每个属性是 plain data property；
3. 拒绝 getter/accessor；
4. 复制 own string-key properties；
5. freeze top-level copy。

这是 shallow snapshot：

```text
top-level mutation blocked
nested references retained
symbol properties ignored
inherited properties ignored
```

### 5.3 Metadata timing

policy response 之后、decision switch 之前写：

```json
{
  "codex/toolSurface": {
    "kind": "computerUse",
    "app": {
      "kind": "appId",
      "appId": "<policy target bundle id>"
    }
  }
}
```

所以：

```text
input validation failure -> no app metadata
policy RPC failure       -> no app metadata
policy denied            -> app metadata can exist
policy forbidden         -> app metadata can exist
approval declined        -> app metadata exists
action failure           -> app metadata exists
```

### 5.4 Approval granularity

approval payload：

```text
connector_id = computer-use
connector_name = Computer Use
tool_params.app = bundle ID
display = app name
persist = session[, always]
riskLevel = policy risk
```

不显示：

- click/scroll/type 等 action；
- element index；
- coordinate；
- key；
- text/value；
- drag endpoint。

这是 app capability approval。

### 5.5 Post-approval validation

已 hermetic 验证：

```text
click({ app, x: NaN, y: 10 })

policy request   = 1
approval request = 1
metadata written = true
native action    = 0
failure          = coordinate validation
```

不少动作字段在批准后才由 `MacComputerUseClient` 检查。

### 5.6 Approval binding

```text
approval target:
  policy.target.bundleIdentifier

action wire target:
  policy.target.appPath
```

wire 中没有：

- policy nonce；
- approval revision；
- PID；
- code-sign digest；
- screenshot revision。

wrapper 在 approval wait 后不重新执行 policy。

### 5.7 Multi-app metadata

一个 `js` MCP result 只有一份 shallow-merged `_meta`。

同一 JS call：

```text
action App A -> meta A
action App B -> meta B
final MCP result -> meta B
```

每个 native wire target仍正确；Desktop 整体 attribution 是 last writer。

## 6. Sky JavaScript facade

### 6.1 Public and internal clients

public `create_client(options)` 忽略 options，返回十方法 facade。

内部 `MacComputerUseClient` 支持：

```text
apiVersion
codexMetadata
timeoutSeconds
startApp
```

这些不在 public facade。

### 6.2 Argument normalization

```text
element index -> decimal String
mouse button  -> 0 / 1 / 2
direction     -> up/down/left/right
coordinate   -> [Number(x), Number(y)]
undefined    -> omitted recursively
```

request union 示例：

```json
{
  "action": {
    "click": {
      "at": {
        "elementID": {
          "_0": "42"
        }
      },
      "clickCount": 1,
      "mouseButton": 0
    }
  }
}
```

coordinate：

```json
{
  "action": {
    "click": {
      "at": {
        "coordinate": {
          "_0": [120.5, 64]
        }
      },
      "clickCount": 1,
      "mouseButton": 0
    }
  }
}
```

### 6.3 App instructions

app-specific instructions 每 client/app 只注入一次。

```text
com.apple.iWork.Numbers
```

明确排除。

## 7. Native pipe

### 7.1 Endpoint

默认：

```text
~/Library/Group Containers/
  2DC432GLL2.com.openai.sky.CUAService/
  IPC/computeruse.sock
```

可由 trusted env：

```text
SKY_CUA_NATIVE_PIPE_PATH
```

覆盖。

### 7.2 Startup

首次快速 connect budget：

```text
250 ms
```

失败后通过：

```text
NODE_REPL_HOST_SERVICES_PIPE_PATH ensureService
```

或 LaunchServices 启动 service，然后以：

```text
5,000 ms
```

预算重连并 ping。

### 7.3 Framing

```text
uint32 little-endian payload length
UTF-8 JSON
```

最大 payload：

```text
8,388,608 bytes
```

超限在 encode/decode 两侧均拒绝。

### 7.4 JSON-RPC

```json
{
  "id": 2,
  "jsonrpc": "2.0",
  "method": "request",
  "params": {
    "clientApiVersion": "CodexComputerUseIPC-2",
    "codexTurnMetadata": {},
    "deadlineUnixMilliseconds": 0,
    "requestType": "ComputerUseIPCAppGetSkyshotRequest",
    "request": {}
  }
}
```

### 7.5 Client serialization

每个 transport：

```text
nextRequestID = 1
tail = Promise.resolve()
pending = Map
```

request：

```text
tail = tail.then(dispatch).then(settle, settle)
```

所以单 transport：

```text
max in flight = 1
```

public 方法即使同时 `Promise.all`，native request仍顺序发出。

### 7.6 Transaction interleaving

queue 只覆盖单次 native dispatch，不覆盖：

```text
policy -> approval wait -> action
```

因此两个高层调用可以：

```text
A policy
B policy
B approval
B action
A approval
A action
```

### 7.7 Timeout

timeout 从实际 dispatch 开始，不包含：

- 前面 request 排队；
- service startup；
- approval wait。

timeout 后：

```text
delete pending resolver
reject local promise
do not send cancel
do not close socket
dispatch next queued request
```

late response 由于 pending ID已删除而被忽略。

### 7.8 Reconnect

连接失败：

```text
current request fails
no replay
remove transport from cache
next API call reconnects and pings
```

新 transport 的 ID 从 ping `1`、request `2` 重启。

### 7.9 ID boundary

request ID 是 JavaScript number，持续递增，没有：

```text
Number.isSafeInteger
wrap
collision guard
```

`2^53` 附近理论上会失去唯一性，现实概率极低。

### 7.10 Native server socket concurrency

native connection object：

```text
instance size = 0x50
maximumFrameSize = 8 MiB
ioTimeout = 30s
```

常规 initializer已删除，accept loop在：

```text
0x100151f78-0x100151ffc
```

内联构造。

每条连接：

```text
read with 30s timeout
  -> await processFrame
  -> write with 30s timeout
  -> repeat
```

单连接严格串行，不并行处理 pipelined frames。

每个 accepted connection有独立 Swift task，最多：

```text
16 concurrent connections
```

因此：

```text
one JS transport -> one in-flight
multiple transports/connections -> native processFrame may run concurrently
```

入站 `> 8 MiB`：

```text
read header
reject before body
no JSON-RPC error
close
```

handler response `> 8 MiB`：

```text
-32002
Response exceeds maximum frame size
```

## 8. Native request dispatch

入口：

```text
ExecutableComputerUseIPCRequest.handle
  0x10013f9e4
```

perform action：

```text
ComputerUseIPCAppPerformActionRequest.handle
  0x10012df9c
```

get state：

```text
ComputerUseIPCAppGetSkyshotRequest.handle
  0x100136904
```

native server 完成：

- sender identity；
- request decode；
- API version；
- system permissions；
- app policy/session；
- URL policy；
- action dispatch；
- error mapping。

## 9. Observation pipeline

### 9.1 get_app_state

```text
resolve/start app session
  -> settle if previous action marked dirty
  -> focused UI context
  -> AX extraction
  -> optional tree diff
  -> optional screenshot
  -> app URL/context
  -> attachment
```

settle-first：

```text
updateSkyshotSettlingIfNeeded
  if needsUISettleBeforeSkyshot
    waitForUIToSettle(delay: 0.25)
  updateSkyshot
```

### 9.2 Current focused window

production multi-window：

```text
get_app_state(app)
  = current focused/key window
  != all app windows merged
```

第二窗口：

```text
screenshot 520 x 392
element index restarts
```

关闭后回到主窗口：

```text
screenshot 886 x 768
```

### 9.3 AX diff

diff baseline 在 native：

```text
ComputerUseAppController.lastAXTree
```

不是 JS client local cache。

AX diff 可以显示 no change，但业务 oracle 已变化。不能只靠 diff 文本判断动作是否成功。

### 9.4 Element IDs

每次 tree render 使用 iterator 分配 element IDs。

index：

- tree-local；
- window-local；
- observation-local；
- 可因 sibling 插入而整体偏移。

它不是长期 handle。

### 9.5 Stale refetch

旧 element 失效后：

```text
old tree identity
  -> invalidation monitor
  -> fresh tree
  -> equivalent matching
```

结果：

```text
unique -> use replacement
none   -> fail closed
many   -> fail closed
```

missing 和 ambiguous 最终都为：

```text
-10005
```

但 message保留语义。

### 9.6 Screenshot

截图：

```text
ScreenCaptureKit / SCScreenshotManager
JPEG temporary file
file:// URL returned to JS
```

JS result没有：

- screenshot ID；
- revision；
- size；
- MIME field。

旧 screenshot 文件跨后续 capture 保留；app session 结束后清理。

本机实测 mode：

```text
0644
```

但目录位于用户私有 temp hierarchy。

## 10. Coordinate model

### 10.1 Spaces

至少有：

1. AppKit global points；
2. AX/CoreGraphics global points；
3. display/window-local points；
4. screenshot pixels。

### 10.2 Scaling

实测：

```text
AppKit outer window:
  1025 x 889 points

Sky screenshot:
  886 x 768 pixels
```

换算：

```text
pixel.x = local.x * screenshot.width  / window.width
pixel.y = local.y * screenshot.height / window.height
```

### 10.3 Cross display

本机：

```text
primary x = 0
left secondary x = -1920
```

fresh-observe + scaled drag 轨迹：

```text
447 -> 166 -> -115 -> -396 -> -677
-397 -> -117 -> 163 -> 443
```

### 10.4 No revision binding

coordinate request只含：

```text
x
y
```

没有：

- screenshot revision；
- screenshot path/hash；
- window ID；
- tree revision。

旧 screenshot coordinate 在布局交换后会点击当前位置的新对象。

freshness 完全由调用方通过重新观察保证。

## 11. Window state

### 11.1 `_windows`

初始化：

```text
empty
  -> primary window
  -> direct sheet children
```

不全量扫描所有 independent AXWindows。

后续窗口依赖：

```text
AXWindowCreated notification
```

增量加入。

失效 entry 在 windows getter 读取 `windowID == 0` 时懒删除。

### 11.2 orderedWindows

```text
_windows cache
  intersect
CGWindowListCreate(option=0x11, relative=0)
```

按当前 onscreen z-order 排序。

没有：

- lastWindow fallback；
- primaryWindow fallback；
- full rescan fallback。

所以可以同时：

```text
AX tree succeeds
screenshot succeeds
coordinate/scroll fails noWindowsAvailable
```

### 11.3 lastWindow

`lastWindow` 是：

```text
Optional<(windowID, WindowUIElement)>
```

锁对象位于 controller `+0x18`。

只有两个业务写入点：

```text
0x100070b68
0x10007130c
```

来源：

```text
completed Skyshot SystemSelection.applicationWindow
```

不是 focus/window notification。

它不会因失焦、move、resize、minimize、invalidate而清空，可能 stale。

getter direct calls：

```text
0x100026f10 PiP
0x100027360 PiP
```

coordinate click在：

```text
0x10007fe20
```

直接读取 lock object，将其作为已经选定 target 后的辅助 window/focus context。

## 12. Element action dispatch

### 12.1 prepare

```text
prepareToInteract
  -> refetchElementIfNeeded(validate=true)
  -> optional positionElement
```

### 12.2 Click strategy

```text
UIElementProtocol.click 0x100710f6c
strategy body           0x100714c90
```

优先级：

1. 单次左键、非 always-simulate、AX gate成立 -> AXPress；
2. 有 virtual cursor -> `VirtualCursor.press`；
3. 否则 element strategy 自己构造 synthetic event并per-PID发送。

AX：

```text
UIElementProtocol.perform(action:)
  -> AXUIElementRef.perform
  -> AXUIElementPerformAction
```

双击、非左键、强制 simulate 会淘汰 AXPress。

### 12.3 Coordinate

coordinate click/drag：

```text
orderedWindows
  -> target(forMouseEventAt)
  -> optional OOP rewrite
  -> sendClick
```

element synthetic 不复用 `sendClick`；coordinate 明确使用。

### 12.4 Scroll

scroll by element：

```text
element frame/clickable point
  -> amount =
     round(pages * max(axis element size, 100))
  -> optional moveMouse
  -> AppController.scroll
```

底层：

```text
orderedWindows
  -> target(forMouseEventAt)
  -> SynthesizedEvent.scroll
  -> per-PID send
```

### 12.5 Keyboard

keyboard action直接构造 `SynthesizedEvent`，不使用 AXPress。

`type(string:)` 先由 `SAIVirtualKeyPress` 按当前 layout生成 key code、modifier、
string。

## 13. Final event backend

### 13.1 Per-PID

常规 action：

```text
SynthesizedEvent.send(to: pid, delay:)
  0x10067d838

CGEventAPI.setTimestamp
  0x1001ddeec

CGEventAPI.postToPid
  0x1001ddd94
```

每个 event：

1. 重新取 timestamp；
2. set timestamp；
3. post to target PID；
4. optional delay。

### 13.2 Mouse

事件表：

| button | down | up | dragged |
|---|---:|---:|---:|
| left | 1 | 2 | 6 |
| right | 3 | 4 | 7 |
| other | 25 | 26 | 27 |

click：

```text
[down, up] x clickCount
```

drag：

```text
down(start)
dragged(start)
dragged(midpoint)
dragged(end)
up(end)
```

move：

```text
type 5
```

### 13.3 Keyboard

每个 logical key：

```text
flagsChanged 12
keyDown      10
keyUp        11
flagsChanged 12
```

down/up 可以写同一 UTF-16 string。

### 13.4 OOP

mouse target：

```text
target(forMouseEventAt)
  -> outOfProcessTargetWindow
```

keyboard target：

```text
targetForKeyboardEvent
  -> outOfProcessTarget
```

最终 PID可以是 WebContent，而非 host app PID。

### 13.5 Soft-link

CG event API通过 private soft-link table解析。逻辑函数已恢复为：

```text
post
postToPid
setTimestamp
sourceCreate
```

但纯静态不能区分当前 OS最终选择 public `_CGEventPostToPid` 还是 private
compatibility candidate。

### 13.6 Source PID

event source：

```text
CGEventSourceCreate(stateID: 1)
```

action path没有显式调用 source PID setter。

不能静态断言 OS最终暴露：

- service PID；
- zero；
- private source identity。

## 14. Error mapping

### 14.1 Main switch

```text
0x10015b01c
```

default：

```text
0x10015b4e8-0x10015b508
-> -10005
```

### 14.2 Specific

```text
UIElementError.axError -> -10008
other UIElementError   -> -10005

Refetchable errors     -> -10005
noWindowsAvailable     -> -10005
windowNotFound         -> -10005
noCapturableWindow     -> -10005
menuClickFailed        -> -10005
OOP target errors      -> -10005

userIntervened         -> -10016
ambiguousApp           -> -10018
lock AccessError       -> -10020
```

### 14.3 Permission correction

```text
-10009 <- ComputerUseIPCPermissionResult.denied
-10014 <- ComputerUseIPCPermissionResult.pending
```

不能固定归因：

```text
requiresUserDragAndDrop -> -10014
userCancelled           -> -10009
```

`SystemSettingsPrivacyPermissionError` 本身不在主 switch 特判集合；原样冒泡会
default `-10005`。

## 15. Desktop result rendering

### 15.1 Three identities

```text
invocation:
  server + tool + args

result source:
  result._meta["codex/toolSurface"]

layout:
  groupable / standalone
```

started 时没有 result meta。

completed 后同一 item 被完整替换，source和layout可变化。

### 15.2 Node REPL title

renderer：

```text
if normalized tool == js:
  read arguments.title
  normalize whitespace
  truncate to 80 chars
  return immediately
```

不读取：

- `code`；
- result；
- structuredContent；
- toolSurface。

所以标题是 model-declared metadata，不是 action witness。

### 15.3 Direct formatter

legacy/direct formatter：

```text
ySt -> FSt[toolKey]
```

只对显式：

```text
click
scroll
type_text
...
```

生效。

`node_repl/js` 即使 result source 是 Computer Use，tool key仍是 `js`。

### 15.4 Failed but "Clicked"

Desktop `completed` 表示：

```text
not inProgress
```

不表示 success。

direct formatter不看 result type，所以 direct click failure可以显示：

```text
Clicked in Finder
```

错误只在 expanded content。

### 15.5 1 MiB metadata loss

app-server event copy：

```text
serialized result <= 1,048,576 bytes
  retain structuredContent/meta

serialized result > 1,048,576 bytes
  content = serialized preview
  structuredContent = null
  meta = null
```

因此大结果失去 Computer Use identity。

### 15.6 Model reinjection

给模型：

```text
structuredContent present
  -> JSON stringify structuredContent

otherwise:
  -> serialize content
```

top-level：

```text
_meta
isError
```

不进入 FunctionCallOutput body；`isError`只影响 success bit。

### 15.7 Progress

协议有：

```text
item/mcpToolCall/progress
```

但：

```text
RMCP on_progress -> log only
Electron handler -> explicitly ignore
```

当前 progress 是双重黑洞。

### 15.8 Elicitation correlation

elicitation request没有 tool item ID。

pending suppression key：

```text
generic/form/url -> serverName
mcpToolCall      -> connector_id
connectorAuth    -> connector_id
```

direct `computer-use` 同 server并发时，一个 pending elicitation可以隐藏多个未完成 call。

当前 `node_repl` invocation server是 `node_repl`，而 connector ID是
`computer-use`，因此不会被该 exact filter隐藏。

## 16. Guardian

### 16.1 Launch

service：

```text
NSTask
  executable = nested Guardian
  argv = random rendezvous name
```

不是 Apple-event bootstrap。

### 16.2 Endpoint

Guardian：

```text
anonymous NSXPCListener
  -> raw listener endpoint
  -> send endpoint through Mach rendezvous
```

service：

```text
receive endpoint
  -> NSXPCConnection(initWithEndpoint:)
```

### 16.3 Protocol

service -> Guardian：

```text
beginUnlockGuard(threadID) -> Error?
completeUnlockGuard(threadID, didUnlock)
retainAutoUnlockedLease(threadID)
releaseAutoUnlockedLease(threadID)
```

Guardian -> service：

```text
lockScreenGuardianDetectedPhysicalInput()
```

只有 thread ID：

```text
no turn ID
no nonce
no heartbeat
no timestamp
```

### 16.4 Accept

Guardian accept path：

```text
no current connection -> accept first
existing connection    -> reject
```

配置 interface、handlers、activate、保存 connection。

没有：

- audit token read；
- `SecCode*`；
- Team ID；
- `SkyIPCRequirement`。

边界是：

```text
random Mach capability
anonymous endpoint
first-connection-wins
```

不是显式 peer identity authentication。

### 16.5 Parent constraint

resource：

```text
CUALockScreenGuardian_Parent.coderequirement
```

是合法：

```text
codesign --launch-constraint-parent
```

plist。

当前 Guardian签名没有：

```text
Has Parent Launch Constraints
```

Mach-O也没有 runtime loader evidence。

它：

- 不是 XPC auth；
- 不是 Apple-event auth；
- 如果正确嵌入，应在 parent exec/launch阶段生效；
- 当前成品没有证据表明已嵌入。

### 16.6 Lease

最后一个 auto-unlocked thread lease释放：

```text
relock
keep overlay until lock UI settles
```

connection loss和physical input也 fail closed。

### 16.7 Physical input

判定：

```text
event source PID != Guardian PID
```

不等于硬件来源证明。其他进程 synthetic input也可能被归类为 physical。

## 17. Authorization broker

socket：

```text
/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock
```

request body：

```text
none
```

reply：

```text
ALLOW\n
DENY\n
```

plugin验证 service：

```text
LOCAL_PEERTOKEN
signing ID = com.openai.sky.CUAService
Team ID = 2DC432GLL2
```

service accept端未证实验证 client。

attempt：

```text
one active
one shot
consumed/revoked/timedOut/pending
```

潜在面是抢先消费导致 DoS，不是任意进程获得 unlock。

## 18. Security model

### 18.1 Strong gates

- trusted Node bridge；
- native sender auth；
- app policy；
- app approval；
- TCC；
- active observed session；
- URL policy；
- intervention detection；
- stale element uniqueness；
- lock screen policy；
- per-PID target selection。

### 18.2 High-risk trust roots

```text
NODE_REPL_TRUSTED_CODE_PATHS=~/.codex
```

是宽 path trust。

任何被 predicate接受并 import 的 module 都应视为 privileged。

### 18.3 Sky supply chain

wrapper不pin Sky hash，使用首个 module root。

native pipe override只做 API version ping，不做 JS层 peer signature验证。

### 18.4 Approval

approval粒度是 app，不是 action。

persistent approval意味着后续可以在该 app上执行多种 action，不再展示每次 payload。

### 18.5 Freshness

element freshness有 native identity/refetch。

coordinate freshness没有 protocol token。

### 18.6 UI audit

title可以由模型声明。

multi-app result attribution是last writer。

large MCP result会丢失 Computer Use identity。

direct failure可能显示success-sounding completed label。

## 19. Reimplementation blueprint

要独立复现当前架构，不需要复制所有私有实现。最小兼容实现可分七层。

### 19.1 Model surface

提供 MCP：

```text
js(code, timeout_ms?, title?)
```

系统 prompt/skill 告诉模型：

```js
await setupComputerUseRuntime({ globals: globalThis });
await sky.get_app_state({ app: "..." });
await sky.click({ app: "...", element_index: 1 });
```

### 19.2 Trusted runtime

必须把：

- arbitrary model JS；
- privileged pipe/approval/launch bridges；

隔离为两个 realm。

推荐：

```text
untrusted VM
trusted signed wrapper
active-exec capability token
exact trusted module allowlist
```

不要用整个用户可写目录作为 trusted root。

### 19.3 Wrapper

伪代码：

```js
async function withComputerUsePolicy(toolName, input, action) {
  const snapshot = copyPlainOwnDataProperties(input);
  const policy = await native.getAppPolicy(snapshot.app);

  setResultMeta({
    "codex/toolSurface": {
      kind: "computerUse",
      app: { kind: "appId", appId: policy.target.bundleIdentifier }
    }
  });

  if (policy.decision !== "allowed") throw policyError(policy);

  await approveApp({
    bundleIdentifier: policy.target.bundleIdentifier,
    displayName: policy.target.displayName,
    persistence: policy.allowPersistentApproval
      ? ["session", "always"]
      : ["session"]
  });

  return action({
    ...snapshot,
    app: policy.target.appPath
  });
}
```

改进版应：

- approval UI显示 action摘要；
- action前重查 policy/target identity；
- result meta支持 operation list而不是last-writer单 app。

### 19.4 Pipe

兼容 wire：

```text
uint32le length
JSON-RPC 2.0
8 MiB cap
ping
request
```

建议额外：

- peer credential/code-sign auth；
- cancellation；
- bounded integer ID wrap；
- per-request nonce；
- transaction ID；
- screenshot/tree revision。

### 19.5 Native service

核心对象：

```text
AppInstanceManager
  target identity -> AppInstance

AppInstance
  serial executor
  AppController
  URL/session state

AppController
  AX app
  window cache
  lastAXTree
  lastWindow
  screenshot files
  focus enforcer
  virtual cursor
```

### 19.6 Observation

输出：

```json
{
  "app": {
    "bundleIdentifier": "...",
    "pid": 123
  },
  "skyshot": {
    "text": "...",
    "screenshot": {
      "url": "file:///..."
    }
  }
}
```

复现 stale refetch 需要保存：

- tree revision；
- element identity descriptors；
- invalidation monitor；
- equivalent matching；
- uniqueness rejection。

改进协议应直接返回：

```text
observationRevision
windowID
screenshot pixel size
coordinateTransform
```

### 19.7 Input

element：

```text
prefer AXPress for simple single left click
otherwise synthesize
```

coordinate：

```text
current onscreen windows
hit test
OOP PID rewrite
per-PID event post
```

mouse sequence和keyboard sequence见第13章。

### 19.8 UI

started item：

```text
ordinary node_repl
```

completed item：

```text
parse result meta
attach Computer Use source
render native app identity
```

改进版应：

- title区分 declared与observed；
- failed result不使用success verb；
- progress真正进入state；
- elicitation绑定 item ID；
- meta truncation和content truncation分离。

## 20. Reproduction entrypoints

```bash
cd codex-computer-use-lab

npm test
npm run reproduce
node scripts/check-no-secrets.mjs
```

重点：

```bash
npm run collect:electron-presentation
npm run collect:native-last-window
node --test tests/electron-presentation-contract.test.mjs
node --test tests/native-last-window.test.mjs
node --test tests/wrapper-policy.test.mjs
node --test tests/sky-transport-edge-cases.test.mjs
node --test tests/guardian-private-protocol.test.mjs
```

真实动作 runner 默认 dry-run。

## 21. Current production evidence

已完成：

```text
15-scenario unified production matrix
multi-window
cross-display movement
stale unique/missing/ambiguous
coordinate stale revision
drag
keyboard
modal
scroll
set value
selection
secondary action
```

当前锁屏后未执行动作的 20 场景 attempt：

```text
runner-final-semantic-matrix-v3-locked-attempt.json
```

它不是最终 20 场景矩阵。

## 22. Remaining unknowns

仍值得继续：

1. 两个独立 node_repl client是否共享同一 app diff baseline；
2. mixed 1x/2x display真机 coordinate；
3. OOP WebView production fixture；
4. timeout 后 native late action是否继续产生真实副作用；
5. virtual cursor press是否独立完成真实 click；
6. Guardian rendezvous capability是否可被同用户非预期进程稳定获得；
7. Parent launch constraint为何未进入成品签名；
8. natural Guardian restart期间是否读取 constraint resource；
9. 解锁后的统一 20 场景 V5/V6 matrix。

## 23. 防休眠状态

当前：

```text
launchctl label:
  com.openai.codex.cua-lab-caffeinate

program:
  /usr/bin/caffeinate -dimsu
```

阻止：

- user idle display sleep；
- user idle system sleep；
- system sleep；
- disk idle。

它不会绕过手动锁屏。

## 24. 当前验证状态

```text
npm test:
  141 / 141 passed

npm run reproduce:
  All available reproduction steps completed

secret scan:
  No secret-like text detected in docs or fixtures
```

本轮新增：

```text
Electron presentation contract:
  7 tests

lastWindow state machine:
  5 tests

native socket server:
  6 tests

wrapper approval/metadata:
  2 new hermetic tests

model-tool log parser:
  tracing suffix + non-JSON JS escape coverage
```

真实20场景统一matrix仍因当前用户会话锁屏而未补跑。现有production证据保持：

```text
V4 unified 15 scenarios: pass
V5 multi-window: pass
V5 cross-display: pass
V5 stale missing: fail closed
V5 stale ambiguous: fail closed
V5 stale coordinate: decoy then fresh target
```
