# 坐标、Retina 与多显示器实验

## 范围与安全边界

本章只处理显示器几何和坐标换算，不执行任何 Computer Use 动作。配套 probe
只调用 `NSScreen` 与 CoreGraphics 的只读显示器查询：

```text
NSScreen.screens
NSScreen.frame / visibleFrame / backingScaleFactor / deviceDescription
CGMainDisplayID
CGDisplayBounds
CGDisplayPixelsWide / CGDisplayPixelsHigh
CGGetOnlineDisplayList
```

它不读取 AX 树，不截图，不枚举窗口，不连接 `computeruse.sock`，也不生成键鼠
事件。fixture 不保存原始显示器名称、序列号、vendor/product ID、主机名、用户名、
窗口标题或路径。当前本机两台显示器均为 DELL U2412M；这个型号只用于解释实验
背景，fixture 用 `display-model-1` 表示同型号组。

## 复现

打印经过脱敏和稳定排序的 JSON：

```bash
bash scripts/display-geometry-probe.sh
```

原子更新当前 fixture：

```bash
bash scripts/display-geometry-probe.sh \
  --out fixtures/display/current.json
```

包装器用 Node 的 `JSON.parse` 校验临时文件后再 `mv`；当前 macOS 的
`plutil -lint` 会把合法的顶层 JSON object 报为
`Unexpected character { at line 1`，因此不用于这里的 JSON 校验。
首次运行 `xcrun swift` 可能触发冷编译并超过 10 秒；测试给每次只读采集
30 秒。`frame`、CoreGraphics bounds/pixels、display ID、scale 和坐标变换要求
精确一致；`visibleFrame` 与派生 insets 不参与逐字节稳定性比较。
原子写测试还会用两个慢速并发 writer 更新同一路径，并在写入期间持续解析目标
文件；任何半截 JSON、宽松 fallback 或遗留临时文件都会使测试失败。

运行测试：

```bash
node --test tests/display-geometry.test.mjs
```

输出没有时间戳，显示器先按主屏、再按 CoreGraphics 几何位置、最后按 display ID
排序。同一拓扑连续运行应产生相同的 deterministic geometry；fixture 仍保留每次
采集到的 `visibleFrame` snapshot，但 Dock 自动隐藏、菜单栏与 Space 状态可能在
不改变显示器拓扑时改变它。display ID 是本次登录会话中的关联键，不是持久硬件
身份；重新插拔、重启或改变镜像设置后应重新采集 fixture。
稳定占位名使用 `alias` 字段，不使用泛化的 `token` 字段，因为仓库的凭证扫描器
会有意把字符串形式的 `token` 键当作秘密。
schema 统一使用 `alias`、`modelAlias`、`mainDisplayAlias` 和
`displayAliases`；测试明确拒绝旧的 `token`、`modelToken`、
`mainDisplayToken` 与 `displayTokens`，防止并行生成器混用两版字段。

`fixtures/display/alignment-cases.json` 另含一个纯合成的 1x/2x 跨屏窗口用例，
用于验证逐屏 clip、包含式 pixel rounding 和实际截图尺寸映射，不描述本机硬件。

## 本机双屏实测

当前两台面板都是 `1920 x 1200`、1 point 对应 1 pixel，但它们不能靠型号或
分辨率区分。必须用 `NSScreenNumber` 对应的 `CGDirectDisplayID` 将同一块屏的
AppKit 与 CoreGraphics 记录关联起来。

| 屏幕 | AppKit `frame`（points） | CoreGraphics `bounds`（points） | pixels |
|---|---:|---:|---:|
| 主屏 | `(0, 0, 1920, 1200)` | `(0, 0, 1920, 1200)` | `1920 x 1200` |
| 左侧副屏 | `(-1920, 244, 1920, 1200)` | `(-1920, -244, 1920, 1200)` | `1920 x 1200` |

副屏物理上在主屏左侧，并且其底边比主屏底边高 244 points。因此：

- 两套坐标都有负 X；
- AppKit 中副屏 Y 为 `+244`；
- CoreGraphics/AX 顶点坐标中副屏 Y 为 `-244`；
- 虚拟桌面不是简单的 `3840 x 1200` 条带，而是
  `3840 x 1444` 的包围盒，其中存在没有显示器覆盖的空白区域；
- `visibleFrame` 只表示菜单栏、Dock 等之后的可用区域，不能替代完整
  `frame` 做全局坐标变换。

checked snapshot 中主屏的 `visibleFrame` 为 `(0, 103, 1920, 1066)`，对应
底部保留 103 points、顶部保留 31 points；另一时刻底部可能是 100 points。
左侧副屏在该 snapshot 中 `visibleFrame == frame`。测试不固定这些数值，只要求
visible rect 位于完整 frame 内、四边 inset 非负，且 rect 与 insets 能互相反推。

## 四种坐标空间

### 1. AppKit 全局 points

`NSScreen.frame` 和同进程 `NSWindow` 的屏幕矩形使用 AppKit 全局坐标：

- 原点：主屏左下角；
- X 向右；
- Y 向上；
- 单位：points。

### 2. CoreGraphics 与 AX 全局 points

`CGDisplayBounds`、`kCGWindowBounds`、`AXPosition` 和 `AXSize` 应统一到
左上原点的全局空间：

- 原点：显示菜单栏的主屏左上角；
- X 向右；
- Y 向下；
- 单位：points。

AX 明确定义 `AXPosition` 为元素左上角的全局位置，`AXSize` 为 points。
因此 AX 矩形可以直接与 CoreGraphics 顶点坐标比较，但不能直接与
`NSScreen.frame` 的 Y 值比较。

令主屏 AppKit frame 为 `M`，AppKit 矩形为 `R`，转换为 CoreGraphics/AX：

```text
cg.x      = R.minX - M.minX
cg.y      = M.maxY - R.maxY
cg.width  = R.width
cg.height = R.height
```

逆变换：

```text
appKit.x = cg.x + M.minX
appKit.y = M.maxY - (cg.y + cg.height)
```

不能用“虚拟桌面总高度减 Y”，因为左、右、上、下排列会改变 union bounds，
而坐标原点始终锚定主屏。

### 3. 显示器本地 points

ScreenCaptureKit 的 `sourceRect` 使用显示器逻辑坐标中的 points。先在
CoreGraphics 全局空间中求目标矩形与某块屏 `D` 的交集 `I`，再局部化：

```text
local.x = I.minX - D.bounds.minX
local.y = I.minY - D.bounds.minY
local.width  = I.width
local.height = I.height
```

负的全局坐标在局部化后会回到从 `(0, 0)` 开始的显示器内部坐标。

### 4. 截图 pixels

`CGDisplayPixelsWide/High` 和最终 `CGImage.width/height` 是 pixels。
逐屏比例为：

```text
scaleX = displayPixels.width  / displayBounds.width
scaleY = displayPixels.height / displayBounds.height
```

当前两台外接屏均为 `1.0`。Retina 屏常见 `2.0`，但实现不能把 2 写死，也不能
拿主屏比例套所有屏。优先使用本次 ScreenCaptureKit capture 返回的
`pointPixelScale`、`contentRect` 和实际 `CGImage` 尺寸；窗口截图可能被指定
输出尺寸缩放，此时截图比例不等于显示器 `backingScaleFactor`。

## 窗口 content bounds、AX 与截图的对齐

建议每次只读采集生成一份 observation manifest，至少包含：

```text
display ID
AppKit window frame（global points）
AppKit content-view bounds converted to screen（global points）
AX window position + size（global top-left points）
ScreenCaptureKit contentRect + pointPixelScale
actual CGImage width + height（pixels）
shadow / framing / destinationRect 设置
```

对同进程实验 app，内容区应由窗口自身计算：

```swift
let contentInWindow = contentView.convert(contentView.bounds, to: nil)
let contentInAppKitGlobal = window.convertToScreen(contentInWindow)
```

先把 `window.frame` 和 `contentInAppKitGlobal` 按上一节公式翻到
CoreGraphics/AX 顶点空间。AX window frame 应与翻转后的 `window.frame`
接近；content rect 会因标题栏、toolbar 等比 AX window frame 小。不要把
`kCGWindowBounds` 或 AX window size 当成 content bounds。

若截图对应 CoreGraphics 顶点空间中的 capture rect `C`，实际图片大小为
`W x H`，全局点 `P` 到截图像素的通用映射是：

```text
pixel.x = (P.x - C.minX) * W / C.width
pixel.y = (P.y - C.minY) * H / C.height
```

逆映射：

```text
global.x = C.minX + pixel.x * C.width / W
global.y = C.minY + pixel.y * C.height / H
```

这里必须使用实际图片尺寸。若截图包含阴影、透明 padding、letterbox 或
`destinationRect` 偏移，需要先减去内容在图片中的 pixel offset；最简单的
可重复实验设置是关闭阴影、不缩放、`destinationRect` 为空，并保存
`contentRect`。

## Sky screenshot coordinate 的判定

静态符号只证明 Sky 使用 ScreenCaptureKit 生成截图，并接受 coordinate 形式的
动作参数；本 probe 没有执行动作，因此不能把 Sky coordinate 直接宣称为
“截图 pixels”或“全局 points”。

Production synthetic-App experiments now establish the macOS contract more
precisely:

1. Sky action coordinates are relative to the returned app-window screenshot.
2. AppKit window-local points must be scaled to the actual screenshot size.
3. Window movement across displays keeps the same screenshot dimensions on the
   current 1x/1x display pair, while content and crop hashes change.
4. No screenshot revision token is present in the JS or native action request.

Observed mapping:

```text
window frame        1025 x 889 points
Sky screenshot       886 x 768 pixels

pixel.x = local.x * 886 / 1025
pixel.y = local.y * 768 / 889
```

A captured pre-mutation coordinate `(426, 322)` remained executable after the
target and decoy exchanged positions. It clicked the decoy. A fresh
observation produced the new target coordinate `(701, 322)` and clicked the
correct target. Freshness is therefore caller-enforced, not protocol-bound.

The earlier proposed auxiliary alignment method remains useful for different
scale factors:

1. 在受控实验 app 中画出已知 AppKit content-local point 的十字标记，同时记录
   window frame、content bounds 和 AX frame。
2. 获取同一 revision 的 Sky screenshot attachment，记录实际图片尺寸，在图片
   中只读定位十字标记，比较以下候选映射：
   - AX/CoreGraphics 全局 points；
   - window content-local points；
   - 原始 screenshot pixels；
   - 下采样截图中的归一化 pixels。

For new backing-scale combinations, multiple non-collinear markers should
still be checked under one affine transform. Current production action
experiments prove the contract only for this 1x/1x display pair and the
observed screenshot scaling.

## 跨屏窗口

窗口跨屏时，单一 `backingScaleFactor` 不足以描述桌面像素。正确处理方式取决于
截图类型。

### Display capture 后 crop

1. 将窗口 content rect 转到 CoreGraphics 全局 points。
2. 与每块显示器 bounds 分别求交。
3. 每块交集局部化到该显示器。
4. 使用该显示器自己的 pixels-per-point 转成 pixel crop。
5. 对 pixel 边界使用包含式取整：

```text
pixelMin = floor(pointMin * scale)
pixelMax = ceil(pointMax * scale)
pixelSize = pixelMax - pixelMin
```

6. clamp 到 `[0, imageWidth] x [0, imageHeight]`。
7. 若要合成一张图，明确选择统一输出比例，并保存每个 tile 的 point rect、
   source pixel rect 和 destination pixel rect。

不能先构造一张“整个虚拟桌面 pixel bitmap”再乘一个全局 scale；混合 1x/2x
显示器时该模型不存在。

### Independent window capture

直接使用该次 capture 的 `contentRect`、`pointPixelScale` 与实际图片尺寸。
窗口跨到另一块屏、主屏变化或 backing properties 变化后，旧映射立即失效，必须
重新采集。跨屏实验每一次拖动前都重新获取完整state和截图，窗口从主屏
`x=447`移动到副屏`x=-677`，再返回主屏`x=443`。截图、AX与窗口几何应作为一个
不可拆分的观测批次，尽管协议本身没有revision token。

## 失败判定

出现以下任一情况时，坐标应视为陈旧并重新观测：

- display ID、排列、主屏、rotation 或像素模式变化；
- 窗口移动、缩放或跨屏比例变化；
- `NSWindowDidChangeBackingProperties`；
- screenshot 实际尺寸与 manifest 不同；
- AX frame 与窗口 frame 的转换结果不再一致；
- crop 超出目标显示器，或一个点落在虚拟桌面空洞中；
- Sky screenshot revision 与 AX/window geometry revision 不同。

坐标是观测的派生物，不是持久元素身份。即使本机两块屏分辨率和型号完全相同，
也不能省略 display ID、坐标空间、单位、比例和 revision。
