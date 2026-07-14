# Codex App Computer Use 全链路逆向 V10

## 0. 本轮结论

V10 不重复 V9 已经闭环的模型、MCP、Node trust boundary、Sky pipe、AX、
ScreenCaptureKit、CGEvent、Guardian 和 Electron rendering 全链路。

本轮专门关掉两个长期未决问题：

1. `SystemSoftware.ApplicationTarget.identifier(for:)` 到底如何从 URL 生成；
2. 同一 target 的 `AppInstance` / `AppController` / `lastAXTree` 到底何时复用、
   何时替换。

新增确认：

1. `identifier(for:)` export `0x1001e6624` 只是 trampoline，真实 body 是
   `0x1001e9128`。
2. identifier 是：

   ```swift
   bundleURL
     .resolvingSymlinksInPath()
     .standardizedFileURL
     .path(percentEncoded: false)
   ```

   再循环去掉尾部 `/`，但保留根目录 `/`。
3. identifier 不是 bundle ID、PID、hash、URL absoluteString 或 conversation ID。
4. `ApplicationTarget.init` 会预先 canonicalize bundle URL，并把 identifier
   缓存在 struct 字段里；getter 只是读取，不会每次重新访问文件系统。
5. symlink alias、dot segments、百分号编码和尾斜杠会收敛到同一 key。
6. 同 bundle ID 的两个真实安装副本若 canonical path 不同，仍是两个独立 target。
7. bundle-ID 解析使用 `URLsForApplicationsWithBundleIdentifier:` 和
   `runningApplicationsWithBundleIdentifier:`。
8. 多候选时 fail closed，抛 `ambiguousBundleIdentifier`，不会取第一个。
9. `resolveApplicationTargetPreferringRunningApplication` 只是在有运行副本时优先
   使用运行候选集；运行副本仍然多个时照样报歧义。
10. manager 中已有实例且 `runningApplication.isTerminated == false` 时，原
    `AppInstance` 和原 `AppController` 直接复用。
11. 只有 app 进程真的 terminated，才移除旧实例、释放旧 controller、创建新
    controller + instance + serial executor。
12. conversation cleanup 只 deactivate，保留 `lastAXTree`；app 退出重启则通过
    controller replacement 把旧 baseline 清掉。
13. manager 的底层容器是锁保护的 `Array<AppInstance>`，identifier 是线性查找和
    去重键，不是 Swift Dictionary。
14. canonicalizer 还被 AppUsageCatalog、Spotlight app catalog 和
    UserInteractionMonitor 复用。
15. Codex `turn-ended` helper 的 transport 是 Apple Event bridge，不是 Node
    client 的普通 socket 入口。
16. natural Codex turn 已动态确认 `agent-turn-complete -> helper -> Apple Event ->
    native turn-ended -> lock-screen active-thread cleanup`。
17. app target deactivate/reactivate 仍未动态确认；no-change diff 不能区分“没
    deactivate”和“deactivate 后 reactivate”。

因此 native 状态的准确 lifetime 是：

```text
canonical app installation path
  + current live NSRunningApplication process instance
```

它比 socket、Node kernel、thread、conversation 更长，但不会跨真正的 app
进程重启。

## 1. 固定样本

```text
Desktop:
  /Applications/ChatGPT.app

Desktop bundle id:
  com.openai.codex

Desktop version:
  26.707.62119 (5211)

app.asar SHA-256:
  165db3a1d32009724fcb91427a73926fe8de2a1e24141d5f1e24951d120424f7

bundled codex SHA-256:
  74644ef80b107e905f5a5226d83ff664dd1bf9bdd0af3c249155cb82225c355d

bundled codex runtime version:
  0.144.2

matching source snapshot used by current probes:
  rust-v0.144.0-alpha.4
  049586f41571e74b44c841868bca3a2233214a71

node_repl SHA-256:
  6e895795c6506cb6e4ff24ccca87625fbae6555309534e2fc242423b46f622fa

native service:
  ~/.codex/computer-use/Codex Computer Use.app

native service version:
  26.710.1000387

native service UUID:
  9E40FA2F-FC6C-3EE2-824A-E4975CA022AD

native service SHA-256:
  27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58
```

2026-07-13 当前桌面壳已经是统一的 `ChatGPT.app`，不是
`/Applications/Codex.app`。旧路径只能当历史证据，不能作为当前运行样本。

本轮验证期间 Desktop 从 `26.707.61608 (5200)` 自动更新到
`26.707.62119 (5211)`。发生漂移：

```text
app.asar
bundled codex packaging
node_repl binary
Electron chunk names and offsets
```

保持不变：

```text
Computer Use plugin 1.0.1000387
wrapper SHA-256 6d25aa...
native service SHA-256 27b547...
identifier and AppInstance addresses
Electron semantic contracts
```

`codex --version` 与 probe 使用的匹配源码快照版本字符串不同，因此本文分别记录
runtime version 和 source snapshot，不把它们表述为同一个事实。

## 2. identifier 的逐指令恢复

### 2.1 Export 与真实 body

```text
0x1001e6624:
  b 0x1001e9128
```

所以：

```text
public symbol:
  static ApplicationTarget.identifier(for: URL) -> String

actual implementation:
  redacted function 11073 @ 0x1001e9128
```

### 2.2 Foundation pipeline

body 中前三个关键调用：

```text
0x1001e919c -> stub 0x100ccdaf0
0x1001e91a8 -> stub 0x100ccda48
0x1001e91c4 -> stub 0x100ccdb44
```

stub 的 GOT：

```text
0x100ccdaf0 -> GOT 0x100EFE760
0x100ccda48 -> GOT 0x100EFE6D0
0x100ccdb44 -> GOT 0x100EFE798
```

`dyld_info -fixups`：

```text
0x100EFE760
  Foundation.URL.resolvingSymlinksInPath()

0x100EFE6D0
  Foundation.URL.standardizedFileURL

0x100EFE798
  Foundation.URL.path(percentEncoded:)
```

`0x1001e91bc` 在 `path(percentEncoded:)` 前把 `w0` 设为 `0`，所以参数是
`false`。

### 2.3 尾 slash loop

后半段 import：

```text
0x100F01478 -> String.count
0x100F01488 -> String.index(before:)
0x100F014D8 -> String.remove(at:)
0x100F01598 -> String.hasSuffix(_:)
```

控制流：

```text
count < 2
  -> return

hasSuffix("/") == false
  -> return

otherwise
  -> index(before: endIndex)
  -> remove(at:)
  -> repeat
```

`count > 1` 的 guard 保证根目录 `/` 不会被裁成空字符串。

### 2.4 恢复源码

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

## 3. ApplicationTarget 的内存语义

### 3.1 Struct 字段

公开 metadata 显示：

```text
bundleIdentifier: String
bundleURL: URL
identifier: String
```

getter：

```text
bundleURL getter    0x1001e6484
identifier getter   0x1001e6508
```

### 3.2 初始化顺序

`ApplicationTarget.init(bundleIdentifier:bundleURL:) @ 0x1001e6544`：

```text
store bundleIdentifier
  -> resolvingSymlinksInPath
  -> standardizedFileURL
  -> store canonical bundleURL
  -> identifier(for: canonical bundleURL)
  -> store identifier
```

这说明 identifier 是 eager cached field。

后续 manager lookup 不会因为 symlink 被重新指向就自动改变已有 target 的 key。
只有重新解析并构造一个新的 `ApplicationTarget` 才会重新 canonicalize。

### 3.3 其他调用者

| Callsite | Consumer |
|---|---|
| `0x1000547e8` | AppUsageCatalog running/installed catalog |
| `0x100056b98` | Spotlight `kMDItemPath` catalog |
| `0x100057edc` | AppUsageCatalog `.app` fallback |
| `0x1000a99f0` | UserInteractionMonitor `resolveTarget` |
| `0x1001e65e4` | ApplicationTarget initializer |
| `0x1001e6d1c` | bundle path target construction |
| `0x1001e76c8` | running app URL identity comparison |
| `0x1001e7870` | running app target construction |

因此 app discovery、running-app matching、user interruption 和 manager lookup
使用相同 canonical identity。

## 4. 行为矩阵

本轮新增 Swift probe：

```text
scripts/application-target-identifier-probe.swift
```

它只在 `/tmp` 创建 fixture：

```text
Real App.app
Alias.app -> Real App.app
Second App.app
```

结果：

| Case | identifier |
|---|---|
| real | `/tmp/.../Real App.app` |
| symlink alias | `/tmp/.../Real App.app` |
| `./temporary/../Real App.app/` | `/tmp/.../Real App.app` |
| `Real%20App.app/` | `/tmp/.../Real App.app` |
| root | `/` |
| second physical path | `/tmp/.../Second App.app` |

当前默认 APFS 上，大小写变体输入也恢复成磁盘真实 spelling。这里不是算法显式
lowercase，而是 Foundation 对已存在路径进行解析的结果。

## 5. NSWorkspace 解析链

### 5.1 Path 输入

`0x1001e6bcc`：

```text
NSBundle.init(path:)
  -> bundleIdentifier
  -> ApplicationTarget(bundleIdentifier: bundleURL:)
```

path 不是合法 app bundle 或取不到 bundle ID 时失败。

### 5.2 Installed candidates

`NSWorkspace.applicationTargets(withBundleIdentifier:) @ 0x1001e6dbc`：

```text
NSWorkspace.URLsForApplicationsWithBundleIdentifier:
  -> each URL -> ApplicationTarget
```

### 5.3 Running candidates

`runningApplicationTargets(withBundleIdentifier:) @ 0x1001e7548`
跳到 `0x1001e956c`：

```text
NSRunningApplication.runningApplicationsWithBundleIdentifier:
  -> each running app.bundleURL
  -> ApplicationTarget
```

### 5.4 Merge 与去重

installed 与 running candidates 最后都基于 `ApplicationTarget.identifier` 去重。

所以：

```text
same physical app via symlink / real path
  -> one target

same bundle ID at two canonical paths
  -> two targets
```

## 6. 候选选择是 fail closed

候选 resolver：

```text
0 candidates:
  appNotFound

1 candidate:
  return candidate

multiple candidates:
  ambiguousBundleIdentifier
```

错误文案：

```text
Ambiguous app identifier '<input>'.
Multiple apps share this bundle identifier: <canonical paths>.
Use an app name or full app path instead.
```

这排除了：

```text
first installed app wins
first running PID wins
lexicographically first path wins
random NSWorkspace order wins
```

`resolveApplicationTargetPreferringRunningApplication`：

```text
running candidates non-empty
  -> resolve only among running candidates

running candidates empty
  -> normal installed/path/name resolution
```

若两个同 bundle ID 副本都在运行，仍然 ambiguous。

## 7. Manager key 的真实碰撞域

```text
ComputerUseAppInstanceManager.shared
  lock-protected Array<AppInstance>
    -> linear lookup by canonical filesystem path
    -> replace duplicate then append
       -> SerialExecutor
       -> AppController
       -> lastAXTree
```

因此：

1. symlink alias 不形成隔离；
2. 同一真实 app 的多个启动入口共享 native state；
3. 同 bundle ID 的两个物理副本互相隔离；
4. manager key 不含 PID，所以同一路径的 app 重启仍先命中旧 entry；
5. 命中后再通过 `runningApplication.isTerminated` 判断旧 entry 是否还能复用。

## 8. AppInstance 的复用与替换

### 8.1 Request slow path

入口 body：

```text
0x10013fbd8
```

lookup：

```text
0x100140008
  -> manager state lookup by target identifier
```

### 8.2 Existing live process

```text
0x100140050
  -> read existing AppInstance.appController
  -> read controller.runningApplication

0x10014006c
  -> objc isTerminated

0x100140070
  -> if false, branch directly to return
```

这条分支不调用 appController setter，也不直接覆盖 controller field。

全程序 static scan 也只发现 setter 的定义，没有生产调用点。

### 8.3 Terminated process

若 `isTerminated == true`：

```text
0x100140080
  clearUserInterruptedIntervention

0x1001400a8
  remove old manager entry

0x1001400d8
  deactivate/release old instance

0x10014015c
  allocate AppController

0x10014018c
  initialize AppController

0x1001401bc
  allocate AppInstance

0x100140200
  initialize new SerialExecutor

0x100140234
  store new controller into new instance

0x100140258
  insert replacement instance into manager
```

不是原地改 controller，而是整套 replacement。

## 9. lastAXTree 的精确生命周期

已有事实：

```text
lastAXTree owner:
  AppController

conversation end:
  deactivate AppInstance
  does not remove manager entry
  does not clear lastAXTree
```

V10 新事实：

```text
same live process:
  same instance
  same controller
  same lastAXTree

terminated process:
  remove old instance
  release old controller
  allocate new controller
  new controller initializes lastAXTree = nil
```

所以：

```text
Node kernel reset
socket reconnect
new MacComputerUseClient
new conversation
conversation cleanup deactivate/reactivate
  -> baseline survives

actual target app quit and relaunch
  -> baseline does not survive
```

## 10. 对并发模型的影响

同 target：

```text
canonical path equal
  -> one AppInstance
  -> one SerialExecutor.tail
  -> actions serialized
```

不同物理副本：

```text
canonical path differs
  -> independent AppInstances
  -> independent executor tails
  -> native operations may overlap
```

官方 use-case 文档建议不要让两个 Computer Use task 同时操作同一个 app。V10 的
本地实现解释了为什么：同一 target 最终汇聚到同一个 manager entry 和串行
executor；conversation 本身不是隔离边界。

## 11. 安全含义

### 11.1 Symlink 不是隔离边界

若两个授权/调用路径最终指向同一真实 app：

```text
different textual path
  -> resolvingSymlinksInPath
  -> same canonical identifier
  -> shared native state
```

### 11.2 Bundle ID 不是 instance key

这避免了同 bundle ID 的开发版、正式版、复制版天然共享 baseline。

但 wrapper approval/UI 仍主要以 bundle ID 和 display name 表达；native manager
则按 path 隔离。两个层次的 identity granularity 不完全相同。

### 11.3 Cached identifier 有 TOCTOU 边界

target 构造后 symlink 改指向：

```text
cached identifier remains old canonical path
```

后续真正 action 使用哪个 running application / PID，取决于 controller 已经绑定的
target 和 process，不会仅因 symlink 文件变化自动重定向。

重新解析 target 后才会生成新 key。

### 11.4 Process death 是 freshness reset

进程重启会强制 controller replacement，也顺便清掉旧 element baseline。

这是比 conversation cleanup 更强的 freshness boundary。

## 12. 新增可复现产物

```text
scripts/application-target-identifier-static-probe.mjs
scripts/application-target-identifier-probe.swift
tests/application-target-identifier.test.mjs

fixtures/native/application-target-identifier-static.json
fixtures/native/application-target-identifier-behavior.json

docs/26-application-target-identity-resolution-and-process-lifetime.md
```

同时扩展：

```text
scripts/native-app-instance-contract-probe.mjs
tests/native-app-instance-isolation.test.mjs
fixtures/native/app-instance-isolation.json
docs/22-native-ax-diff-refetch-and-instance-isolation.md
```

## 13. 复现命令

```bash
cd codex-computer-use-lab

npm run collect:application-target-identifier-static
npm run collect:application-target-identifier-behavior
npm run collect:native-instance

node --test \
  tests/application-target-identifier.test.mjs \
  tests/native-app-instance-isolation.test.mjs
```

完整：

```bash
npm run verify
npm run reproduce
```

## 14. 公开契约与本地私有实现

截至 2026-07-13，OpenAI 官方文档公开承诺：

- Codex Computer Use 在受支持地区可用于 macOS 和 Windows；
- 安装面公开为 plugin + Computer Use server + skill；
- macOS 需要 Screen Recording 和 Accessibility；
- Computer Use 可以看、点、输入和跨 app 工作；
- 每个应用首次使用时单独批准，Always allow 可撤销；
- Windows 需要目标 app 位于 active desktop；
- macOS 支持 scoped background task 和显式启用的 locked use；
- 不自动化 terminal app 或 ChatGPT 自身，也不能批准系统隐私权限；
- Codex 于 2026-07-09 并入 ChatGPT 桌面应用。

官方资料：

- https://learn.chatgpt.com/docs/computer-use
- https://learn.chatgpt.com/docs/changelog
- https://learn.chatgpt.com/use-cases/use-your-computer-with-codex
- https://developers.openai.com/api/docs/guides/tools-computer-use

官方没有公开承诺：

- Codex App 当前通过 `node_repl` + custom Sky facade 而不是 Responses built-in
  computer tool；
- canonical path manager key；
- symlink、percent decoding 和 trailing slash 规则；
- bundle ID ambiguity 的具体 fail-closed 算法；
- conversation 间共享 `lastAXTree`；
- app termination 才 replacement controller。

这些结论只对本文固定的本机 build 有证据，不应当当作稳定公开 API。

Responses API 的 built-in `computer` 是另一层协议：

```text
model computer_call/actions[]
  -> developer-owned harness executes actions
  -> developer captures screenshot
  -> computer_call_output
```

它不是托管桌面，也不能反推 Codex App 使用同一 wire。当前本机证据仍显示 Codex
App 是 deferred `tool_search` -> `node_repl.js` -> Sky facade -> native service。

## 15. 剩余真正值得挖的点

V9 的第 8 项已经关闭，旧第 11 项也基本关闭。当前剩余：

1. debugger pointer 级确认两个 live client 的 AppInstance/controller/executor
   地址完全一致；
2. mixed 1x/2x display 真机坐标变换；
3. OOP WebContent 最终 target PID 的函数级动态 tracing；
4. virtual cursor overlay 的单独视觉 witness；
5. Guardian rendezvous capability 是否可被同用户非预期进程稳定获得；
6. Parent launch constraint 未进入成品签名的构建/安装原因；
7. natural Guardian restart 是否消费 constraint resource；
8. Responses 服务端 deferred `tool_search_output` 的 private enablement；
9. 当前 production request 中显式 Computer Use SKILL body 的逐字节 wire capture；
10. target 构造后 app bundle 被移动、替换或 inode 变化时，cached path identity 与
    running process binding 的动态行为；
11. 同 bundle ID 两个副本同时运行时，从 wrapper 到 native error surface 的完整
    UI 呈现。

## 16. turn-ended helper 与生命周期 gate

helper：

```text
SkyComputerUseClient turn-ended [--previous-notify ...] <payload>
```

Codex legacy notify 是 fire-and-forget：

```text
spawn helper
redirect stdio to null
do not wait
```

helper 将：

```json
{
  "type": "agent-turn-complete",
  "thread-id": "...",
  "turn-id": "..."
}
```

解成：

```json
{
  "threadID": "..."
}
```

再通过 Apple Event request envelope 发送
`ComputerUseIPCCodexTurnEndedRequest`。

natural observation-only turn 已动态看到：

```text
Received lock-screen turn end
removedActiveThread=true
```

这闭环了 lock-screen lease cleanup，但没有看到：

```text
Deactivated Computer Use for ended Codex thread
Failed to deactivate Computer Use for ended Codex thread
```

所以 target tracker cleanup 与 app deactivate/reactivate 仍不能动态声称。

V9 harness 原本错误地要求：

```text
Codex thread ended or stopped conversationID=...
```

该日志属于 app-server thread-stream observer，不属于 helper IPC hard gate。

V10 harness 改为：

```text
wait after helper dispatch
  -> Received lock-screen turn end removedActiveThread=true
  or Deactivated Computer Use...
  or Failed to deactivate Computer Use...
```

并显式记录：

```text
no-change AX diff != reactivate proof
```

## 17. 防休眠

当前已确认：

```text
pid:
  34984

command:
  /usr/bin/caffeinate -dimsu

PreventUserIdleDisplaySleep:
  1

PreventUserIdleSystemSleep:
  1

PreventSystemSleep:
  1
```

该断言阻止自动息屏、idle sleep 和 system sleep，但不会绕过手动锁屏。

## 18. 验证状态

验证日期：

```text
2026-07-13
```

结果：

```text
npm run verify:
  191 / 191 passed

npm run reproduce:
  All available reproduction steps completed
  191 / 191 passed

secret scan:
  No secret-like text detected in docs or fixtures
```

统一复现已包含：

```text
application-target identifier static probe
application-target identifier Swift behavior probe
AppInstance/controller process-lifetime probe
current 5211 Electron presentation fixture
current node_repl fixture
all prior native, protocol, policy, security and dry-run probes
```

人工 `turn-ended` lifecycle harness 仍故意不进入 `npm run reproduce`，因为它会
连接真实 service lifecycle 入口。其当前动态结论和未决边界已经单独记录，不能用
普通 no-change diff 替代 deactivate/reactivate 证据。
