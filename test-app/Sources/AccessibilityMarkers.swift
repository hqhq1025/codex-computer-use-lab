import AppKit

enum LabContract {
    static let bundleIdentifier = "com.openai.codex.cualab"
    static let appPath = "/Users/haoqing/Documents/Learning/codex-computer-use-lab/test-app/build/Codex CUA Lab.app"
    static let syntheticMarker = "CUA Lab Synthetic Surface"
}

enum AXMarker {
    static let window = "cua.lab.window"
    static let root = "cua.lab.root"
    static let reset = "cua.lab.reset"
    static let fullStateProbe = "cua.lab.full-state-probe"
    static let diffProbe = "cua.lab.diff-probe"
    static let diffStatus = "cua.lab.diff-status"
    static let primaryButton = "cua.lab.primary-button"
    static let setValueField = "cua.lab.set-value-field"
    static let typeTextField = "cua.lab.type-text-field"
    static let selectTextField = "cua.lab.select-text-field"
    static let checkbox = "cua.lab.checkbox"
    static let slider = "cua.lab.slider"
    static let popup = "cua.lab.popup"
    static let scrollRegion = "cua.lab.scroll-region"
    static let dragTarget = "cua.lab.drag-target"
    static let loadingIndicator = "cua.lab.loading-indicator"
    static let loadingToggle = "cua.lab.loading-toggle"
    static let modalOpen = "cua.lab.modal-open"
    static let modalWindow = "cua.lab.modal-window"
    static let modalClose = "cua.lab.modal-close"
    static let secondaryOpen = "cua.lab.secondary-open"
    static let secondaryWindow = "cua.lab.secondary-window"
    static let secondaryButton = "cua.lab.secondary-button"
    static let secondaryScrollRegion = "cua.lab.secondary-scroll-region"
    static let secondaryClose = "cua.lab.secondary-close"
    static let hierarchyMutate = "cua.lab.hierarchy-mutate"
    static let hierarchyRemove = "cua.lab.hierarchy-remove"
    static let hierarchyDuplicate = "cua.lab.hierarchy-duplicate"
    static let hierarchyContainer = "cua.lab.hierarchy-container"
    static let staleTarget = "cua.lab.stale-target"
    static let duplicateAction1 = "cua.lab.duplicate-action-1"
    static let duplicateAction2 = "cua.lab.duplicate-action-2"
    static let coordinateTarget = "cua.lab.coordinate-target"
    static let coordinateDecoy = "cua.lab.coordinate-decoy"
    static let coordinateMutate = "cua.lab.coordinate-mutate"
    static let oopSurface = "cua.lab.oop-surface"
    static let oopButton = "cua.lab.oop-button"
    static let oopCount = "cua.lab.oop-count"
    static let windowHandle = "cua.lab.window-handle"
    static let stateOutput = "cua.lab.state-output"
}

extension NSView {
    func applyAccessibilityMarker(_ identifier: String, label: String) {
        self.identifier = NSUserInterfaceItemIdentifier(identifier)
        if !(self is NSControl) {
            setAccessibilityElement(true)
        }
        setAccessibilityIdentifier(identifier)
        setAccessibilityLabel(label)
    }
}
