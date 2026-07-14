# `node_repl` MCP 与 Trusted Bridge 边界

## 结论

本章最初针对本机安装的 ChatGPT/Codex App `26.707.51957`。动态 probe
没有加载 Computer Use wrapper，没有 import `@oai/sky`，没有调用
`nodeRepl.nativePipe.createConnection`，也没有打开任何真实 native socket。

V7 已在当前 `26.707.61608 (5200)` 上重跑同一 probe。当前 `node_repl`
SHA-256 为：

```text
814d50cae203a0fe909accb485aa3128391f1e6a1ac5ceffa4189aa92bd8f524
```

当前结果见 `fixtures/node-repl/probe.json`；下表保留创建本章时的历史身份。

已确认的边界是：

1. 外层是 Rust `node_repl` 提供的 MCP JSON-RPC 2.0 stdio server。
2. `js` 首次执行时，Rust host 启动打包的 Node `24.14.0` kernel。
3. 每个模型提交的 root cell 都从 untrusted `vm.SourceTextModule` 开始。
4. 普通 cell 只得到冻结的基础 `nodeRepl` 对象；trusted module 得到以它为
   prototype 的另一个冻结对象，特权属性只定义在后者上。
5. 本地 `.js` / `.mjs` 动态 import 只有命中 trusted path、source hash 或
   `NODE_REPL_TRUST_ALL_CODE=1` 才跨入 trusted VM。
6. `nativePipe`、`createElicitation`、`launchServices` 和
   `withSuspendedTimeout` 都是 trusted-only 注入，且请求还需经过 kernel
   到 Rust host 的 token/active-exec 授权层。
7. `emitImage` 属于普通 cell surface。它不授予 native access，只把内存
   image bytes 交给 Rust host 转成 MCP image content。

## 固定版本与二进制身份

| 项目 | 值 |
|---|---|
| App version | `26.707.51957` |
| App build | `5175` |
| `node_repl` | Mach-O arm64，15,853,568 bytes |
| SHA-256 | `911b1e60ab9e217255a9d80ff67f2bc2db2920e1d03ab673a812cbcf429a363e` |
| Bundled Node | `24.14.0` |
| V8 | `13.6.233.17-node.41` |
| `node_repl` archive | `20260707.2` |
| Runtime archive | `0.0.3/20260708050802-66a5641b5362-pr-1103797` |
| MCP Rust library | `rmcp 1.5.0`，由 initialize response 与 binary paths 双重确认 |

可复核命令：

```bash
file /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl
shasum -a 256 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl
cat /Applications/ChatGPT.app/Contents/Resources/cua_node/manifest.json
otool -L /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl
nm -nm /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl
strings -a -n 5 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl
```

Mach-O 只动态链接系统库，包括 Security、CoreFoundation、libiconv 和
libSystem。二进制自身带 hardened runtime 签名，并拥有 JIT/unsigned
executable memory、Apple Events、camera、microphone、network client 等
entitlements。entitlement 说明进程上限，不等于普通 JS cell 自动拥有这些
能力；VM 注入与 host authorization 才是本章讨论的实际边界。

## 两层 stdio 与两种协议

```text
MCP client
  | JSON-RPC 2.0, one JSON object per line
  v
Rust node_repl MCP server
  | private JSONL: exec / exec_result / emit_image / privileged requests
  v
Node 24 kernel.js
  | vm.SourceTextModule
  +-- untrustedContext: every root cell
  +-- trustedContext: allowlisted imported local modules
```

外层 wire 由 `rmcp::transport::async_rw::AsyncRwTransport` 处理。实测顺序：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"codex-cu-lab-node-repl-probe","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"js","arguments":{"code":"<redacted>","title":"Inspect ordinary cell surface","timeout_ms":5000}}}
```

initialize response 声明 `tools.listChanged=true`。`tools/list` 返回：

| Tool | 输入 |
|---|---|
| `js` | required `code`; optional `title`, `timeout_ms` |
| `js_add_node_module_dir` | required absolute `path` |
| `js_reset` | empty object |

完整但脱敏的请求/响应序列保存在
`fixtures/node-repl/transcript.json`。其中 JS 源码被替换为 probe 名称与
SHA-256，server instructions 被省略，PNG base64 被替换为 byte length 与
SHA-256。

内层不是 MCP。Rust host 向 kernel 写入 `exec`，kernel 回传
`exec_redacted_source`、`response_meta`、`emit_image`、`exec_result` 等
JSONL frame。trusted-only 路径还会产生：

```text
privileged_bridge_handshake
elicit
authenticated_fetch
config_action
launch_services_action
suspend_timeout
resume_timeout
native_pipe_request
submitted_code_complete
```

反方向对应：

```text
emit_image_result
elicitation_result
authenticated_fetch_result
privileged_result
native_pipe_response
native_pipe_data
native_pipe_closed
```

## Kernel 启动与持久状态

嵌入源码 `kernel.js` 明确要求 Node 使用
`--experimental-vm-modules`。Rust symbol 和 strings 还给出启动参数：

```text
--session-id
--working-dir
--response-meta-trace
```

每次 `js` 是新的 ESM cell。kernel 保存 `previousModule` 与
`previousBindings`，下一 cell 通过 synthetic `@prev` module 重建上一
cell 的顶层绑定。因此“持久 REPL”不是在同一个 script 中追加文本，而是
在多个 SourceTextModule 之间显式转接 namespace。

live probe 的两个连续调用分别返回 `41` 和 `42`，证明 object binding 在
同一 MCP server 生命周期内持续存在。

失败时 kernel 会区分已经 committed 的 binding。若 cell 已完成 prelude
或某些初始化，即使后续抛错，部分 binding 仍可能被带到下一 cell；link
失败且不能安全读取 namespace 时则保留上一成功 module。

## Untrusted 与 Trusted VM

`createRuntimeContext()` 给两个 context 注入相同的常用 Node/Web globals：

```text
Buffer, console, URL, URLSearchParams, TextEncoder, TextDecoder,
AbortController, AbortSignal, structuredClone, fetch, Headers,
Request, Response, performance, crypto, timers, queueMicrotask,
setImmediate, atob, btoa
```

两个 context 都禁止 string code generation。untrusted context 还明确禁止
Wasm code generation。root cell 创建处写死：

```text
context: untrustedContext
```

并注明：

```text
Model-written root cells always start untrusted.
```

普通 cell 的 `nodeRepl` 是 `Object.freeze` 后的基础对象。live probe 观察到
仅有以下 own keys：

```text
cwd
emitImage
env
homeDir
requestMeta
setResponseMeta
tmpDir
write
```

以下属性在普通 cell 中同时满足 `name in nodeRepl === false`、
`Object.hasOwn(nodeRepl, name) === false` 和 `typeof === "undefined"`：

```text
addAfterSubmittedCodeHook
gaasBrowserConfig
createElicitation
launchServices
nativePipe
withSuspendedTimeout
config
fetch
telemetry
```

trusted object 的构造方式是：

```text
Object.freeze(Object.create(nodeRepl, privilegedNodeReplProperties))
```

也就是说，基础能力从 prototype 继承，特权能力只作为 trusted object 的
non-configurable、non-writable own properties 存在。两个对象分别通过
`defineLockedGlobal` 注入各自 VM，global property 本身也不可改写或删除。

`env` 是一个特例：基础对象上已有冻结的 `untrustedEnv`，只包含
`NODE_REPL_UNTRUSTED_ENV_ALLOWLIST` 点名的变量；trusted object 用 own
property 覆盖为完整且冻结的 process environment snapshot。probe 把该
allowlist 设为空，因此普通 cell 实测 `Object.keys(nodeRepl.env)` 是空数组。
直接的 Web `fetch` global 在两个 VM 都存在；trusted-only 的
`nodeRepl.fetch` 是另一条 host-mediated authenticated fetch 路径，不应混淆。

### 动态 import 的信任判定

root cell 只能 static import 内部 `@prev`；用户模块必须 dynamic import。
本地文件仅允许 `.js` / `.mjs`。判定顺序如下：

1. root main module 永远不 trusted。
2. `NODE_REPL_TRUST_ALL_CODE=1` 时，imported local code trusted。
3. 文件 source SHA-256 命中
   `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 时 trusted。
4. canonicalized path 位于
   `NODE_REPL_TRUSTED_CODE_PATHS` 任一绝对目录内时 trusted。
5. 一个 trusted dynamic importer 的后续本地依赖图继续留在 trusted
   context，不会在每一层重新降级。
6. 其他本地模块进入 untrusted context。

文件 module cache key 带 `trusted` / `untrusted` kind，避免同一路径在两个
realm 间错误复用。每次 exec 前本地 file module cache 会清空。

这是一条重要的放大边界：一旦入口文件被 path/hash 信任，它的本地依赖图
也继承 trusted context。因此 trusted root 应尽量收窄到只读、版本化目录或
精确 hash，而不是宽泛的用户可写目录。

### 当前 Desktop 的真实 trust 配置

只读检查运行中的 desktop `node_repl` 进程环境与 `~/.codex/config.toml`
得到相同结果：

```text
NODE_REPL_NODE_MODULE_DIRS=<ChatGPT.app>/Contents/Resources/cua_node/lib/node_modules
NODE_REPL_TRUSTED_CODE_PATHS=~/.codex
NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S=
  6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f,
  e74b67ab909392b37f7aef14977fce7aa80cfa02ade5491f30abcdbcb9e69f33
```

逐文件 SHA-256 归因：

| SHA-256 | 文件 |
|---|---|
| `6d25aa7656feac858f3a3bdaea5bcbab0dbfd426c9de8e6931ce90c399ee8e4f` | `computer-use/1.0.1000387/scripts/computer-use-client.mjs` |
| `e74b67ab909392b37f7aef14977fce7aa80cfa02ade5491f30abcdbcb9e69f33` | browser/chrome `26.707.51957/scripts/browser-client.mjs` |

同一组 hash 也直接出现在本 build 的 `app.asar` 中。因此
Computer Use wrapper 的 trusted 身份不是根据文件名猜测，而是由
Electron 写入的 source hash allowlist 与 kernel 的实际 SHA-256 比较建立。
本实验只计算文件 hash，没有 import 或执行该 wrapper。

路径规则仍然更宽：当前配置把整个用户可写 `~/.codex` 作为 trusted code
root。任何位于该目录下、随后被 untrusted cell 动态 import 的 `.js` /
`.mjs` 都可能跨入 trusted context；这比三个精确 client 文件的 hash pin
具有更大的权限面。

## `process` 禁止边界

两个 VM 都没有 `process` global。module resolver 另设：

```text
deniedBuiltinModules = new Set(["process", "node:process"])
```

原因也写在 shipped source 中：kernel 自身用 stdout/stderr 承载 JSONL，
暴露 raw `process` 会让 cell 污染协议。

live probe 结果：

| 检查 | 结果 |
|---|---|
| `typeof globalThis.process` | `"undefined"` |
| `await import("process")` | `Importing module "process" is not allowed in node_repl` |
| `await import("node:process")` | `Importing module "node:process" is not allowed in node_repl` |

这不是完整 Node sandbox。许多其他 builtin 仍可动态 import；真正的文件、
网络与 socket 约束还取决于 Rust 启动的 OS sandbox 和受控模块解析。

## 四个 Trusted-only Bridge

### `nativePipe`

注入点是 trusted object 的 `nativePipe` own property。公开方法只有
`createConnection(pipePath)`；返回的冻结 wrapper 支持：

```text
write(bytes)
on("data" | "close" | "error", listener)
off(...)
end()
```

调用链：

```text
trusted module
  -> nodeRepl.nativePipe.createConnection(path)
  -> kernel native_pipe_request { id, token, op: "connect", path }
  -> Rust privileged_bridge_request_is_authorized
  -> NativePipeBroker
  -> validate_native_pipe_path
  -> Unix socket connect
```

binary strings 确认 host 至少拒绝：

```text
native pipe request is not authorized
native pipe path must be absolute
native pipe path is not a socket
native pipe path has no parent directory
native pipe path has no file name
native pipe file name is too long
```

同时存在 `NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS` 与
`NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS`。后者参与 kernel OS sandbox 的
socket allowlist；它不能替代 trusted VM 和 token authorization。

本 probe 没有设置该 allowlist，没有引用 socket path，也没有触发
`native_pipe_request`。

### `createElicitation`

注入点是 trusted object 的 `createElicitation(request)`。它要求：

1. 当前 async context 仍对应 active exec。
2. MCP initialize client capabilities 支持 form elicitation。
3. request 是普通对象，只有 `message`、`meta`、`requestedSchema`。
4. `message` 非空。

kernel 发出带 token 和 exec id 的 `elicit` frame。Rust
`handle_elicitation_request` 将它转换成外层 MCP `elicitation/create`，
并可把 turn metadata 合并进 elicitation meta。结果再通过
`elicitation_result` 返回 trusted module。

本 probe 的 initialize capabilities 是空对象，所以即使 trusted code
存在，form elicitation 也应报告 unavailable；普通 cell 更早就因属性不可见
而无法调用。

### `launchServices`

注入点是 trusted object 的
`launchServices.openApplication(target)`。kernel 只接受且必须恰好一个：

```text
applicationPath
bundleIdentifier
```

它发出带 token/exec id 的 `launch_services_action`。Rust binary strings
显示 host 还会验证：

```text
bundle identifier is valid
application path is absolute
application path exists
application path references an .app bundle
```

实际 dispatch 使用 `/usr/bin/open`，并有 `LaunchServices open timed out`
错误路径。普通 cell 看不到 `launchServices`，因此不能直接借此启动 app。

### `withSuspendedTimeout`

注入点是 trusted object 的 `withSuspendedTimeout(fn)`。它要求 active
exec 且参数是 function，然后执行：

```text
send suspend_timeout
try:
  await fn()
finally:
  send resume_timeout
```

Rust `JsRuntimeManager::apply_exec_timeout_event` 在 host 侧处理暂停/恢复。
`finally` 保证 trusted operation 抛错时仍恢复计时。该能力用于用户审批等
host-mediated 等待，不能让普通 cell 任意绕过 `js` timeout。

## Privileged Token 与 Active Exec

kernel 启动时生成 `crypto.randomUUID()` 作为
`privilegedBridgeAuthToken`，先通过 `privileged_bridge_handshake` 交给
Rust host。后续 privileged frame 携带：

```text
token
exec_id
request id
operation-specific payload
```

binary symbol 明确存在：

```text
JsRuntimeManager::privileged_bridge_request_is_authorized
```

binary error strings同时包含：

```text
privileged request is not authorized
native pipe request is not authorized
```

因此 VM 隔离不是唯一防线。即便构造出形似内部 frame 的对象，host 仍有
独立 authorization gate。这里能确认 token、exec id 和 gate 的存在；仅靠
strings/符号不足以完整重建该 Rust predicate 的所有比较条件，不能夸大为已
证明的密码学安全边界。

kernel 的 `getCurrentExecState()` 还要求 AsyncLocalStorage 中的 exec id
等于当前 `activeExecId`。已保存 helper 即使跨 cell 可复用，工具调用结束后
才触发的 async callback 会因为没有 active exec 而失败。

## `emitImage` 为什么不是 Trusted Bridge

`emitImage` 在基础 `nodeRepl` 上，普通 cell 可调用。支持：

```text
data URL
PNG/JPEG/WebP bytes with MIME sniffing
{ bytes, mimeType }
```

kernel 将 bytes 规范化为 data URL，发送 `emit_image` 给 Rust host；host
验证必须是 `image/*` data URL，再返回 `emit_image_result`。外层 MCP
response 得到 image content。

probe 使用内存中的 1x1 PNG，不读磁盘：

```text
MIME: image/png
bytes: 68
width: 1
height: 1
SHA-256: 431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460
detail: original
```

返回 result 同时含 text `"image-emitted"` 与 image content。该路径证明
普通 cell 可以把已经持有的图像 bytes 回传给模型，但不自动赋予截图、文件
读取或 native service 访问权。

## Probe 的安全约束

`scripts/node-repl-mcp-probe.mjs` 使用精确 allowlist 环境启动子进程，只含：

```text
HOME
PATH
TMPDIR
NO_COLOR
NODE_REPL_NODE_PATH
NODE_REPL_DISABLE_ANALYTICS
NODE_REPL_UNTRUSTED_ENV_ALLOWLIST
```

明确不继承：

```text
CODEX_CLI_PATH
NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S
NODE_REPL_TRUSTED_CODE_PATHS
NODE_REPL_TRUST_ALL_CODE
NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS
```

这与上面的真实 desktop 环境不同：probe 故意删除所有 trust 配置，避免
任何本地文件被提升为 trusted module。它也不设置 `CODEX_CLI_PATH`，因此
该实验验证 MCP/kernel/VM 边界，不声称覆盖 desktop 通过 Codex CLI 建立的
OS sandbox 行为。

probe source guard 会拒绝 wrapper import、`nativePipe.createConnection`、
elicitation、LaunchServices、timeout suspension、privileged config/fetch、
network module 和 `computeruse.sock` 字样。客户端若收到任何 server-to-client
JSON-RPC request 也会立即终止；因此测试不会代答 elicitation。

运行：

```bash
node scripts/node-repl-mcp-probe.mjs
node --test tests/node-repl-mcp-probe.test.mjs
```

输出：

```text
fixtures/node-repl/probe.json
fixtures/node-repl/transcript.json
```

## 证据强度与剩余未知

**直接确认：**

- embedded `kernel.js`、`privileged-node-repl.js` 和 config bridge 源码；
- Mach-O strings、Rust symbols、linked frameworks、签名和 entitlements；
- 真实 MCP initialize、tools/list 与 tools/call wire；
- ordinary surface、`process` 拒绝、binding persistence、内存 PNG；
- probe 没有加载 wrapper 或调用 native socket。

**工程推断：**

- token 加 active-exec 形成 defense in depth；
- trusted importer 的依赖继承会扩大 trusted entrypoint 的有效权限范围；
- 宽泛用户可写 trusted path 比精确 hash 或只读 version root 风险更高。

**本实验刻意未验证：**

- 真实 Computer Use wrapper 执行后怎样组合这些 trusted-only API；
- `computeruse.sock` 的 connect、peer authorization 和真实协议；
- elicitation UI、LaunchServices dispatch 或 timeout suspension 的 live
  side effect；
- Rust authorization predicate 的每个机器指令分支。

这些未知不能通过“为了验证”而加载真实 wrapper 或连接真实 socket；应在
fake trusted module、fake Unix socket 或可审计 source build 中单独实验。

## V6: Wrapper Module Resolution

The wrapper iterates:

```text
nodeRepl.env.NODE_REPL_NODE_MODULE_DIRS
```

and imports the first loadable deep `@oai/sky` `create_client.js` path.

It checks that `create_client` is a function. It does not pin package version,
hash, code signature, or a required ChatGPT bundle root.

The current active root is:

```text
/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules
```

which is inside the signed app bundle. Resolution precedence is nevertheless a
trusted configuration boundary.

`SKY_CUA_NATIVE_PIPE_PATH` can similarly redirect transport. The JavaScript
client validates API version with `ping`; it does not authenticate peer code
signing identity.

Direct Sky import from an ordinary cell is not a bypass. First use still fails
without the trusted `nodeRepl.nativePipe`.

## V6: Trusted Path Breadth

Current desktop configuration:

```text
NODE_REPL_TRUSTED_CODE_PATHS=/Users/haoqing/.codex
```

## V9: Trusted Root Dynamic Proof

The timeout experiment created one temporary module directly below
`~/.codex`, outside the bundled plugin cache. Because the whole directory is a
trusted code root, importing that module gave it trusted `nodeRepl` access and
allowed it to construct the shipped internal `MacComputerUseClient`.

The helper was SHA-256 pinned by the experiment, limited to the packaged
`@oai/sky` module and a maximum 250 ms timeout, and deleted immediately after
the fixture was written.

This dynamically proves the risk boundary:

```text
write arbitrary local module below ~/.codex
  -> dynamic import
  -> trusted VM
  -> nativePipe-capable code
```

The plugin wrapper itself remains hash pinned. The broader path trust is the
problem. A hardened design should trust exact signed/versioned modules or
content hashes, not the entire user-writable Codex home.

Trust is path based. Imported JavaScript accepted under this root can run in
the trusted realm and access trusted bridges available there.

The integrity boundary therefore covers the configured trusted tree, not only
the bundled Computer Use wrapper. This does not mean arbitrary untrusted code
is promoted; it means files accepted by the configured trusted-path predicate
must be treated as privileged code.
