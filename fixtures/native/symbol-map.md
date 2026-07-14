# Native Symbol Map

- Artifact: `SkyComputerUseService`
- Bundle: `com.openai.sky.CUAService`
- Version: `26.710.1000387` (`1000387`)
- UUID: `9E40FA2F-FC6C-3EE2-824A-E4975CA022AD`
- SHA-256: `27b547d17a11f6f697ee62bfc20e5da6fab3f39848d40191c132b09ae8f68f58`
- Evidence: `D1` method/function symbol; `D2` type/property/field symbol; `D3` import, dependency, or literal string.

## Coverage

| Area | Selected symbols |
|---|---:|
| `app-controller` | 51 |
| `app-policy` | 7 |
| `ax-render-diff-refetch` | 34 |
| `focus-protection` | 32 |
| `input-dispatch` | 14 |
| `ipc-server` | 34 |
| `lock-screen` | 136 |
| `pip` | 129 |
| `screenshot` | 5 |
| `sender-auth` | 4 |
| `session-binding` | 3 |
| `settle` | 4 |
| `url-policy` | 9 |

## Representative Symbols

| Area | Level | Address | Demangled symbol |
|---|---|---:|---|
| `app-controller` | `D1` | `0x000000010000b5c4` | `ComputerUse.ComputerUseAppController.CursorPosition.init(x: Swift.Int, y: Swift.Int) -> ComputerUse.ComputerUseAppController.CursorPosition` |
| `app-controller` | `D2` | `0x000000010004f3a4` | `variable initialization expression of ComputerUse.ComputerUseAppController.cursorPositionInScaledCoordinates : ComputerUse.ComputerUseAppController.CursorPosition` |
| `app-controller` | `D2` | `0x000000010004f420` | `variable initialization expression of ComputerUse.ComputerUseAppController.(skyshotImageFiles in _227D423D33BF05902090F41EA12C551C) : Swift.Set<SlimCore.File>` |
| `app-controller` | `D2` | `0x000000010004f42c` | `variable initialization expression of ComputerUse.ComputerUseAppController.(_isActive in _227D423D33BF05902090F41EA12C551C) : os.OSAllocatedUnfairLock<Swift.Bool>` |
| `app-policy` | `D2` | `0x0000000100fa6e48` | `OBJC_METACLASS_$_ComputerUse.CodexAppServerComputerUsePolicyProvider` |
| `app-policy` | `D2` | `0x0000000100fa6e98` | `OBJC_CLASS_$_ComputerUse.CodexAppServerComputerUsePolicyProvider` |
| `app-policy` | `D2` | `0x0010000000d18d50` | `OBJC_IVAR_$_ComputerUse.CodexAppServerComputerUsePolicyProvider with unmangled suffix ".ttl"` |
| `app-policy` | `D2` | `0x0010000000d18d58` | `OBJC_IVAR_$_ComputerUse.CodexAppServerComputerUsePolicyProvider with unmangled suffix ".timeout"` |
| `ax-render-diff-refetch` | `D1` | `0x000000010000b5c4` | `AccessibilitySupport.UIElementRenderDifference.init(oldRender: [AccessibilitySupport.UIElementRender<A>], newRender: [AccessibilitySupport.UIElementRender<A>]) -> AccessibilitySupport.UIElementRenderDifference<A>` |
| `ax-render-diff-refetch` | `D2` | `0x000000010004f518` | `variable initialization expression of ComputerUse.ComputerUseAppController.lastAXTree : ComputerUse.RefetchableSkyshotAXTree?` |
| `ax-render-diff-refetch` | `D1` | `0x000000010006ebe4` | `ComputerUse.ComputerUseAppController.updateSkyshot(treeCache: AccessibilitySupport.TransformedUIElement.TreeCache?, disableAXDiffing: Swift.Bool, skipScreenshot: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture` |
| `ax-render-diff-refetch` | `D1` | `0x0000000100072fec` | `ComputerUse.ComputerUseAppController.positionElement(_: AccessibilitySupport.UIElementProtocol, cursorNextInteractionTiming: ComputerUse.ComputerUseCursor.CursorNextInteractionTiming?, axTree: ComputerUse.RefetchableSkyshotAXTree) async throws -> Swift.Bool` |
| `focus-protection` | `D2` | `0x000000010000d240` | `variable initialization expression of AccessibilitySupport.SyntheticAppFocusEnforcer.State.applicationBelievesItHasFocus : Swift.Bool` |
| `focus-protection` | `D2` | `0x000000010004f3a4` | `variable initialization expression of AccessibilitySupport.SyntheticAppFocusEnforcer.frontmostApplicationObserver : AccessibilitySupport.SystemFrontmostApplicationTracker.Observer?` |
| `focus-protection` | `D2` | `0x000000010004f518` | `variable initialization expression of ComputerUse.ComputerUseAppController.focusEnforcer : AccessibilitySupport.SyntheticAppFocusEnforcer?` |
| `focus-protection` | `D1` | `0x0000000100071b8c` | `ComputerUse.ComputerUseAppController.activateFocusEnforcer() -> AccessibilitySupport.SyntheticAppFocusEnforcer` |
| `input-dispatch` | `D1` | `0x0000000100072880` | `ComputerUse.ComputerUseAppController.prepareToInteract(with: Swift.Int, cursorNextInteractionTiming: ComputerUse.ComputerUseCursor.CursorNextInteractionTiming?, positionElement: Swift.Bool) async throws -> (ComputerUse.RefetchableSkyshotAXTree, AccessibilitySupport.UIElementProtocol)` |
| `input-dispatch` | `D1` | `0x00000001000747bc` | `ComputerUse.ComputerUseAppController.click(elementID: Swift.Int, type: ComputerUse.ComputerUseAppController.ClickType?, numberOfClicks: Swift.Int?, returnSkyshot: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture?` |
| `input-dispatch` | `D1` | `0x0000000100078104` | `ComputerUse.ComputerUseAppController.setValue(elementID: Swift.Int, value: Swift.String, returnSkyshot: Swift.Bool, autosubmitSearchFields: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture?` |
| `input-dispatch` | `D1` | `0x0000000100079678` | `ComputerUse.ComputerUseAppController.performKeyboardAction(_: ComputerUse.ComputerUseAppController.KeyboardAction, text: Swift.String?, duration: Swift.Int?, waitForUIToSettle: Swift.Bool, returnSkyshot: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture?` |
| `ipc-server` | `D2` | `0x0000000100006728` | `variable initialization expression of ComputerUse.ComputerUseIPCServer.(terminatesWhenNoActiveIPCClients in _49BCD535C970AC4CF447BDF087883D90) : Swift.Bool` |
| `ipc-server` | `D2` | `0x000000010004f3a4` | `variable initialization expression of ComputerUse.ComputerUseIPCServer.(onCodexTurnEnded in _49BCD535C970AC4CF447BDF087883D90) : ((Swift.String) -> ())?` |
| `ipc-server` | `D2` | `0x000000010004f9ac` | `variable initialization expression of ComputerUse.ComputerUseIPCServer.(clientExitSources in _49BCD535C970AC4CF447BDF087883D90) : os.OSAllocatedUnfairLock<[Swift.Int32 : __C.OS_dispatch_source_proc]>` |
| `ipc-server` | `D2` | `0x000000010004f9c8` | `variable initialization expression of ComputerUse.ComputerUseIPCServer.(xpcSessions in _49BCD535C970AC4CF447BDF087883D90) : os.OSAllocatedUnfairLock<[Foundation.UUID : ComputerUse.ComputerUseIPCXPCSession]>` |
| `lock-screen` | `D1` | `0x000000010000b5c4` | `ComputerUse.LockScreenGuardianCoordinator.setConnectionLossHandler(@Swift.MainActor @Sendable () -> ()) -> ()` |
| `lock-screen` | `D2` | `0x000000010000d240` | `variable initialization expression of ComputerUse.LockScreenAutoUnlockCoordinator.(suppressionState in _40E26854AEC31D7E42E5CF920A9CCEC9) : ComputerUse.LockScreenAutoUnlockCoordinator.(SuppressionState in _40E26854AEC31D7E42E5CF920A9CCEC9)` |
| `lock-screen` | `D1` | `0x0000000100012d90` | `-[Codex_Computer_Use.(CUALockScreenGuardianClientCallbackReceiver in _A4D9FA77DAD939F6643E12CC29B177B2) lockScreenGuardianDetectedPhysicalInput]` |
| `lock-screen` | `D1` | `0x0000000100012e18` | `-[Codex_Computer_Use.(CUALockScreenGuardianClientCallbackReceiver in _A4D9FA77DAD939F6643E12CC29B177B2) init]` |
| `pip` | `D2` | `0x0000000100006728` | `variable initialization expression of ComputerUse.RemoteHostedPIPContentStream.(nextOperationID in _27C9D88686C0B1E7D2EFB4DB14F884E7) : Swift.UInt64` |
| `pip` | `D2` | `0x000000010000d240` | `variable initialization expression of ComputerUse.RemoteHostedPIPContentStream.isPublished : Swift.Bool` |
| `pip` | `D2` | `0x000000010004f3a4` | `variable initialization expression of ComputerUse.RemoteHostedPIPContentStream.actionHandler : ((ComputerUse.RemoteHostedPIPContentAction) -> Swift.Bool)?` |
| `pip` | `D2` | `0x000000010004f518` | `variable initialization expression of ComputerUse.RemoteHostedPIPContentStream.(endStreamTimeoutTask in _27C9D88686C0B1E7D2EFB4DB14F884E7) : Swift.Task<(), Swift.Never>?` |
| `screenshot` | `D2` | `0x000000010000d240` | `variable initialization expression of ComputerUse.SystemSelection.screenshotNeededForContext : Swift.Bool` |
| `screenshot` | `D2` | `0x000000010004f71c` | `variable initialization expression of ComputerUse.ComputerUseSkyshotAttachment.screenshot : SlimCore.ScreenshotFile?` |
| `screenshot` | `D1` | `0x00000001000a2cd4` | `ComputerUse.ComputerUseSkyshotAttachment.init(text: Swift.String, screenshot: SlimCore.ScreenshotFile?, screenshotNeededForContext: Swift.Bool, accessibilityInspectorPayload: AccessibilitySupport.UIElementRenderTreeInspectorPayload?) -> ComputerUse.ComputerUseSkyshotAttachment` |
| `screenshot` | `D1` | `0x00000001001b7cec` | `ComputerUse.SkyshotOperation.captureScreenshot(imageSize: __C.CGSize?) async throws -> __C.CGImageRef` |
| `sender-auth` | `D2` | `0x00000001000066c0` | `variable initialization expression of ComputerUse.ComputerUseIPCSenderContext.clientType : ComputerUse.ComputerUseIPCSenderContext.ClientType?` |
| `sender-auth` | `D2` | `0x000000010004f98c` | `variable initialization expression of ComputerUse.ComputerUseIPCSenderContext.parentIdentity : ComputerUse.ComputerUseIPCSenderAuthorization.ProcessIdentity?` |
| `sender-auth` | `D2` | `0x000000010004f9a4` | `variable initialization expression of ComputerUse.ComputerUseIPCSenderContext.mcpRuntime : ComputerUseClient.ComputerUseMCPRuntime?` |
| `sender-auth` | `D2` | `0x0000000100052654` | `variable initialization expression of ComputerUse.ComputerUseIPCSenderContext.responsibleIdentity : ComputerUse.ComputerUseIPCSenderAuthorization.ProcessIdentity?` |
| `session-binding` | `D2` | `0x0000000100fa0638` | `OBJC_METACLASS_$_Codex_Computer_Use.CodexComputerUseSessionTracker` |
| `session-binding` | `D2` | `0x0000000100fa0678` | `OBJC_CLASS_$_Codex_Computer_Use.CodexComputerUseSessionTracker` |
| `session-binding` | `D2` | `0x0010000000d144e0` | `OBJC_IVAR_$_Codex_Computer_Use.CodexComputerUseSessionTracker with unmangled suffix ".targetIdentifiersByConversationID"` |
| `settle` | `D2` | `0x000000010000d240` | `variable initialization expression of ComputerUse.ComputerUseAppController.(needsUISettleBeforeSkyshot in _227D423D33BF05902090F41EA12C551C) : Swift.Bool` |
| `settle` | `D1` | `0x0000000100071748` | `ComputerUse.ComputerUseAppController.updateSkyshotSettlingIfNeeded(disableAXDiffing: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture` |
| `settle` | `D1` | `0x000000010064a280` | `AccessibilitySupport.ApplicationUIElement.waitForUIToSettle(delay: Swift.Double?, notificationDelay: Swift.Double, includingScrollEvents: Swift.Bool) async throws -> AccessibilitySupport.TransformedUIElement.TreeCache?` |
| `settle` | `D2` | `0x0010000000d185a8` | `OBJC_IVAR_$_ComputerUse.ComputerUseAppController with unmangled suffix ".needsUISettleBeforeSkyshot"` |
| `url-policy` | `D2` | `0x0000000100fa7428` | `OBJC_METACLASS_$_ComputerUse.ComputerUseURLBlocklistCache` |
| `url-policy` | `D2` | `0x0000000100fa7468` | `OBJC_CLASS_$_ComputerUse.ComputerUseURLBlocklistCache` |
| `url-policy` | `D2` | `0x0000000100fa87e0` | `OBJC_METACLASS_$_ComputerUse.EventStreamURLPolicyRecordFilter` |
| `url-policy` | `D2` | `0x0000000100fa8820` | `OBJC_CLASS_$_ComputerUse.EventStreamURLPolicyRecordFilter` |

## Key Method Anchors

| Area | Level | Address | Demangled symbol |
|---|---|---:|---|
| `ax-render-diff-refetch` | `D1` | `0x000000010006ebe4` | `ComputerUse.ComputerUseAppController.updateSkyshot(treeCache: AccessibilitySupport.TransformedUIElement.TreeCache?, disableAXDiffing: Swift.Bool, skipScreenshot: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture` |
| `ax-render-diff-refetch` | `D1` | `0x00000001001b3e38` | `ComputerUse.RefetchableSkyshotAXTree.refetchTree() throws -> ComputerUse.SystemSelection` |
| `input-dispatch` | `D1` | `0x0000000100079678` | `ComputerUse.ComputerUseAppController.performKeyboardAction(_: ComputerUse.ComputerUseAppController.KeyboardAction, text: Swift.String?, duration: Swift.Int?, waitForUIToSettle: Swift.Bool, returnSkyshot: Swift.Bool) async throws -> ComputerUse.ComputerUseAppController.SkyshotCapture?` |
| `input-dispatch` | `D1` | `0x000000010063fca8` | `AccessibilitySupport.ApplicationUIElement.sendClick(to: AccessibilitySupport.ApplicationUIElement.MouseEventTarget, at: __C.CGPoint, insideWebView: Swift.Bool, andDragTo: __C.CGPoint?, mouseButton: __C.CGMouseButton, count: Swift.Int, delay: Swift.Duration?, window: AccessibilitySupport.WindowUIElement?, focusEnforcer: AccessibilitySupport.SyntheticAppFocusEnforcer?, virtualCursor: AccessibilitySupport.VirtualCursor?) async throws -> ()` |
| `ipc-server` | `D1` | `0x00000001001531bc` | `ComputerUse.ComputerUseIPCServer.start(terminatesWhenNoActiveIPCClients: Swift.Bool, ensureApplicationHasPermissions: (@Swift.MainActor (ComputerUse.ComputerUseIPCPermissionRequestSource, Swift.String?) async -> ComputerUse.ComputerUseIPCPermissionResult)?, prepareForAuthenticatedRequest: (@Swift.MainActor (ComputerUse.ComputerUseIPCSenderContext) async throws -> ())?, onAppUsed: ((Swift.String) -> ())?, onCodexTurnEnded: ((Swift.String) -> ())?, shouldTerminateWhenNoClientsRemain: (@Swift.MainActor () -> Swift.Bool)?) -> ()` |
| `ipc-server` | `D1` | `0x0000000100153c94` | `-[ComputerUse.ComputerUseIPCServer handleEvent:withReplyEvent:]` |
| `ipc-server` | `D1` | `0x000000010015fac8` | `-[ComputerUse.ComputerUseIPCXPCSession sendRequestWithTypeName:requestData:codexMetadataData:withReply:]` |
| `lock-screen` | `D1` | `0x0000000100170088` | `ComputerUse.LockScreenAutoUnlockCoordinator.prepareForRequest(threadID: Swift.String?) async throws -> ()` |
| `lock-screen` | `D1` | `0x00000001001733f0` | `ComputerUse.LockScreenGuardianCoordinator.withUnlockGuard(threadID: Swift.String, perform: @Swift.MainActor @Sendable () async throws -> Swift.Bool) async throws -> Swift.Bool` |
| `pip` | `D1` | `0x000000010017e8c4` | `ComputerUse.RemoteHostedPIPContentPublisher.publishWindowStream(threadID: Swift.String, turnID: Swift.String, windowID: Swift.UInt32) -> ComputerUse.RemoteHostedPIPContentStream` |
| `screenshot` | `D1` | `0x00000001001b7cec` | `ComputerUse.SkyshotOperation.captureScreenshot(imageSize: __C.CGSize?) async throws -> __C.CGImageRef` |
| `settle` | `D1` | `0x000000010064a280` | `AccessibilitySupport.ApplicationUIElement.waitForUIToSettle(delay: Swift.Double?, notificationDelay: Swift.Double, includingScrollEvents: Swift.Bool) async throws -> AccessibilitySupport.TransformedUIElement.TreeCache?` |

## Transport Boundary

The shipped Node client primary path is the length-prefixed JSON-RPC native pipe at `computeruse.sock`, terminating in `ComputerUseIPCServer` and its `jsonRPCSocketServer`. `ComputerUseIPCXPCSession` plus Apple Event bootstrap strings describe a compiled alternate bridge, not the current Node client entry path.

| Area | Level | Source | Evidence |
|---|---|---|---|
| `ipc-server` | `D3` | `string` | `CodexComputerUseIPC-2` |
| `ipc-server` | `D3` | `string` | `computeruse.sock` |
| `sender-auth` | `D3` | `string` | `cua_ipc_sender_responsible_team_id` |
| `sender-auth` | `D3` | `string` | `ComputerUseIPCSenderAuthorization` |
| `sender-auth` | `D3` | `string` | `ComputerUseIPCSenderContextResolver` |
| `sender-auth` | `D3` | `import` | `SecTaskCreateWithAuditToken` |
| `sender-auth` | `D3` | `import` | `SecCodeCopySigningInformation` |
| `app-policy` | `D3` | `string` | `allowed_bundle_ids` |
| `app-policy` | `D3` | `string` | `denied_bundle_ids` |
| `url-policy` | `D3` | `string` | `Computer Use stopped due to encountering a disallowed URL` |
| `xpc-transport` | `D3` | `dependency` | `libswiftXPC.dylib` |
| `xpc-transport` | `D3` | `import` | `xpc_pipe_routine` |
| `apple-event-bridge` | `D3` | `string` | `Could not get XPC bootstrap mach port from Apple event` |
| `apple-event-bridge` | `D3` | `string` | `Could not get request type name from Apple event` |
| `apple-event-bridge` | `D3` | `string` | `Could not get sender PID from Apple event` |
| `apple-event-bridge` | `D3` | `import` | `NSAppleEventManager` |
| `screenshot` | `D3` | `dependency` | `ScreenCaptureKit.framework` |
| `screenshot` | `D3` | `import` | `SCScreenshotManager` |
| `input-dispatch` | `D3` | `import` | `CGEventGetFlags` |
| `lock-screen` | `D3` | `string` | `/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock` |
