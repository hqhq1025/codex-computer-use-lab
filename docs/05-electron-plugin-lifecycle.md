# Electron / Plugin Lifecycle

> 运行态补充：当前 service/Guardian 父子关系、launchd unmanaged 边界、
> canonical refresh 时序和 native owner/idle lifecycle 见
> `16-service-process-lifecycle-and-retention.md`。

本章只讨论 Electron 负责的 Computer Use 安装、迁移、配置、审批、
持久化和进程拉起链。执行协议、AX、截图和输入注入属于其他章节。

取证对象是本机 `26.707.51957` 构建：

```text
/Applications/ChatGPT.app/Contents/Resources/app.asar
```

配套脚本不展开整个 ASAR。它解析 header 中的文件 offset，只选择三个
JavaScript 文件角色：

1. `.vite/build/main-*.js`：Electron main process。
2. `webview/assets/computer-use-settings-*.js`：Computer Use 设置页。
3. 含 `composer.computerUseAppApproval.action.alwaysApprove` 的
   `webview/assets/app-initial*.js`：逐应用审批 UI。

当前三个文件合计不到 ASAR 的 10%，输出 fixture 小于 100 KiB，也不读取
或复制本地化 chunk。

## 1. Bundled Plugin 到 Cache

App bundle 中的原始插件位于：

```text
$APP/Contents/Resources/plugins/openai-bundled/plugins/computer-use
```

原始 `plugin.json` 只有版本和通用入口，没有
`bundledContentVariant`。Electron 在 materialize bundled marketplace
时执行以下链：

```text
source marketplace
  -> staging marketplace
  -> copy_plugins
  -> Eo(...)
  -> copy .codex-plugin/computer-use-node-repl.md
       to skills/computer-use/SKILL.md
  -> rewrite plugin.json with bundledContentVariant
  -> replace_target
  -> rename_staging
  -> app-server installPlugin
  -> $CODEX_HOME/plugins/cache/openai-bundled/computer-use/<version>
```

当前 minified 证据：

| 主题 | 当前符号附近 | 稳定字符串 |
|---|---|---|
| marketplace 物化 | `Ac` / `Eo` | `copy_plugins`, `replace_target`, `rename_staging` |
| Node variant | `Eo` | `computer-use-node-repl.md`, `bundledContentVariant` |
| feature 选择 | `jl` | `computerUseNodeRepl ? "node-repl" : "legacy-mcp"` |

运行态对照：

```text
source manifest bundledContentVariant = absent
cache manifest bundledContentVariant  = node-repl
cache skills/computer-use/SKILL.md    = present
```

这证明 `node-repl` 不是原始插件 manifest 的固定属性，而是 Electron 根据
当前 desktop feature availability 在 cache materialization 时写入的变体。

## 2. 旧 Local Plugin 迁移

`ComputerUseLocalToBundledMigration` 的 minified 主函数附近为 `Go` / `Ko`。
它只在找到旧的 local Computer Use 安装后运行：

1. 查找 bundled `computer-use`。
2. 查找 `$CODEX_HOME/plugins/computer-use` 对应的旧 local plugin。
3. 对已签名公证 App 或有正 build number 的版本执行迁移。
4. 调用 app-server `uninstallPlugin`。
5. 将旧 plugin root 移到废纸篓。
6. 删除旧 marketplace entry。
7. 从 `config.toml` 删除指向旧 local path 的
   `[mcp_servers.computer-use]` 和旧 notify。
8. 如 bundled plugin 尚未安装，调用 `installPlugin`。

未签名且没有 build number 的开发构建会命中
`local_computer_use_plugin_kept_for_development`，不会被迁走。

这里要区分两件事：

- **local -> bundled migration** 清理历史 local 安装。
- **bundled -> cache materialization** 为当前构建生成版本化 cache。

它们不是同一个复制步骤。

## 3. `config.toml` 写入和 Legacy MCP

Electron 根据 feature availability 生成 thread config，然后通过：

```text
appServerConnection.sendAppServerRequest(
  "config/batchWrite",
  { edits, reloadUserConfig: true }
)
```

写回用户配置。Node REPL 分支生成：

```text
[mcp_servers.node_repl]
command = "$APP/Contents/Resources/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE = "..."
SKY_CUA_SERVICE_PATH = "$HOME/.codex/plugins/cache/.../Codex Computer Use.app"
```

同一生成逻辑还合并一个 legacy MCP stanza：

```text
[mcp_servers.computer-use]
command = "./Codex Computer Use.app/.../SkyComputerUseClient"
args = ["mcp"]
cwd = "."
enabled = false
```

关键静态常量是：

```text
pr = { "mcp_servers.computer-use": { ..., enabled: false } }
```

因此当前的 `enabled = false` 不是偶然残留。Electron 在 Node REPL 路径中
显式保留兼容入口，但禁用 legacy MCP。当前运行态同时确认：

```text
plugins."computer-use@openai-bundled".enabled = true
mcp_servers.node_repl                     = enabled by presence
mcp_servers.computer-use.enabled          = false
SKY_CUA_SERVICE_PATH                      = versioned plugin cache
```

## 4. Canonical App 和 Sky 进程

插件 cache 里的原生 App 不是 Electron 最终执行的路径。启动时 main process
先找 bundled Computer Use App，再执行：

```text
ditto --noqtn <cache-or-bundled-app>
  $CODEX_HOME/computer-use/Codex Computer Use.app
```

相关 minified 符号当前为 `mee` / `Hl` / `Ul`。目标目录在复制前会被删除，
因此它是 canonical refresh，不是增量覆盖。环境变量
`CODEX_ELECTRON_SKIP_COMPUTER_USE_CANONICAL_REFRESH=1` 可跳过该步骤。

随后 `Wl` manager：

1. 将可执行文件固定为 canonical App 内的 `SkyComputerUseService`。
2. 根据 `appshotsEnabled || nodeReplEnabled` 决定是否启用。
3. 复用仍在运行且 executable path 匹配的 PID。
4. 否则调用 native addon 的 `spawnComputerUseService(path)`。
5. 校验返回 PID，失败时抛出
   `Failed to spawn managed Computer Use service`。

2026-07-12 的运行态对照：

```text
ChatGPT
├─ codex ... app-server
└─ $HOME/.codex/computer-use/.../SkyComputerUseService
```

两者都由 Electron main process 直接拉起。source、plugin cache 和 canonical
三份 `SkyComputerUseService` 的 SHA-256 当前相同。

## 5. 逐应用审批

Computer Use app approval 使用专门的 UI，不应和 shell approval 或 Browser
Use 下载审批混为一谈。

当前 UI chunk 的 `zRa` 附近显示：

```text
title:  Allow ChatGPT to use {appDisplayName}?
primary: Allow this conversation
leading: Always allow
deny: decline
```

响应语义：

```text
Allow this conversation
  -> accept
  -> persist = "session"（仅当服务声明支持 session）

Always allow
  -> accept
  -> persist = "always"

Deny
  -> decline
```

renderer 通过 `reply-with-mcp-server-elicitation-response` 回传
`{ persist }`。main process 的 schema 只接受 `always | session`，并将结果记录
为 `approvalPersistence = result._meta.persist`。

### Always 持久化

macOS store 路径由 main process 拼出：

```text
$HOME/Library/Group Containers/
  2DC432GLL2.com.openai.sky.CUAService/
  Library/Application Support/Software/
  ComputerUseAppApprovals.json
```

JSON schema：

```json
{
  "approvedBundleIdentifiers": [
    "com.example.App"
  ]
}
```

设置页的 **Always-allowed apps** 读取这个 store，并允许按 bundle identifier
删除。删除后 UI 明确提示：下一次 Computer Use session 会重新询问。

fixture 只记录 store 是否存在和文件大小，不读取 bundle identifier 内容。
当前机器取证时 store 不存在，表示当前没有已落盘的 always allow 列表；这不否定
本次 conversation/session 内存授权。

Windows 使用 `config.toml` 中的
`computer_use.windows.always_allowed_app_ids`，与 macOS JSON store 不同。

## 6. Locked Use 安装器

设置页通过以下 main-process RPC：

```text
computer-use-background-auth-read
computer-use-background-auth-write
```

后者执行 canonical App 中的：

```text
Codex Computer Use Installer install|uninstall|status
```

`status` 只有输出严格等于 `OK: installed` 才视为启用。设置页文案为：

```text
Locked use
Let ChatGPT use your Mac when it's locked.
```

当前只读检查返回：

```text
OK: not-installed
```

这条安装器链负责锁屏 Authorization Plugin / guardian，是普通
`SkyComputerUseService` 之上的附加能力。当前 Sky 服务正在运行，并不表示
Locked use 已安装。

## 7. Sound、PiP 和设置持久化

### Click sound

设置页提供三个值：

```text
foregroundClicks
foregroundAndBackgroundClicks
off
```

main process 使用 macOS defaults：

```text
domain = com.openai.sky.CUAService
key    = computerUseSoundMode
```

读写分别调用 `/usr/bin/defaults read|write`。当前 defaults 中没有显式值，
renderer 会回退到 `foregroundClicks`。

### Picture in picture

设置页的 **Always hide picture in picture** 写入 Electron settings store，
对应 `config.toml`：

```toml
[desktop]
computerUseAlwaysHidePictureInPicture = false
```

main process 只有在 `cuaPIP` feature 开启且该值不为 `true` 时启用 remote
hosted PiP。设置变化会立即触发 `reconcileEnabledState` 和 PiP content host
重对齐。

## 8. 可复现提取

```bash
node scripts/extract-electron-cu-evidence.mjs
node --test tests/electron-evidence.test.mjs
```

输出：

```text
fixtures/electron/evidence.json
```

每个 static topic 包含：

- ASAR 内文件名；
- anchor 的 file-relative offset；
- 附近可恢复的 minified symbol；
- 必须同时出现的 marker；
- 归一化单行上下文。

测试不把 hash chunk 文件名当稳定 API，而是检查角色、anchor、marker、运行态
配置和 source/cache/canonical 对照。版本漂移时应重新生成 fixture，并先审查
上下文差异，不应直接手改旧 fixture。

## 9. Result-Time Computer Use Identity

Desktop identifies a completed `node_repl` MCP item as Computer Use only when
the result contains:

```text
_meta["codex/toolSurface"].kind = "computerUse"
```

The started item has no result, so this is result-time late binding.

The app-server event copy has a fixed serialized `CallToolResult` cap:

```text
1,048,576 bytes
```

At or below the cap, metadata is retained. Above it, the event result is
collapsed to one text preview and both `structuredContent` and `_meta` are
cleared. Desktop then renders the completed call as a generic `node_repl` MCP
call even if the preview text still contains the literal metadata key.

Checked fixture:

```text
fixtures/electron/mcp-event-truncation.json
```

The model wire follows different rules:

- non-null structured content replaces ordinary content;
- image-capable models receive content items;
- text-only models receive an image-omitted text placeholder;
- top-level MCP `_meta` does not enter `FunctionCallOutput`.

Remote Android/iOS `thread/resume` applies an additional response-only
redaction: MCP arguments/result/error are replaced, result metadata is cleared,
and image-generation items are removed.
