# Screenshot、PiP、Skysight/Event Stream 与 Telemetry 边界

> 运行态补充：最近两小时观察到 remote-hosted PiP publish 生命周期；当前
> `Analytics.db` 事件队列为 0 行但保留 identity rows，Statsig local storage
> 仍持久。聚合证据见 `16-service-process-lifecycle-and-retention.md`。

## 范围与隐私约束

本章针对本机 `ChatGPT 26.707.51957` 与
`SkyComputerUseService 26.710.1000387`，只调查：

- 签名包内的方法/类型符号和资源文件元数据；
- 缓存、临时目录和数据库的路径模板；
- 当前进程的 FD 类别与文件 owner/mode/count/mtime/size 聚合；
- Statsig client API、Skysight prompt 资源存在性、Event Stream 请求类型；
- Remote-hosted PiP 的 producer/host XPC 边界。

采集器不读取截图像素、Event Stream JSONL、URL、analytics body 或私人日志，
也不连接真实 `computeruse.sock`。因此本章能证明“代码和 gate 存在”以及部分
运行时文件已打开，不能据此声称某功能当前正在录制或正在发送网络请求。

## 1. 四类对象不是同一条数据链

| 对象 | 主要用途 | 存储/传输边界 | 当前启用 |
|---|---|---|---|
| Skyshot screenshot | 单次 Computer Use 观察附件 | `CGImage` -> `SlimCore.ScreenshotFile` -> attachment | 是否有临时文件：运行快照；是否正在截图：未知 |
| Appshot | 用户主动截取并附加的 capture UX | 内存 `AppshotCaptureStore`；final frame 可生成 `ScreenshotFile` | `appshotsEnabled` gate 存在；当前值未知 |
| Skysight | 持续 recent-activity 观察和摘要 | 订阅 Event Stream capture，写临时 segment，再跑 memory pipeline | feature/approval/exclusion gate 存在；当前状态未知 |
| Event Stream / Record & Replay | 显式开始、最长有限时长的动作录制 | 独立 start/status/stop request，写 session JSONL/metadata | `recordAndReplay` gate 存在；当前状态未知 |
| Analytics / Statsig | 产品事件队列、transport 与 feature evaluation | `Analytics.db`、Datadog transport、Statsig client | 本地 DB 打开可观测；初始化和网络发送未知 |
| PiP | 将目标窗口内容作为 presentation 显示 | native service producer -> 独立 XPC -> Electron host | gate 与用户隐藏设置存在；是否有 active presentation 未采集 |

最重要的边界是：

1. 截图临时文件不是 Appshot 的持久 store。
2. Appshot 是 capture 交互；Skysight 是持续观察；Event Stream 是显式录制。
3. analytics protobuf 类型和本地队列存在，不等于已发送。
4. PiP 是 presentation channel，不承载主 Computer Use JSON-RPC 请求。

## 2. Screenshot 文件生命周期

方法级符号确认：

```text
SkyshotOperation.captureScreenshot
SystemSelection.writeScreenshotToFile
ScreenshotImplementation.writeScreenshotToFile
ScreenshotImplementation.captureScreenshotFile
ScreenshotFile.init(file:url:mimeType:)
ComputerUseSkyshotAttachment.init(text:screenshot:...)
TemporaryFile.temporaryDirectory
```

由此可确认：

```text
ScreenCaptureKit / SkyLight capture
  -> CGImage
  -> writeScreenshotToFile
  -> SlimCore.ScreenshotFile
  -> ComputerUseSkyshotAttachment
```

文件名静态锚点为 `screenshot_`，但当前二进制没有可直接证明删除时点的方法级
锚点。最窄路径模板是：

```text
$TMPDIR/<temporary-file-root>/screenshot_<opaque>.<image-extension>
```

结论边界：

- 创建和 attachment handoff 已确认。
- 文件由 `SlimCore.TemporaryFile` 根管理已确认。
- 是“发送后立即删除”、对象释放时删除，还是由系统临时目录回收，当前证据不足。
- 采集器只统计匹配文件的元数据，不打开文件，也不识别图片内容。

`skipScreenshot`、`screenshotNeededForContext` 和 Screen Recording permission
是独立 gate。某次 observation 可以有 AX tree 而没有 screenshot。

## 3. Appshot

Appshot 相关符号包括：

```text
ComputerUse.AppshotCaptureStore.captures
AppshotCaptureTransition.start / complete / cancel
AppshotCaptureTransition.setScreenshot
AppshotCaptureTransition.finalFrameSnapshotFile
Package_Appshot.bundle/.../Appshot.wav
```

`AppshotCaptureStore.captures` 是内存集合；没有发现独立 Appshot 持久目录或
Appshot 数据库。capture transition 的 final frame 可以生成普通
`SlimCore.ScreenshotFile`，因此它可能与截图临时文件机制复用，但不能把任意
`screenshot_*` 文件反推成 Appshot。

Electron 的 service manager 由：

```text
appshotsEnabled || nodeReplEnabled
```

决定是否需要拉起 native service。因此观察到 `SkyComputerUseService` 进程，
不能证明 Appshot gate 已开启。当前 `appshotsEnabled` 值未采集，状态记为
`unknown`。

## 4. Skysight 与 Event Stream

### 请求类型

当前构建有两组独立 IPC request：

```text
ComputerUseIPCEventStreamStartRequest
ComputerUseIPCEventStreamStatusRequest
ComputerUseIPCEventStreamStopRequest

ComputerUseIPCSkysightStartRequest
ComputerUseIPCSkysightStatusRequest
ComputerUseIPCSkysightStopRequest
ComputerUseIPCSkysightUpdateExclusionRequest
ComputerUseIPCSkysightListExclusionsRequest
```

Event Stream service 自己维护 writer、pending records、auto-stop task、
originating thread ID 和 end reason。Skysight service 则持有
`EventStreamCaptureSubscription`、segment writer、memory pipeline 和
exclusions。也就是说，Skysight 复用 capture substrate，但有自己的生命周期、
segment 和摘要层。

### 文件路径模板

Skysight 静态资源直接声明 raw segment 是 ephemeral：

```text
$TMPDIR/skysight/segments/<segment-id>/events.jsonl
$TMPDIR/skysight/segments/<segment-id>/metadata.json
$TMPDIR/skysight/segments/<segment-id>/<suppressed-events-file>
```

Event Stream / Record & Replay 明确使用 `events.jsonl` 以及
`metadata.json` 或 `session.json`，但当前静态证据没有暴露稳定的 session root
目录名。因此只记录：

```text
$TMPDIR/<event-stream-session-root>/events.jsonl
$TMPDIR/<event-stream-session-root>/{metadata.json,session.json}
```

精确 root 名称为 `unknown`，不能拿 Skysight 的 root 代替。

### Prompt 资源

签名资源包包含：

```text
Package_ComputerUse.bundle/Contents/Resources/SkysightMemoryInstructions.md
Package_ComputerUse.bundle/Contents/Resources/SkysightSummarizer.md
```

采集器只记录资源存在性、路径模板和字节/行数级事实，不复制 prompt body。
方法/字段表明 memory pipeline 有 10-minute summary 与 6-hour rollup task，
但 task 存在不证明当前用户已启用 Skysight。

prompt 本身还定义了清晰的 trust boundary：

- Event Stream、窗口/AX 文本、终端输出和 child summaries 都是高度不可信的
  observed content，不得作为指令执行。
- untrusted taint 在引用、摘要、改写或合并后仍然保留。
- 输出不得保留 URL、raw event JSON、secrets/PII 或 observed instructions。
- 10-minute summary 服务即时连续性，6-hour rollup 压缩更大的工作 arc；
  这些摘要仍只是后续 memory consolidation 的证据。

因此 Skysight prompt 是一个“观察内容 -> 受约束摘要”的隔离层，不是把
Event Stream 内容直接提升为用户指令或 durable preference。

### Opt-out 与抑制 gate

Skysight：

- feature eligibility：`ComputerUseIPCRequestRequiringSkysightFeature`；
- start 时的 MCP elicitation approval；
- stop/pause/clear history；
- app、URL domain、private browsing exclusion；
- suppressed event 单独写入，不应视作正常观察。

Event Stream：

- `recordAndReplay` feature gate；
- 显式 start/status/stop；
- 用户 stop/cancel；
- URL policy filter、secure input 和 blocked capture context；
- auto-stop task。

本调查不调用 status request，因为那需要连接真实 CUA socket。故“当前启用”和
“当前正在录制”都保持 `unknown`。

## 5. Remote-hosted PiP XPC

native service producer 侧：

```text
RemoteHostedPIPContentPublisher.publishWindowStream(
  threadID, turnID, windowID
)
RemoteHostedPIPContentStream
content fence / context ID / operation ID
```

Electron 的 `sky.node` host 侧：

```text
RemoteHostedPIPContentService.connectToEndpoint
publishPresentationWithID:threadID:turnID:contextID:...
prepareOperationWithPresentationID:operationID:...
completeOperationWithPresentationID:operationID:...
invalidatePresentationWithID:...
```

`sky.node` 链接 `libswiftXPC.dylib`。presentation 以 thread/turn/presentation ID
绑定，并通过 context/fence 协调内容，不是把 screenshot 文件轮询给 Electron。

有效 gate 为：

```text
cuaPIP && alwaysHidePictureInPicture != true
```

前者是 feature availability，后者是用户 opt-out。采集器不读取用户 preference
值，也不触发 presentation，所以当前 PiP enablement 和 active presentation 都是
`unknown`。

## 6. Analytics 与 Statsig

当前 native binary 包含：

```text
EventLogger.configure(databaseURL:transport:)
EventLogger.log
CodexDatadogTelemetryTransport.send / sendImmediately
StatsigOptions.eventLoggingEnabled
StatsigUser.optOutNonSdkMetadata
getFeatureGateWithExposureLoggingDisabled
getConfigWithExposureLoggingDisabled
```

路径模板：

```text
$CUA_GROUP/Library/Application Support/Software/Analytics.db
$HOME/Library/Caches/com.openai.sky.CUAService/Cache.db{,-wal,-shm}
$HOME/Library/HTTPStorages/com.openai.sky.CUAService/httpstorages.sqlite{,-wal,-shm}
```

当前进程 FD 可证明 `Analytics.db` 被某个 Sky service 打开时，本地 queue/logger
代码正在使用该数据库。它仍不能证明：

- 某个特定 analytics event 已写入；
- Statsig 已初始化；
- event logging 当前为 true；
- transport 已成功发网；
- 发送 body 包含什么。

`StatsigUser.optOutNonSdkMetadata` 只证明 SDK metadata opt-out 字段存在，
`eventLoggingEnabled` 只证明事件记录可配置，带
`WithExposureLoggingDisabled` 的 API 只约束 gate/config exposure logging。
在本次选择的静态 surface 中没有确认一个产品级“一键关闭全部 analytics”的
gate；这项状态记录为 `not_confirmed`，不能反推为不存在。

脚本不会查询 SQLite，不读取 HTTP storage，不抓包，也不输出 endpoint。

## 7. 聚合证据与复现

```bash
bash scripts/collect-observability-evidence.sh
node --test tests/observability.test.mjs
```

生成：

```text
fixtures/observability/latest.json
```

fixture 只保存：

- 规范化路径模板；
- 请求类型和静态 gate 名；
- owner 类别、mode 集合、count、mtime 范围、size 聚合；
- 由 `ps comm` 精确 executable path 识别的进程角色及其 FD 类别计数；
- 所有无法从安全证据确认的当前状态为 `unknown`。

进程识别不能用 `pgrep -f` 或在完整 command line 上搜索
`SkyComputerUseService`：`nm`、采集脚本自身和 shell 参数都会包含同一二进制
路径，导致假阳性计数。当前实现只接受 `comm` 与 canonical executable path
完全相等的进程。

它不保存真实用户路径、UUID、URL、event 内容、截图内容、analytics body 或日志。
fixture 先写入目标目录内的 mode `0600` 临时文件，再用同目录 `rename` 原子替换，
并发读者只会看到完整旧 JSON 或完整新 JSON。
