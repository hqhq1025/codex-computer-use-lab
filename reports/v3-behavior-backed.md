# Codex App Computer Use 行为逆向 V3

副标题：隔离 AppKit 测试环境、真实锁屏阻断、坐标系统、函数级静态入口与生产行为实验框架

调查日期：2026-07-12  
实验室：`/Users/haoqing/Documents/Learning/codex-computer-use-lab`

## 0. 本版的定位

V1 还原了总体架构。  
V2 把模型、app-server、MCP、node_repl、wrapper 和 Sky wire 做成了可复现实验。  
V3 开始进入原生服务的真实行为层。

本版完成了：

1. 构建独立 synthetic macOS App；
2. 建立真实生产 CUA 的严格动作白名单和 oracle；
3. 实测生产 `get_app_state` 在锁屏状态下的 fail-closed 行为；
4. 精确采集本机双显示器 AppKit/CoreGraphics 几何；
5. 对 6 个原生 async entry 做有界反汇编；
6. 恢复 22 个 app policy / approval / runtime error transition；
7. 区分 screenshot、Appshot、Skysight、Event Stream、PiP 和 analytics；
8. 将所有非生产动作实验纳入统一复现；
9. 将测试套件扩展到 77 项并全部通过。

本版没有声称完成：

- 解锁后的真实 AX tree；
- 真实 screenshot 尺寸；
- 真实 element click；
- 真实 state diff；
- stale element/refetch；
- coordinate click；
- user intervention。

原因不是代码或权限链路未知，而是执行时 macOS 处于锁屏，production CUA 正确返回
`screenLocked`。实验没有尝试自动解锁。

## 1. 当前行为覆盖率

| 层 | 当前覆盖 |
|---|---:|
| 模型工具发现 | 95% |
| app-server / Responses / MCP | 95% |
| node_repl / trusted bridge | 95% |
| wrapper / app approval / TOCTOU | 95% |
| Sky client wire | 95% |
| Electron plugin lifecycle | 90% |
| 原生静态模块结构 | 80% |
| 原生 async entry / branch | 55% |
| app policy / error state | 80% |
| screenshot/PiP/Skysight 边界 | 70% |
| display coordinate model | 80% |
| 真实锁屏行为 | 100% |
| 真实 AX observation | 尚未执行 |
| 真实语义 action | 尚未执行 |
| 真实 coordinate action | 尚未执行 |

## 2. Synthetic Test App

### 2.1 固定身份

```text
bundle identifier:
  com.openai.codex.cualab

path:
  /Users/haoqing/Documents/Learning/codex-computer-use-lab/
  test-app/build/Codex CUA Lab.app

oracle:
  test-app/runtime/state.json
```

App 使用 AppKit 和 Swift 6.3 构建，ad-hoc 签名，不带 network entitlement。

### 2.2 隐私边界

源码测试确认不包含：

- 网络 API；
- clipboard API；
- UserDefaults；
- 外部文件读取；
- 用户数据访问；
- shell command；
- AppleScript；
- System Events。

App 唯一写入：

```text
test-app/runtime/state.json
```

runtime directory：

```text
0700
```

state file：

```text
0444
```

每次写入使用 atomic replacement。

### 2.3 Oracle identity

```json
{
  "schemaVersion": 1,
  "synthetic": true,
  "syntheticMarker": "CUA Lab Synthetic Surface",
  "bundleIdentifier": "com.openai.codex.cualab",
  "appPath": ".../test-app/build/Codex CUA Lab.app"
}
```

runner 在任何 production CUA 调用前验证这些字段。

### 2.4 最小真实场景

当前 production execution 只开放：

```text
full-state
button-click
```

其他 12 个场景保留在 dry-run DSL 中，但没有开放真实执行。

### 2.5 App 状态

oracle 核心：

```json
{
  "meta": {
    "resetCount": 0,
    "lastAction": "launch"
  },
  "metrics": {
    "fullStateProbeCount": 0,
    "diffProbeCount": 0
  },
  "controls": {
    "buttonClickCount": 0
  }
}
```

## 3. 真实行为实验安全契约

### 3.1 唯一目标

runner 硬编码拒绝：

- 其他 bundle ID；
- 其他 App 路径；
- symlinked App；
- symlinked state path；
- 多个同 bundle 匹配；
- 其他输出目录；
- dependency injection；
- wrapper path override；
- wrapper hash mismatch。

### 3.2 动作白名单

完整 DSL 可表示：

```text
click
set_value
type_text
select_text
perform_secondary_action
scroll
drag
```

但当前 production execution 仅使用：

```text
get_app_state
click
```

### 3.3 每步不变量

```text
fresh full get_app_state
  -> synthetic AX marker validation
  -> read oracle before
  -> exactly one allowlisted action
  -> fresh get_app_state
  -> read oracle after
  -> declared path comparison
```

### 3.4 禁止能力

- delete；
- upload；
- external communication；
- account/authentication；
- financial；
- system settings；
- install；
- locked use；
- persistent approval；
- clipboard；
- network；
- non-test App。

## 4. Runner 的两个关键纠错

### 4.1 不能替换 `nodeRepl`

早期 runner 尝试：

```text
replace globalThis.nodeRepl with Proxy
```

以强制 session-only approval。

这是错误设计。

shipped kernel 使用：

```js
Object.defineProperty(runtimeContext, "nodeRepl", {
  value,
  writable: false,
  configurable: false
});
```

而且：

- runner 在 untrusted realm；
- wrapper 在 trusted realm；
- 两个 realm 看到不同 `nodeRepl` object；
- 修改 untrusted global 即使成功，也不会覆盖 trusted wrapper 的 bridge。

修复：

```text
不覆盖 nodeRepl
不伪造 trusted bridge
```

### 4.2 Untrusted runner 不应要求 privilege 可见

runner 早期要求：

```text
nodeRepl.nativePipe
nodeRepl.createElicitation
```

在自己的 realm 可见。

这同样错误。

正确模型：

```text
untrusted runner
  -> sees ordinary nodeRepl
  -> imports exact trusted wrapper
  -> wrapper sees trusted nodeRepl
```

修复后的 runner 只要求普通 node_repl host，验证：

- wrapper realpath；
- wrapper SHA-256；
- App identity；
- oracle identity。

trusted bridge 缺失由 wrapper 自身 fail closed。

## 5. Persistent Approval 的实际防线

由于 runner 不能也不应劫持 trusted elicitation bridge，真实审批保持产品原生 UI。

runner 改用可验证边界：

```text
approval store before request must be absent
  -> production call
  -> approval store after request must still be absent
```

store：

```text
~/Library/Group Containers/
2DC432GLL2.com.openai.sky.CUAService/
Library/Application Support/Software/
ComputerUseAppApprovals.json
```

runner：

- 不读取内容；
- 不自动删除；
- 不写入；
- 如果出现，立即停止；
- 将 metadata 记录为 failure。

真实 UI 应选择：

```text
Allow this conversation
```

不能选择：

```text
Always allow
```

## 6. 本机显示器拓扑

### 6.1 AppKit

主屏：

```text
frame points:
  x=0 y=0 width=1920 height=1200

scale:
  1.0
```

副屏：

```text
frame points:
  x=-1920 y=244 width=1920 height=1200

scale:
  1.0
```

AppKit global origin 位于主屏左下。

### 6.2 CoreGraphics

主屏：

```text
x=0 y=0 width=1920 height=1200
```

副屏转换后：

```text
x=-1920 y=-244 width=1920 height=1200
```

CoreGraphics global origin 位于主屏左上，Y 向下。

### 6.3 Desktop union

AppKit：

```text
x=-1920
y=0
width=3840
height=1444
```

CoreGraphics：

```text
x=-1920
y=-244
width=3840
height=1444
```

### 6.4 转换

```text
cg.x = appKit.x - main.minX
cg.y = main.maxY - appKit.maxY
```

本机 `main.minX = 0`。

### 6.5 动态 visibleFrame

测试中主屏 visibleFrame bottom 从：

```text
103
```

变化到：

```text
100
```

这是 Dock/menu UI 的动态影响，不能作为 deterministic fixture。

最终测试策略：

- display frame 精确；
- CG bounds 精确；
- pixel dimensions 精确；
- display ID 精确；
- scale 精确；
- visibleFrame 只验证结构、范围和自洽。

## 7. 跨屏截图映射

实验包含 synthetic mixed-scale case：

```text
left display: 1x
right display: 2x
capture rect crosses x=0
```

裁剪规则：

```text
floor pixel minima
ceil pixel maxima
clamp to display
```

重要结论：

> screenshot coordinate 应由实际 image pixel dimensions 和 capture rect 推导，不能只乘 NSScreen scale。

如果 capture：

```text
160.5 points wide
321 pixels wide
```

则 X scale：

```text
2 pixels/point
```

应由 `321 / 160.5` 得到，而不是假设目标 display 的 scale。

## 8. 原生函数级入口

有界反汇编覆盖：

| ID | Entry | 大小 |
|---|---:|---:|
| IPC request dispatch | `0x10013f9e4` | 204 B |
| PerformAction request | `0x10012df9c` | 92 B |
| GetSkyshot request | `0x100136904` | 112 B |
| captureAXTree | `0x1001b6bfc` | 32 B |
| captureScreenshot | `0x1001b7cec` | 32 B |
| waitForUIToSettle | `0x10064a280` | 220 B |

这些是 async named entry，不是完整函数逻辑体。

## 9. Swift async 边界

典型形态：

```text
named entry
  -> swift_task_alloc
  -> swift_task_switch
  -> anonymous continuation
  -> indirect branch
```

因此：

- entry size 不等于完整 implementation size；
- continuation 中的 call 不能伪装成 entry direct edge；
- `...FTu` async pointer 只证明 target compiled；
- `br xN` 无寄存器数据流时不能命名 target。

### 9.1 IPC dispatch

直接：

```text
bl anonymous helper
bl swift_task_alloc
br x4
```

`br x4` 是 indirect dispatch。

不能画：

```text
IPC -> PerformAction direct
```

### 9.2 PerformAction

直接：

```text
metadata accessor
swift_task_alloc
tail b swift_task_switch
```

`AppController.click` 仅标为 related compiled async target。

### 9.3 GetSkyshot

直接：

```text
swift_task_alloc
tail b anonymous helper
```

`updateSkyshot` 仅标为 related compiled target。

### 9.4 AX / screenshot

`captureAXTree` 和 `captureScreenshot` 的 named entry 都只有 32 B，业务逻辑在 continuation。

### 9.5 Settle

`waitForUIToSettle`：

- multiple task allocations；
- two local stubs；
- tail switch。

两个 local stub 没有猜测私有名称。

## 10. Policy 状态机

恢复了 22 个 transition。

### 10.1 五个串联门

```text
target resolution
  -> app policy
  -> approval
  -> get_app_state
  -> runtime gate
  -> action
```

### 10.2 App policy

```text
allowed
denied
forbidden
```

`allowed` 只表示可进入 approval gate。

### 10.3 Approval 后仍不可直接 action

```text
approval_session
  -> authorized_unobserved
```

必须：

```text
get_app_state
  -> active_observed
```

否则：

```text
noActiveSession -10011
```

### 10.4 blocked URL

```text
active_observed
  -> blockedURL -10015
  -> session terminal
```

同 session 不应直接重试。

### 10.5 User intervention

```text
active_observed
  -> user input
  -> intervention_debounce
  -> reobserve_required
  -> get_app_state
  -> active_observed
```

### 10.6 Screen lock

```text
active/attempted observation
  -> screenLocked -10020
  -> screen_locked_blocked
```

恢复：

```text
manual or managed unlock
  -> reobserve_required
  -> get_app_state
```

### 10.7 Ambiguous app

多个 app 共享 bundle ID：

```text
ambiguousApp -10018
```

必须使用：

- app name；
- full path。

不能选第一个。

### 10.8 Stale element

无独立 error code。

```text
still valid
  -> execute

unique identity-preserving refetch
  -> may execute

missing or multiple match
  -> no action
  -> reobserve
```

## 11. Forbidden 与 System Security

确认存在：

- `forbidden` decision；
- system security target classifier；
- system security action rejection；
- `ComputerUseAllowForbiddenTargets` 字符串。

没有恢复：

-完整 forbidden bundle list；
-完整 security process list；
-开发开关 production 可用性。

fixture 中名单保持空，不猜。

## 12. Screenshot 生命周期

静态确认：

```text
captureScreenshot
writeScreenshotToFile
ScreenshotFile
ComputerUseSkyshotAttachment
TemporaryFile.temporaryDirectory
```

最窄模板：

```text
$TMPDIR/<temporary-file-root>/
screenshot_<opaque>.<image-extension>
```

确认：

- 创建；
- attachment handoff；
- temporary root。

未知：

- action/response 后立即删除；
- object release 删除；
- periodic/system cleanup；
- TTL。

### 12.1 当前运行快照

锁屏 observation 前：

```text
active screenshot temporary files: 0
```

锁屏 observation 后：

```text
active screenshot temporary files: 0
```

这与“screen lock 在 capture 前阻断”一致。

## 13. Appshot

Appshot 是独立 capture UX：

```text
AppshotCaptureStore
AppshotCaptureTransition
Appshot.wav
```

store 主要是内存。

final frame 可以复用 `ScreenshotFile`。

不能用 `screenshot_*` 文件反推 Appshot 正在运行。

## 14. Skysight 与 Event Stream

### 14.1 Event Stream

独立 request：

```text
Start
Status
Stop
```

有：

- writer；
- auto-stop；
- originating thread；
- end reason；
- URL policy；
- secure input；
- blocked capture context。

### 14.2 Skysight

独立 request：

```text
Start
Status
Stop
UpdateExclusion
ListExclusions
```

它订阅 Event Stream capture，但有自己的：

- segment writer；
- memory pipeline；
- approval；
- app/url/private-browsing exclusion。

路径：

```text
$TMPDIR/skysight/segments/<id>/events.jsonl
$TMPDIR/skysight/segments/<id>/metadata.json
```

当前：

```text
active segment count = 0
current enabled = unknown
```

## 15. PiP

PiP 使用独立 XPC presentation：

```text
native producer
  -> presentation ID / thread ID / turn ID
  -> context ID / fence
  -> Electron sky.node host
```

不承载主 CUA JSON-RPC。

gate：

```text
cuaPIP
&& alwaysHidePictureInPicture != true
```

当前 active presentation 未读取，保持 unknown。

## 16. Analytics

本地：

```text
Analytics.db
Cache.db
httpstorages.sqlite
```

当前唯一 Sky process 打开 Analytics DB。

这只证明：

```text
local event logger/queue active or initialized
```

不证明：

- 某 event 已写入；
- Statsig initialized；
- network sending；
- payload 内容；
- exposure logging enabled。

采集器不查询 DB，不抓包，不读 body。

## 17. Production 锁屏实验

### 17.1 前置条件

测试 App：

```text
running
PID 81319
oracle synthetic
buttonClickCount = 0
fullStateProbeCount = 0
```

Persistent approval store：

```text
absent
```

Sky service：

```text
PID 94559
```

### 17.2 请求

通过当前 Codex task 的真实 `mcp__node_repl`：

```js
await sky.get_app_state({
  app: "com.openai.codex.cualab",
  disableDiff: true
});
```

使用真实：

- trusted Computer Use wrapper；
- `@oai/sky`；
- nativePipe；
- production `computeruse.sock`；
- production `SkyComputerUseService`。

### 17.3 响应

```text
The Mac is locked and automatic unlock could not unlock it.
Ask the user to unlock the Mac manually before continuing.
```

对应：

```text
screenLocked
code -10020
```

### 17.4 系统状态

```text
IOConsoleLocked = Yes
CGSSessionScreenIsLocked = Yes
```

Locked Use：

```text
authorization plugin installed = false
```

### 17.5 副作用检查

```text
AX state returned = false
screenshot returned = false
UI action executed = false
oracle changed = false
button count changed = false
full state count changed = false
persistent approval store created = false
screenshot temporary file created = false
```

### 17.6 行为结论

锁屏 gate 位于：

```text
production request accepted by native service
  -> lock state validation
  -> abort before AX/screenshot/action
```

至少在当前未安装 Locked Use 的机器上：

```text
screen lock is pre-observation fail closed
```

实验没有：

- 自动解锁；
- 安装 plugin；
- 写 authorizationdb；
- 模拟密码；
-重试 action；
-后台绕过。

## 18. 锁屏实验与静态状态机对照

静态 state machine：

```text
screen_locked
  -> screen_locked_blocked
  -> error -10020
  -> unlock_then_get_app_state
```

真实结果完全匹配。

特别是恢复条件不是：

```text
unlock_then_retry_old_action
```

而是：

```text
unlock
  -> get_app_state
  -> new observed state
  -> action
```

## 19. 解锁后待执行的两步

### 19.1 只读 Full State

前置：

```text
manual user unlock
test app running
approval store absent
```

真实调用：

```js
var lab = await import(
  "/Users/haoqing/Documents/Learning/codex-computer-use-lab/" +
  "scripts/real-cua-lab-runner.mjs"
);

var full = await lab.runRealCuaLab({
  execute: true,
  scenarioIds: ["full-state"],
  outputPath:
    "/Users/haoqing/Documents/Learning/codex-computer-use-lab/" +
    "fixtures/real-cua/full-state-result.json"
});
nodeRepl.write(JSON.stringify(full, null, 2));
```

如果弹审批：

```text
Allow this conversation
```

不能：

```text
Always allow
```

期望 oracle：

```text
metrics.fullStateProbeCount: 0 -> 1
meta.lastAction: full-state-probe
```

注意：当前 full-state scenario 包含一次 synthetic probe button click，因此不是纯 observation。若只要纯只读状态，应使用已准备的直接 `get_app_state` 代码，不使用 scenario runner。

### 19.2 Button Click

只有 full-state 成功且 approval store 仍 absent 后：

```js
var clicked = await lab.runRealCuaLab({
  execute: true,
  scenarioIds: ["button-click"],
  outputPath:
    "/Users/haoqing/Documents/Learning/codex-computer-use-lab/" +
    "fixtures/real-cua/button-click-result.json"
});
```

期望：

```text
controls.buttonClickCount: 0 -> 1
meta.lastAction: button-click
```

## 20. 为什么本轮没有继续自动等待

macOS lock 是外部物理状态。

反复轮询或尝试：

- synthetic unlock；
- loginwindow AX；
- authorization plugin；
-自动密码；

都会越过本实验安全边界。

因此本轮在确认：

```text
IOConsoleLocked = Yes
```

后停止 production action，并保留：

- built test App；
- runner；
- oracle；
- before/after snapshots；
- locked fixture；
-复现命令。

## 21. 当前测试结果

完整 suite：

```text
77 tests
77 pass
0 fail
```

新增覆盖：

- test App build；
- bundle ID；
- accessibility markers；
- no network entitlement；
- no network/clipboard/external read API；
- display topology；
- AppKit/CoreGraphics conversion；
- dynamic visibleFrame；
- mixed-scale crop；
- bounded native callgraph；
- policy transitions；
- observability aggregate；
- real runner whitelist；
- wrapper hash pin；
- frozen untrusted nodeRepl；
- approval store fail closed；
- real snapshot no socket client；
- locked production observation。

## 22. 统一复现

```bash
cd codex-computer-use-lab
npm run reproduce
```

它现在包括：

1. model surface；
2. app-server；
3. node_repl；
4. mock Sky wire；
5. wrapper policy；
6. test App build；
7. display geometry；
8. native symbol map；
9. native bounded callgraph；
10. Electron extraction；
11. policy extraction；
12. observability extraction；
13. security extraction；
14. real-CUA dry-run plan；
15. secret scan；
16. all tests。

不包括：

```text
production --execute
```

因为真实 CUA 需要：

- screen unlocked；
- App running；
- action-time session approval。

## 23. 本版新增文件

### Test App

- `test-app/Sources/*.swift`
- `test-app/build.sh`
- `test-app/launch.sh`
- `test-app/reset.sh`
- `test-app/stop.sh`

### Behavior Harness

- `scripts/real-cua-lab-runner.mjs`
- `lib/cua-lab-scenarios.mjs`
- `scripts/real-cua-snapshot.mjs`

### Display

- `scripts/display-geometry-probe.swift`
- `scripts/display-geometry-probe.sh`
- `fixtures/display/current.json`
- `fixtures/display/alignment-cases.json`

### Native Callgraph

- `scripts/native-callgraph.sh`
- `fixtures/native-callgraph/`

### Policy / Observability

- `scripts/extract-policy-evidence.sh`
- `fixtures/policy/evidence.json`
- `scripts/collect-observability-evidence.sh`
- `fixtures/observability/latest.json`

### Production Behavior

- `fixtures/real-cua/locked-observation.json`
- `fixtures/real-cua/before-first-real-observation.json`
- `fixtures/real-cua/after-locked-observation.json`
- `fixtures/real-cua/preflight.json`
- `fixtures/real-cua/dry-run-plan.json`

## 24. 三版报告索引

- [V1 架构逆向](v1-architecture.md)
- [V2 协议实验室](v2-experiment-backed.md)
- [V3 行为逆向](v3-behavior-backed.md)

## 25. 最终判断

当前已经确认：

```text
production Computer Use request
  -> trusted wrapper
  -> production native service
  -> lock state gate
  -> screenLocked -10020
  -> no AX
  -> no screenshot
  -> no action
  -> no persistent approval
```

这证明原生服务不是“收到请求就先截图再判断”，而至少在锁屏分支中会先验证系统状态并提前终止。

解锁后的 AX 和 action 实验已经不再需要新增架构代码，只剩两个严格白名单化的执行步骤。真正尚未挖完的核心已经收缩为：

```text
unlocked production get_app_state result
unlocked production element click result
```

以及之后才能继续的：

```text
diff
stale/refetch
coordinate
userIntervened
multi-display window move
```

本轮没有为了“完成率”绕过锁屏，也没有把未执行场景写成成功。这是行为逆向结果的一部分，而不是失败。
