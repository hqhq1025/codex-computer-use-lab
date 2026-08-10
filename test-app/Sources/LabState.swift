import Darwin
import Foundation

final class LabState {
    var resetCount = 0
    var lastAction = "launch"

    var fullStateProbeCount = 0
    var diffProbeCount = 0

    var buttonClickCount = 0
    var setValue = ""
    var typeText = ""
    var selectTextValue = ""
    var checkboxChecked = false
    var sliderValue = 25
    var scrollOffset = 0

    var focusedControl: String?
    var selectedText = ""
    var selectionType = ""

    var modalOpen = false
    var secondaryWindowOpen = false
    var secondaryButtonClickCount = 0
    var secondaryScrollOffset = 0

    var hierarchyGeneration = 0
    var hierarchyMode = "initial"
    var staleTargetClickCount = 0
    var wrongTargetClickCount = 0

    var ambiguousLastTarget: String?
    var ambiguousClickCount = 0

    var oopClickCount = 0
    var oopLastEventTrusted: Bool?
    var oopHostLocalMouseDownCount = 0
    var oopHostLocalMouseUpCount = 0
    let oopHostPID = Int(getpid())
    var oopWebContentPID = 0
    var oopTargetX = 0
    var oopTargetY = 0
    var oopTextValue = ""
    var oopTextInputCount = 0
    var oopTextChangeCount = 0
    var oopLastTextEventTrusted: Bool?

    var coordinateClickCount = 0
    var coordinateDecoyClickCount = 0
    var coordinateGeneration = 0
    var coordinateTargetX = 0
    var coordinateTargetY = 0
    var dragStartX = 0
    var dragStartY = 0
    var dragEndX = 0
    var dragEndY = 0
    var windowMoveStartX = 0
    var windowMoveStartY = 0
    var windowMoveEndX = 0
    var windowMoveEndY = 0
    var windowMoveReturnEndX = 0
    var windowMoveReturnEndY = 0
    var windowX = 0
    var windowY = 0
    var windowWidth = 0
    var windowHeight = 0
    var windowScreenX = 0
    var windowScreenY = 0
    var windowOnSecondaryScreen = false

    var popupSelection = "Alpha"
    var dragX = 42
    var dragY = 42
    var loading = false

    func reset(windowX: Int, windowY: Int) {
        resetCount += 1
        lastAction = "reset"
        fullStateProbeCount = 0
        diffProbeCount = 0
        buttonClickCount = 0
        setValue = ""
        typeText = ""
        selectTextValue = ""
        checkboxChecked = false
        sliderValue = 25
        scrollOffset = 0
        focusedControl = nil
        selectedText = ""
        selectionType = ""
        modalOpen = false
        secondaryWindowOpen = false
        secondaryButtonClickCount = 0
        secondaryScrollOffset = 0
        hierarchyGeneration = 0
        hierarchyMode = "initial"
        staleTargetClickCount = 0
        wrongTargetClickCount = 0
        ambiguousLastTarget = nil
        ambiguousClickCount = 0
        oopClickCount = 0
        oopLastEventTrusted = nil
        oopHostLocalMouseDownCount = 0
        oopHostLocalMouseUpCount = 0
        oopTextValue = ""
        oopTextInputCount = 0
        oopTextChangeCount = 0
        oopLastTextEventTrusted = nil
        coordinateClickCount = 0
        coordinateDecoyClickCount = 0
        coordinateGeneration = 0
        self.windowX = windowX
        self.windowY = windowY
        popupSelection = "Alpha"
        dragX = 42
        dragY = 42
        loading = false
    }

    func jsonObject() -> [String: Any] {
        [
            "schemaVersion": 1,
            "synthetic": true,
            "syntheticMarker": LabContract.syntheticMarker,
            "bundleIdentifier": LabContract.bundleIdentifier,
            "appPath": LabContract.appPath,
            "meta": [
                "resetCount": resetCount,
                "lastAction": lastAction
            ],
            "metrics": [
                "fullStateProbeCount": fullStateProbeCount,
                "diffProbeCount": diffProbeCount
            ],
            "controls": [
                "buttonClickCount": buttonClickCount,
                "setValue": setValue,
                "typeText": typeText,
                "selectTextValue": selectTextValue,
                "checkboxChecked": checkboxChecked,
                "sliderValue": sliderValue,
                "scrollOffset": scrollOffset,
                "popupSelection": popupSelection,
                "dragPosition": [
                    "x": dragX,
                    "y": dragY
                ],
                "loading": loading
            ],
            "focus": [
                "control": (focusedControl as Any?) ?? NSNull()
            ],
            "selection": [
                "text": selectedText,
                "type": selectionType
            ],
            "modal": [
                "open": modalOpen
            ],
            "secondaryWindow": [
                "open": secondaryWindowOpen,
                "buttonClickCount": secondaryButtonClickCount,
                "scrollOffset": secondaryScrollOffset
            ],
            "hierarchy": [
                "generation": hierarchyGeneration,
                "mode": hierarchyMode,
                "staleTargetClickCount": staleTargetClickCount,
                "wrongTargetClickCount": wrongTargetClickCount
            ],
            "ambiguous": [
                "lastTarget": (ambiguousLastTarget as Any?) ?? NSNull(),
                "clickCount": ambiguousClickCount
            ],
            "oop": [
                "clickCount": oopClickCount,
                "lastEventTrusted": (oopLastEventTrusted as Any?) ?? NSNull(),
                "hostLocalMouseDownCount": oopHostLocalMouseDownCount,
                "hostLocalMouseUpCount": oopHostLocalMouseUpCount,
                "hostPID": oopHostPID,
                "webContentPID": oopWebContentPID,
                "textValue": oopTextValue,
                "textInputCount": oopTextInputCount,
                "textChangeCount": oopTextChangeCount,
                "lastTextEventTrusted":
                    (oopLastTextEventTrusted as Any?) ?? NSNull(),
                "target": [
                    "x": oopTargetX,
                    "y": oopTargetY
                ]
            ],
            "coordinate": [
                "clickCount": coordinateClickCount,
                "decoyClickCount": coordinateDecoyClickCount,
                "generation": coordinateGeneration,
                "target": [
                    "x": coordinateTargetX,
                    "y": coordinateTargetY
                ]
            ],
            "drag": [
                "start": [
                    "x": dragStartX,
                    "y": dragStartY
                ],
                "end": [
                    "x": dragEndX,
                    "y": dragEndY
                ]
            ],
            "windowMove": [
                "start": [
                    "x": windowMoveStartX,
                    "y": windowMoveStartY
                ],
                "end": [
                    "x": windowMoveEndX,
                    "y": windowMoveEndY
                ],
                "returnEnd": [
                    "x": windowMoveReturnEndX,
                    "y": windowMoveReturnEndY
                ]
            ],
            "window": [
                "x": windowX,
                "y": windowY,
                "width": windowWidth,
                "height": windowHeight,
                "screenOriginX": windowScreenX,
                "screenOriginY": windowScreenY,
                "onSecondaryScreen": windowOnSecondaryScreen
            ]
        ]
    }
}

struct StateWriter {
    let runtimeURL: URL
    let stateURL: URL

    init?() {
        let appURL = Bundle.main.bundleURL.standardizedFileURL
        let buildURL = appURL.deletingLastPathComponent()
        let testAppURL = buildURL.deletingLastPathComponent()

        guard appURL.path == LabContract.appPath,
              appURL.lastPathComponent == "Codex CUA Lab.app",
              buildURL.lastPathComponent == "build",
              testAppURL.lastPathComponent == "test-app"
        else {
            return nil
        }

        runtimeURL = testAppURL.appendingPathComponent("runtime", isDirectory: true)
        stateURL = runtimeURL.appendingPathComponent("state.json", isDirectory: false)
    }

    func prepareRuntimeDirectory() throws {
        if mkdir(runtimeURL.path, mode_t(S_IRWXU)) != 0, errno != EEXIST {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        guard chmod(runtimeURL.path, mode_t(S_IRWXU)) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }

    func write(_ data: Data) throws {
        try prepareRuntimeDirectory()
        try data.write(to: stateURL, options: .atomic)
        guard chmod(stateURL.path, mode_t(S_IRUSR | S_IRGRP | S_IROTH)) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }
}

func serializeState(_ state: LabState) -> Data {
    do {
        return try JSONSerialization.data(
            withJSONObject: state.jsonObject(),
            options: [.prettyPrinted, .sortedKeys]
        )
    } catch {
        preconditionFailure("Synthetic state must always be JSON serializable: \(error)")
    }
}
