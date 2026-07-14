# Codex App Computer Use 全链路逆向 V9

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

1. 初始模型上下文中的 skill catalog 只有 `name + description + path`；完整
   `SKILL.md` 只在显式 mention 后以 user fragment 注入。
2. `node_repl` MCP initialize instructions 是第三条独立输入，并被用作
   `tool_search` namespace description。
3. Responses 顶层只有 deferred `tool_search`，没有原生 `computer` tool，也没有
   顶层 `mcp__node_repl`；搜索后模型才调用 `mcp__node_repl.js`。
4. Computer Use 十个方法是 `js` 内的 JavaScript facade，不是十个 MCP tools。
5. 模型自己生成 JavaScript 和可选 `title`；Desktop 不解析 JS 来识别
   `click/scroll/type_text`。
6. app approval 是应用能力审批，不是单次动作审批；policy、approval、action
   不是一个原子事务。
7. 单个 Sky transport 一次只有一个 native request in flight；native service
   可同时服务最多 16 条连接。
8. 更深一层，service 内的 AppInstance 不是按 socket、thread 或 conversation
   隔离，而是按 `ApplicationTarget.identifier` 全局共享；同 target 再经
   per-instance serial executor 串行化。
9. conversation cleanup 不删除共享实例，也不等最后一个引用：它直接 deactivate
   该 target，其他 conversation 后续请求再 activate。
10. observation 返回 focused/key window 的 AX tree 和 screenshot；多窗口不合并。
11. element ID 是 revision 内的稳定 lineage ID：root 为零基 DFS，append 保留
    matched ID，新节点从当前最大 ID + 1 继续。
12. AX diff 按 render `id` 匹配 sibling，只比较主 `text` 决定 none/update；
    完整树行数就是 diff budget。
13. stale element refetch 在旧树和新树都要求唯一等价候选；missing/ambiguous
    全部 fail closed。
14. coordinate action 没有 screenshot revision binding。
15. 常规 mouse/scroll/keyboard 最终逐事件投递到目标 PID，不是全局
   `CGEventPost`。
16. WKWebView/OOP content 可以把最终 target PID 改写为 WebContent 进程。
17. 模型结果只得到 `structuredContent/content`，不得到 `_meta`；Desktop event
    保留 `_meta`，并在 completed 时用 `codex/toolSurface` 做 late binding。
18. MCP event 超过 1 MiB 会丢失 `_meta`；native Sky frame 上限是 8 MiB。
19. `get_app_state` 和 element positioning 并非几何上纯只读，可能异步移动、缩放
    或滚动窗口；production harness 必须显式 settle。
20. Guardian XPC 是 capability + first-connection-wins，不是显式 peer code-sign auth。
21. `CUALockScreenGuardian_Parent.coderequirement` 是 parent launch constraint 输入，
    当前成品签名未嵌入，不是 XPC auth 配置。
22. `lastAXTree` 已动态确认跨 `node_repl.js_reset`、Node kernel、wrapper runtime、
    JS client 和 native transport 保留。
23. synthetic WKWebView production fixture 已完成：coordinate click 进入 distinct
    WebContent-backed surface，DOM 收到 `MouseEvent.isTrusted=true`。
24. virtual cursor不是第三种 click backend；它只是 synthetic CG click 前的可选
    visual press，成功后仍走 `SynthesizedEvent -> postToPid`。
25. 真实 Mac client timeout不取消 native action：1ms timeout在59ms返回错误，
    synthetic click在748ms才落地，副作用晚于 rejection 689ms。
26. `NODE_REPL_TRUSTED_CODE_PATHS=~/.codex` 已动态证明是目录级 capability：
    临时模块只因位于该目录即可进入 trusted realm并使用 internal native client。
27. service有 deadline admission gate：已过期 policy request返回
    `-32001 Request deadline exceeded`；但这不等于已接纳 action有协作取消。

公开文档只承诺 Codex Computer Use 可以在受支持地区通过安装插件、授予
Screen Recording/Accessibility 后查看、点击和输入 macOS/Windows 应用，并建议
保持目标应用可见。本文后续关于 `node_repl`、native pipe、AX diff、AppInstance、
Guardian 和 Electron renderer 的结论来自本机实现证据，不是公开 API 契约：

- [Computer Use - Codex app](https://learn.chatgpt.com/docs/computer-use)
- [Use your computer with Codex](https://learn.chatgpt.com/use-cases/use-your-computer-with-codex)

## 1. 固定样本

### 1.1 Desktop

```text
Application:
  /Applications/ChatGPT.app

CFBundleShortVersionString:
  26.707.61608

CFBundleVersion:
  5200

app.asar SHA-256:
  7cd7f277d4d4b6221eb2121fd36d2238c28f203875c62f8abd36f3f12898cb86

bundled codex SHA-256:
  fba7b05624324ce44777b174fe6da1bcf08ef8cba634d85ecfaacbd8fa49aa8d

bundled codex version:
  0.144.0-alpha.4

matching source commit:
  049586f41571e74b44c841868bca3a2233214a71

node_repl SHA-256:
  814d50cae203a0fe909accb485aa3128391f1e6a1ac5ceffa4189aa92bd8f524

node_repl archive:
  20260707.2
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

SKILL.md:
  12,942 bytes
  SHA-256 8e6a753cb166190a7f573b04dc73ae13a1c991497c77f0ef07e0c3e71d143a08
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

### 1.6 Build drift and fixture policy

V6 固定的是：

```text
ChatGPT 26.707.51957 (5175)
app.asar 26708d5b...e027
```

V7 调查过程中 Desktop 自动更新到：

```text
ChatGPT 26.707.61608 (5200)
app.asar 7cd7f277...8cb86
```

Electron chunks、压缩函数名和 file offsets 均发生变化，但 Computer Use plugin、
wrapper 和 native service hash 没有变化。

因此 lab 同时保留：

```text
fixtures/electron/evidence-26.707.51957.json
fixtures/electron/presentation-contract-26.707.51957.json

fixtures/electron/evidence.json
fixtures/electron/presentation-contract.json
```

新版 presentation probe 不再依赖旧压缩名 `ySt/XSt/UCt/mJ/gJ`，而是按语义角色
定位：

```text
MCP event lifecycle
Computer Use formatter + result metadata
MCP renderer
local conversation grouping + elicitation filtering
```

同一 probe 已在旧、新两个 ASAR 上验证 15/15 contracts。

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

### 3.2 三条独立模型输入

不能把 Computer Use 的 model context 简化成“插件 prompt”。当前至少有三条独立
输入。

第一条是 thread 初始 developer context 中的 skill catalog：

```text
name
description
path
```

当前 Computer Use 行：

```text
computer-use:computer-use
Control local Mac apps through Computer Use...
~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000387/
  skills/computer-use/SKILL.md
```

这里不包含 12,942-byte skill body。生成链：

```text
session/mod.rs
  -> build_available_skills
  -> AvailableSkillsInstructions
  -> developer_sections.push(rendered metadata)
```

第二条是显式 mention：

```text
structured UserInput::Skill
  -> path-first resolution

$skill-name or linked resource mention
  -> collect_explicit_skill_mentions

build_skill_injections
  -> read full SKILL.md
  -> user fragment
```

正文包装：

```xml
<skill>
<name>...</name>
<path>...</path>
complete SKILL.md
</skill>
```

第三条是 `node_repl` MCP initialize instructions。当前：

```text
bytes:
  1180

SHA-256:
  4a5fb9fb0998e492da5ddb0600166ef6af0b443e99e7601a4ea64448bcfdf292

use cases:
  in-app browser
  Chrome
  Computer Use
```

Codex 保存为：

```text
initialize_result.instructions
  -> server_instructions
  -> ToolInfo.namespace_description
  -> tool_search source description
```

这三条分别是：

```text
developer skill metadata
user full skill fragment
MCP namespace instructions
```

不能相互替代。

完整可执行证据：

```text
fixtures/model-tool-surface/plugin-model-context.json
scripts/plugin-model-context-probe.mjs
tests/plugin-model-context.test.mjs
```

### 3.3 Deferred discovery

rollout 顺序：

```text
tool_search
  -> expose node_repl tools
  -> mcp__node_repl.js
```

Computer Use plugin skill 教模型在 `node_repl` 中加载 wrapper；它不是由 app-server
自动将 `sky` 注入每个 turn。

BM25 search text包括：

```text
canonical tool name
callable name
raw MCP tool name
server name
title
description
namespace description
schema property names
```

所以 Computer Use use-case 文案和 `code/timeout_ms/title` schema properties 都能帮助
`tool_search` 找到 `mcp__node_repl.js`。

### 3.4 Current MCP schema

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

raw MCP schema：

```text
timeout_ms.minimum = 1
title.minLength = 1
title.maxLength = 80
```

本机 observed `tool_search_output` 保留：

```text
type
required
additionalProperties: false
```

但没有保留上述 numeric/string bounds。这是 deferred schema projection 的实际漂移。

### 3.5 Legacy schema drift

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

V9 动态证明这不是纯静态推断。实验临时在 `~/.codex` 根下放置一个严格限制、
SHA-256 pinned helper。它不在 bundled plugin cache，也没有单文件 allowlist，
但 import 后获得 trusted `nodeRepl` bridge，并可实例化 packaged internal
`MacComputerUseClient`。

helper写完 fixture后立即删除。

现实能力链：

```text
write module below ~/.codex
  -> dynamic import
  -> trusted VM
  -> nativePipe-capable code
```

更安全的实现应 pin 精确 module hash、签名或只读版本目录，而不是整个用户可写
Codex home。

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

V9 真实 service + synthetic app：

```text
configured timeout:
  1 ms

local SkyComputerUseTransportError:
  24 ms

native button click:
  692 ms

gap after client rejection:
  668 ms
```

oracle：

```text
buttonClickCount:
  0 -> 1

lastAction:
  launch -> button-click
```

因此 timeout只表示调用方停止等待 request ID。它不是 native cancellation、
rollback，也不能证明动作没有发生。

fixture：

```text
fixtures/real-cua/timeout-late-action.json
```

另一条只读 raw-wire 实验把 deadline设置为 dispatch前已过期 1000ms。service返回：

```text
-32001 Request deadline exceeded
```

精确状态机：

```text
deadline already expired at service admission
  -> reject

work accepted before deadline
  -> client may timeout later
  -> no cancel
  -> late side effect may still occur
```

fixture：

```text
fixtures/real-cua/expired-deadline.json
```

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

### 7.11 Service-global AppInstance convergence

socket 并发不是最终业务并发边界。service 内还有第二层：

```text
ComputerUseAppInstanceManager.shared
  ApplicationTarget.identifier
    -> ComputerUseAppInstance
       -> SerialExecutor.tail
       -> ComputerUseAppController
          -> chatID
          -> lastAXTree
```

manager 是 service-process singleton：

```text
shared getter       0x10009b964
instance(for:)      0x10009c1a4
setInstance         0x10009c22c
removeInstance      0x10009a1e0
```

唯一 key：

```text
SystemSoftware.ApplicationTarget.identifier
```

它由 bundle URL 推导，不是：

```text
PID
socket
node_repl process
thread
conversation
chatID
```

因此并发层次是：

```text
one JS transport
  -> one request in flight

up to 16 native connections
  -> processFrame can overlap

same targetIdentifier across those connections
  -> converge on one AppInstance
  -> serialize on one per-instance executor tail

different targetIdentifier
  -> independent AppInstance executors
  -> can overlap
```

`SerialExecutor.tail` 位于 `+0x70`。enqueue body：

```text
0x10009b418
```

这解释了为什么“多 socket 可并行”不等于“同一 app 可并行操作”。

静态 fixture：

```text
fixtures/native/app-instance-isolation.json
```

### 7.12 Conversation cleanup is not reference counting

session tracker：

```text
conversationID -> Set<targetIdentifier>
```

它是 lifecycle index，不是 ownership map 或 reference count。

conversation ended/stopped：

```text
remove conversation tracker entry
  -> clearStoppedByUser(target)
  -> asynchronously deactivate shared AppInstance
```

它不会：

```text
call removeInstance(for:)
check whether another conversation references the same target
```

所以两个 conversation 共享 target X 时，结束 A 会 deactivate 共享 X；B 下次请求
会在同一逻辑实例上重新 activate。

`lastAXTree` 属于 AppController：

```text
getter 0x10006c370
setter 0x10006c3bc
```

普通 deactivate 不清它，cleanup 也不移除 instance。静态证据支持跨
conversation 复用旧 diff baseline，V8 的跨 node_repl kernel 动态实验进一步
确认 baseline 确实跨 JavaScript client/transport 边界保留。

动态序列：

```text
Client A:
  disableDiff=true
  -> full tree

node_repl js_reset:
  old Node kernel exits
  old wrapper Symbol cache and bindings disappear

Client B:
  first call uses default diff
  -> native no-change diff
```

Client B 从未获取 client-local full tree，却收到：

```text
There has been no change in the accessibility tree for Window:
"Codex CUA Lab".
```

Phase A marker在 Phase B 开始时已不存在，证明不是同一 JS kernel。

fixture：

```text
fixtures/real-cua/cross-client-baseline.json
```

因此已动态确认：

```text
native lastAXTree baseline
  survives node_repl kernel reset
  survives wrapper/runtime recreation
  survives MacComputerUseClient transport recreation
```

仍需 debugger 才能回答的只剩 pointer-level 细节：是否复用完全相同的
AppInstance/controller/lastAXTree 指针，还是隐藏 replacement 分支保存了等价
baseline。

这修正了早期“最后一个 conversation 引用结束才清实例”的推断。当前二进制并
没有这样的 reference-count gate。

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

V7 production harness 暴露了一个此前低估的副作用：

```text
get_app_state / element positioning
  != geometrically passive observation
```

在 synthetic app 上，第一次 full observation 可以在没有显式 lab action 时移动窗口；
element-index click 前的 visibility positioning 还会在 action promise 返回后继续触发：

```text
window move
resize
scroll
```

这些 AppKit 事件可以晚于 reset handler 到达。

实测竞态：

```text
clean run A:
  failed at scenario 2 reset

clean run B:
  failed at scenario 4 reset

failure state:
  width = 1025
  window moved to secondary display
  lastAction changed from reset to async scroll
```

20ms sampling还观察到一次 reset 周围的多轮 resize wave。修复不是继续猜一个延迟，而是
建立有界 settle contract：

```text
test app reset generation += 1
restore geometry at:
  150ms
  350ms
  650ms
  1000ms

old generation callbacks:
  ignored

runner post-action settle:
  1300ms
```

settle 在 window-move scenario 开始前已经结束，不会干扰合法 drag。

### 9.2 Current focused window

production multi-window：

```text
get_app_state(app)
  = current focused/key window
  != all app windows merged
```

第二窗口：

```text
截图尺寸切换为 secondary window
element index restarts
```

关闭后回到主窗口：

```text
截图尺寸恢复为原 main window
```

### 9.3 AX diff

diff baseline 在 native：

```text
ComputerUseAppController.lastAXTree
```

不是 JS client local cache。

AX diff 可以显示 no change，但业务 oracle 已变化。不能只靠 diff 文本判断动作是否成功。

revision 字段：

```text
lineageID
tree
renderTree
focusTree?
focusRenderTree?
ids
changes
previousRevision?
```

root revision：

```text
setElementIDs
  -> zero-based DFS
```

例如：

```text
R[A,B[C]]
R=0 A=1 B=2 C=3
```

append revision：

```text
structurally matched node
  -> inherit old elementID

new node
  -> current maximum ID + 1
  -> continue DFS
```

不重编号 matched node，也不填历史 ID 空洞。

核心地址：

```text
setElementIDs                  0x100693920
nextAvailable ID iterator     0x100693bac
iterator next                 0x1006948d8
inheritElementID              0x10069515c
root revision                 0x1006b9afc
appending revision            0x1006b9270
```

### 9.4 Exact render difference algorithm

sibling identity：

```text
UIElementRender.id
```

不是：

```text
visible text
elementID
sibling position
```

matched node：

```text
old.text == new.text  -> none
old.text != new.text  -> update
```

`detailText` 不参与 none/update 判定。父节点 update 后仍递归 diff children。

change tags：

```text
0 none
1 insert
2 update
3 remove
```

排序：

```text
IndexPath ascending
same path: none < remove < insert < update
```

所以同一路径 replacement 会先 remove 再 insert。

removed IDs：

```text
sort
  -> maximal consecutive ranges
  -> "Removed element IDs: ..."
```

diff budget不是固定常数。预算值是当前完整 render tree 的行数：

```text
removed summary lines > full tree lines
  -> full tree

total diff lines > full tree lines
  -> full tree

effective changes empty
  -> no-change text
```

`ignoreDifferenceLineBudget=true` 才绕过预算。

可执行行为镜像：

```text
lib/native-ax-behavior-model.mjs
tests/native-ax-diff-refetch.test.mjs
fixtures/native/ax-diff-refetch.json
```

### 9.5 Element IDs

index：

- tree-local；
- window-local；
- lineage-local；
- matched node 可跨 revision 保留；
- 新 sibling 插入会获得更大的新 ID，不会让 matched sibling 整体重编号。

它不是长期 handle。

### 9.6 Stale refetch

旧 element 失效后：

```text
element still valid
  -> return existing

element invalid
  -> equivalent matching in old tree
     0   -> missing-before
     2+  -> elementAmbiguousBeforeRefetch
     1   -> refetch tree
            0   -> elementNoLongerValidAfterRefetch
            2+  -> elementAmbiguousAfterRefetch
            1   -> replace wrapper element and continue
```

before phase 始终严格比较 value。after phase 的 `ignoreValueChange=true` 只忽略
`value`，不会忽略其他 identity 字段或唯一性要求。

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

不比较：

```text
frame/position/size
parent/path/sourcePath
elementID
children path
domClassList
actionDescriptions
```

missing 和 ambiguous 最终都为：

```text
-10005
```

但 message保留语义。

### 9.7 TreeCache

`TreeCache` 是 AX extraction/cache optimization，不是 revision token。

```text
waitForUIToSettle 0x10064a280
captureAXTree     0x1001b6bfc
```

revision identity仍由 lineage/revision graph与 `lastAXTree` 表达。

### 9.8 Screenshot

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

旧 App binary 下的一次实测：

```text
AppKit outer window:
  1025 x 889 points

Sky screenshot:
  886 x 768 pixels
```

当前 v3 fixture 的主窗口截图宽度可因 service positioning 和窗口 frame 调整而不同。
稳定契约不是固定像素值，而是使用每次 fresh screenshot 的真实 dimensions 做换算。

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

1. 单次左键、非 always-simulate、AX gate成立 -> AXPick/AXPress；
2. 否则进入 synthetic event path；
3. 如果已有 virtual cursor，先 await `VirtualCursor.press`；
4. 随后仍构造 synthetic event并per-PID发送。

所以 virtual cursor不是独立后端，只是 synthetic CG path 的可选视觉按压。

AX：

```text
UIElementProtocol.perform(action:)
  -> AXUIElementRef.perform
  -> AXUIElementPerformAction
```

双击、非左键、强制 simulate、无 AXPick/AXPress、clickable-point/hit-test gate
失败都会淘汰 AX action。

cursor lifecycle：

```text
lazy create
deactivate -> orderOut
field retained
next action -> reuse
controller deinit -> release
```

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
target(forMouseEventAt:)               0x10064727c
target(...axWindowPoint...)            0x1006475bc
  -> outOfProcessTargetWindow          0x100647e84
```

keyboard target：

```text
targetForKeyboardEvent                 0x100648204
  -> outOfProcessTarget                0x100648410
```

最终 PID可以是 WebContent，而非 host app PID。

V8 synthetic production fixture：

```text
host PID:
  91849

WebContent PID:
  92087

fresh screenshot coordinate:
  151, 666

DOM MouseEvent.isTrusted:
  true

oop.clickCount:
  0 -> 1
```

HTML来自内存字符串，使用 non-persistent data store，CSP：

```text
default-src 'none'
connect-src 'none'
```

navigation delegate只允许初始 memory/about document。

证据：

```text
fixtures/native/oop-targeting.json
fixtures/real-cua/runner-oop-webcontent-coordinate-click.json
docs/24-oop-webcontent-and-cross-client-dynamics.md
```

read-only LLDB attach 被 hardened service 拒绝。没有修改 SIP、签名、entitlement、
TCC 或任何安全设置。

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

结果本身有两种不同 projection：

```text
model:
  structuredContent first
  otherwise content
  _meta omitted

Desktop event:
  retain complete result below 1 MiB
  read _meta["codex/toolSurface"]
```

所以 `_meta` 是 Desktop attribution channel，不是模型可见 witness。

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
semantic Computer Use formatter -> tool-key label table
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

当前 `26.707.61608` 的语义定位：

```text
formatter chunk:
  KWe
  file offset 1,158,777

codex/toolSurface:
  file offset 1,175,209

MCP renderer:
  w0 / XZt
  title path around 3,423,968

standalone grouping:
  source?.kind===computerUse
  file offset 2,750,041
```

压缩函数名不是稳定契约；fixture 通过语义 markers 而不是名字找到这些角色。

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

当前新版/旧版共同通过的 presentation contracts：

```text
15 / 15
```

包括：

```text
title short-circuit
code not parsed
result-time identity
standalone grouping
failed direct label mismatch
atomic item replacement
progress black hole
elicitation sibling suppression
```

fixture：

```text
fixtures/electron/presentation-contract.json
fixtures/electron/presentation-contract-26.707.51957.json
```

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

初始 developer context提供 skill metadata：

```text
name + description + path
```

显式 skill mention后注入：

```xml
<skill>
<name>...</name>
<path>...</path>
full body
</skill>
```

MCP提供：

```text
js(code, timeout_ms?, title?)
```

MCP initialize instructions应进入 deferred namespace description。

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
  ApplicationTarget.identifier -> AppInstance

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

必须明确：

```text
same target across sockets/conversations
  -> shared AppInstance
  -> one executor tail

conversation end
  -> deactivate
  -> do not remove instance
  -> do not reference-count other conversations
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

兼容当前实现的 ID/diff 行为：

```text
root IDs: zero-based DFS
matched append nodes: preserve ID
new nodes: max ID + 1
sibling match: render id
none/update: primary text
diff budget: full-tree line count
```

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
npm run collect:native-ax
npm run collect:native-instance
npm run collect:plugin-model-context
node --test tests/electron-presentation-contract.test.mjs
node --test tests/native-last-window.test.mjs
node --test tests/native-ax-diff-refetch.test.mjs
node --test tests/native-app-instance-isolation.test.mjs
node --test tests/plugin-model-context.test.mjs
node --test tests/wrapper-policy.test.mjs
node --test tests/sky-transport-edge-cases.test.mjs
node --test tests/guardian-private-protocol.test.mjs
```

真实动作 runner 默认 dry-run。

## 21. Current production evidence

已完成：

```text
21-scenario unified production matrix
66 total steps
192 approval-store post-call checks
21 / 21 scenarios passed

full-state
diff
button-click
set-value
type-text
press-key
select-text
checkbox
slider-secondary-action
scroll
modal
multi-window
dynamic-hierarchy stale unique replacement
stale missing
stale ambiguous
ambiguous same-name targeting
coordinate click
coordinate stale revision
drag
window move across two displays and back
OOP WKWebView coordinate click into a distinct WebContent process
```

最终 fixture：

```text
fixtures/real-cua/runner-final-semantic-matrix-v4.json
```

provenance：

```text
lab app:
  a4c719b5160d553f53afabf17fd1f7bae232858a50727e33194a0c1bdfa8da46

SkyComputerUseService:
  27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58

wrapper:
  6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f
```

persistent approval store：

```text
before:
  absent

after:
  absent

every audited call:
  absent
```

两个 stale-negative scenario 的 action 按预期返回 `-10005`，但 scenario 通过，
因为 target/decoy oracle 均保持不变。这是 fail-closed success，不是测试失败。

## 22. Remaining unknowns

仍值得继续：

1. debugger pointer 级确认两个 client 是否复用同一个 AppInstance/controller；
2. mixed 1x/2x display真机 coordinate；
3. OOP WebContent 的 pointer/targetPID 函数级 tracing；production business fixture已完成；
4. virtual cursor overlay witness，区分有/无 cursor 的 synthetic CG；
5. Guardian rendezvous capability是否可被同用户非预期进程稳定获得；
6. Parent launch constraint为何未进入成品签名；
7. natural Guardian restart期间是否读取 constraint resource；
8. `ApplicationTarget.identifier(for:)` 的完整 URL canonicalization；
9. Responses 服务端如何允许仅由 `tool_search_output` 暴露的 deferred function；
10. current production request 中显式 Computer Use SKILL body 的逐字节 wire capture；
11. appController 是否存在会替换并清空 `lastAXTree` 的间接分支。

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
  184 / 184 passed

npm run reproduce:
  All available reproduction steps completed

secret scan:
  No secret-like text detected in docs or fixtures
```

验证日期：

```text
2026-07-13
```

本轮新增：

```text
current Desktop semantic presentation probe:
  old and new ASAR, 15 / 15 contracts

native AX executable behavior model:
  6 tests

native AppInstance isolation contract:
  5 tests

plugin-to-model input/output contract:
  5 tests

production semantic matrix:
  21 / 21 scenarios
  66 steps
  192 approval-store checks

cross-client native baseline:
  Client A full -> js_reset -> Client B no-change diff

OOP WebContent:
  distinct PID
  coordinate click
  trusted DOM event
  native OOP target contract

real timeout late action:
  1 ms configured
  reject at 24 ms
  click at 692 ms
  helper removed after capture

expired admission deadline:
  -32001 Request deadline exceeded

URL policy:
  static contract + offline behavior model
  checker failure fail-open
  blocked follow-up -10015

conversation lifecycle:
  attempt failed closed because success log was not observed
  no fixture or dynamic claim
```

历史 fixture 仍保留作 A/B evidence：

```text
V4 unified 15 scenarios: pass
V5 multi-window: pass
V5 cross-display: pass
V5 stale missing: fail closed
V5 stale ambiguous: fail closed
V5 stale coordinate: decoy then fresh target
```
