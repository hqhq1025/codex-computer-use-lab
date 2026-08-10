import AppKit

final class LabWindowController: NSWindowController, NSWindowDelegate {
    private enum HierarchyMode {
        case initial
        case uniqueReplacement
        case missing
        case ambiguous
    }

    private let state = LabState()
    private let stateWriter = StateWriter()
    private let stateDisplay = StateDisplayView()
    private let diffStatus = NSTextField(labelWithString: "CUA Lab Diff Revision 0")

    private let checkbox = NSButton(
        checkboxWithTitle: "CUA Lab Checkbox",
        target: nil,
        action: nil
    )
    private let setValueField = LabTextField()
    private let typeTextField = LabTextField()
    private let selectTextField = LabTextField()
    private let slider = LabSlider(value: 25, minValue: 0, maxValue: 100, target: nil, action: nil)
    private let popup = NSPopUpButton()
    private let loadingIndicator = NSProgressIndicator()
    private let dragTarget = DragTargetView()
    private let coordinateTarget = CoordinateTargetButton(
        title: "CUA Lab Coordinate Target",
        target: nil,
        action: nil
    )
    private let coordinateDecoy = CoordinateTargetButton(
        title: "CUA Lab Coordinate Decoy",
        target: nil,
        action: nil
    )
    private let coordinateContainer = NSStackView()
    private let scrollRegion = LabScrollView()
    private let oopSurface = OOPWebViewSurface()
    private let windowMoveHandle = WindowMoveHandleView()
    private let hierarchyContainer = NSStackView()
    private var staleTargetButton: NSButton?
    private var secondaryWindow: NSWindow?
    private var secondaryScrollRegion: LabScrollView?
    private var resetWindowSize: NSSize?
    private var resetGeometryRestoreGeneration = 0

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1025, height: 857),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Codex CUA Lab"
        window.minSize = NSSize(width: 1025, height: 760)
        Self.positionOnPrimaryScreen(window)
        self.init(window: window)
        configureWindow()
        buildInterface()
        window.contentView?.layoutSubtreeIfNeeded()
        resetWindowSize = window.frame.size
        synchronizeStaticControls()
        updateWindowOrigin()
        publishState()
    }

    private func configureWindow() {
        guard let window else {
            return
        }
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
    }

    private static func positionOnPrimaryScreen(_ window: NSWindow) {
        guard let primaryScreen = primaryScreen() else {
            window.center()
            return
        }
        let visible = primaryScreen.visibleFrame
        window.setFrameOrigin(
            NSPoint(
                x: visible.midX - window.frame.width / 2,
                y: visible.midY - window.frame.height / 2
            )
        )
    }

    private static func primaryScreen() -> NSScreen? {
        NSScreen.screens.first {
            Int($0.frame.origin.x.rounded()) == 0 &&
                Int($0.frame.origin.y.rounded()) == 0
        } ?? NSScreen.main ?? NSScreen.screens.first
    }

    private func buildInterface() {
        guard let contentView = window?.contentView else {
            return
        }

        contentView.wantsLayer = true
        contentView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let title = NSTextField(labelWithString: LabContract.syntheticMarker)
        title.font = NSFont.systemFont(ofSize: 22, weight: .semibold)
        title.applyAccessibilityMarker(
            "cua.lab.synthetic-marker",
            label: LabContract.syntheticMarker
        )

        let resetButton = makeButton(
            title: "CUA Lab Reset",
            marker: AXMarker.reset,
            action: #selector(resetState)
        )
        let fullStateButton = makeButton(
            title: "CUA Lab Full State Probe",
            marker: AXMarker.fullStateProbe,
            action: #selector(fullStateProbe)
        )
        let diffButton = makeButton(
            title: "CUA Lab Diff Probe",
            marker: AXMarker.diffProbe,
            action: #selector(diffProbe)
        )
        let primaryButton = makeButton(
            title: "CUA Lab Primary Button",
            marker: AXMarker.primaryButton,
            action: #selector(primaryButtonClick)
        )

        let criticalActions = NSStackView(views: [
            resetButton,
            fullStateButton,
            diffButton,
            primaryButton
        ])
        criticalActions.orientation = .horizontal
        criticalActions.spacing = 10
        criticalActions.distribution = .fillEqually

        setValueField.placeholderString = "CUA Lab Set Value Field"
        setValueField.applyAccessibilityMarker(
            AXMarker.setValueField,
            label: "CUA Lab Set Value Field"
        )
        typeTextField.placeholderString = "CUA Lab Type Text Field"
        typeTextField.applyAccessibilityMarker(
            AXMarker.typeTextField,
            label: "CUA Lab Type Text Field"
        )
        selectTextField.placeholderString = "CUA Lab Select Text Field"
        selectTextField.applyAccessibilityMarker(
            AXMarker.selectTextField,
            label: "CUA Lab Select Text Field"
        )

        setValueField.controlName = "set-value"
        setValueField.onFocus = { [weak self] control in
            self?.recordFocus(control, action: "focus-set-value")
        }
        setValueField.onValueChange = { [weak self] value in
            guard let self else { return }
            self.state.setValue = value
            self.state.lastAction = "set-value"
            self.publishState()
        }

        typeTextField.controlName = "type-text"
        typeTextField.onFocus = { [weak self] control in
            self?.recordFocus(control, action: "focus-type-text")
        }
        typeTextField.onValueChange = { [weak self] value in
            guard let self else { return }
            self.state.typeText = value
            self.state.lastAction = "type-text"
            self.publishState()
        }

        selectTextField.controlName = "select-text"
        selectTextField.onFocus = { [weak self] control in
            self?.recordFocus(control, action: "focus-select-text")
        }
        selectTextField.onValueChange = { [weak self] value in
            guard let self else { return }
            self.state.selectTextValue = value
            self.state.lastAction = "seed-select-text"
            self.publishState()
        }
        selectTextField.onSelectionChange = { [weak self] range in
            guard let self else { return }
            let value = self.selectTextField.stringValue as NSString
            guard range.location != NSNotFound,
                  range.location >= 0,
                  range.location + range.length <= value.length
            else {
                return
            }
            self.state.selectedText = value.substring(with: range)
            self.state.selectionType = "text"
            self.state.lastAction = "select-text"
            self.publishState()
        }
        setValueField.nextKeyView = typeTextField
        typeTextField.nextKeyView = selectTextField
        selectTextField.nextKeyView = setValueField

        checkbox.target = self
        checkbox.action = #selector(toggleCheckbox)
        checkbox.applyAccessibilityMarker(
            AXMarker.checkbox,
            label: "CUA Lab Checkbox"
        )
        slider.onIncrement = { [weak self] value in
            guard let self else { return }
            self.state.sliderValue = value
            self.state.lastAction = "slider-increment"
            self.publishState()
        }
        slider.applyAccessibilityMarker(AXMarker.slider, label: "CUA Lab Slider")

        popup.addItems(withTitles: [
            "CUA Lab Alpha",
            "CUA Lab Beta",
            "CUA Lab Gamma"
        ])
        popup.applyAccessibilityMarker(AXMarker.popup, label: "CUA Lab Popup")

        loadingIndicator.style = .spinning
        loadingIndicator.isDisplayedWhenStopped = true
        loadingIndicator.applyAccessibilityMarker(
            AXMarker.loadingIndicator,
            label: "CUA Lab Loading Indicator"
        )

        configureScrollRegion()
        dragTarget.applyAccessibilityMarker(
            AXMarker.dragTarget,
            label: "CUA Lab Drag Target"
        )
        dragTarget.heightAnchor.constraint(equalToConstant: 72).isActive = true
        dragTarget.onPositionChange = { [weak self] x, y in
            guard let self else { return }
            self.state.dragX = x
            self.state.dragY = y
            self.state.lastAction = "drag"
            self.publishState()
        }
        windowMoveHandle.applyAccessibilityMarker(
            AXMarker.windowHandle,
            label: "CUA Lab Window Handle"
        )
        windowMoveHandle.heightAnchor.constraint(equalToConstant: 34).isActive = true
        windowMoveHandle.onWindowMove = { [weak self] in
            guard let self else { return }
            self.updateWindowOrigin()
            self.state.lastAction = "window-move"
            self.publishState()
        }

        hierarchyContainer.orientation = .horizontal
        hierarchyContainer.spacing = 10
        hierarchyContainer.distribution = .fillEqually
        hierarchyContainer.applyAccessibilityMarker(
            AXMarker.hierarchyContainer,
            label: "CUA Lab Hierarchy Container"
        )
        rebuildHierarchy(mode: .initial)

        let openModalButton = makeButton(
            title: "CUA Lab Open Modal",
            marker: AXMarker.modalOpen,
            action: #selector(openModal)
        )
        let openSecondaryButton = makeButton(
            title: "CUA Lab Open Secondary Window",
            marker: AXMarker.secondaryOpen,
            action: #selector(openSecondaryWindow)
        )
        let duplicateAction1 = makeButton(
            title: "CUA Lab Duplicate Action",
            marker: AXMarker.duplicateAction1,
            action: #selector(duplicateFirst)
        )
        let duplicateAction2 = makeButton(
            title: "CUA Lab Duplicate Action",
            marker: AXMarker.duplicateAction2,
            action: #selector(duplicateSecond)
        )
        coordinateTarget.target = self
        coordinateTarget.action = #selector(coordinateTargetClick)
        coordinateTarget.bezelStyle = .rounded
        coordinateTarget.applyAccessibilityMarker(
            AXMarker.coordinateTarget,
            label: "CUA Lab Coordinate Target"
        )
        coordinateTarget.onCoordinateClick = { [weak self] in
            guard let self else { return }
            self.state.coordinateClickCount += 1
            self.state.lastAction = "coordinate-click"
            self.publishState()
        }
        coordinateDecoy.target = self
        coordinateDecoy.action = #selector(coordinateDecoyClick)
        coordinateDecoy.bezelStyle = .rounded
        coordinateDecoy.applyAccessibilityMarker(
            AXMarker.coordinateDecoy,
            label: "CUA Lab Coordinate Decoy"
        )
        coordinateDecoy.onCoordinateClick = { [weak self] in
            guard let self else { return }
            self.state.coordinateDecoyClickCount += 1
            self.state.lastAction = "coordinate-decoy-click"
            self.publishState()
        }
        let mutateCoordinateButton = makeButton(
            title: "CUA Lab Move Coordinate Target",
            marker: AXMarker.coordinateMutate,
            action: #selector(mutateCoordinateLayout)
        )
        coordinateContainer.orientation = .horizontal
        coordinateContainer.spacing = 10
        coordinateContainer.distribution = .fillEqually
        coordinateContainer.addArrangedSubview(mutateCoordinateButton)
        coordinateContainer.addArrangedSubview(coordinateTarget)
        coordinateContainer.addArrangedSubview(coordinateDecoy)
        let advancedActions = NSStackView(views: [
            openModalButton,
            openSecondaryButton,
            duplicateAction1,
            duplicateAction2
        ])
        advancedActions.orientation = .horizontal
        advancedActions.spacing = 10
        advancedActions.distribution = .fillEqually

        let retainedControls = NSGridView(views: [
            [makeLabel("CUA Lab Set Value"), setValueField],
            [makeLabel("CUA Lab Type Text"), typeTextField],
            [makeLabel("CUA Lab Select Text"), selectTextField],
            [makeLabel("CUA Lab Checkbox Control"), checkbox],
            [makeLabel("CUA Lab Slider Control"), slider],
            [makeLabel("CUA Lab Popup Control"), popup]
        ])
        retainedControls.rowSpacing = 8
        retainedControls.columnSpacing = 12
        retainedControls.xPlacement = .fill

        let stateTitle = makeLabel("CUA Lab Runtime State")
        stateTitle.font = NSFont.systemFont(ofSize: 14, weight: .semibold)

        diffStatus.applyAccessibilityMarker(
            AXMarker.diffStatus,
            label: "CUA Lab Diff Revision 0"
        )
        stateDisplay.translatesAutoresizingMaskIntoConstraints = false
        stateDisplay.setAccessibilityElement(false)
        stateDisplay.heightAnchor.constraint(equalToConstant: 210).isActive = true
        oopSurface.onClick = { [weak self] isTrusted in
            guard let self else { return }
            self.state.oopClickCount += 1
            self.state.oopLastEventTrusted = isTrusted
            self.state.lastAction = "oop-click"
            self.oopSurface.setClickCount(self.state.oopClickCount)
            self.publishState()
        }
        oopSurface.onTextInput = { [weak self] value, isTrusted in
            guard let self else { return }
            self.state.oopTextValue = value
            self.state.oopTextInputCount += 1
            self.state.oopLastTextEventTrusted = isTrusted
            self.state.lastAction = "oop-text-input"
            self.publishState()
        }
        oopSurface.onTextChange = { [weak self] value, isTrusted in
            guard let self else { return }
            self.state.oopTextValue = value
            self.state.oopTextChangeCount += 1
            self.state.oopLastTextEventTrusted = isTrusted
            self.state.lastAction = "oop-text-change"
            self.publishState()
        }
        oopSurface.onHostLocalMouseEvent = { [weak self] eventType in
            guard let self else { return }
            switch eventType {
            case .leftMouseDown:
                self.state.oopHostLocalMouseDownCount += 1
            case .leftMouseUp:
                self.state.oopHostLocalMouseUpCount += 1
            default:
                return
            }
            self.publishState()
        }
        oopSurface.onTargetCenterChange = { [weak self] point in
            guard let self, let window = self.window else { return }
            self.state.oopTargetX = Int(point.x.rounded())
            self.state.oopTargetY = Int(
                (window.frame.height - point.y).rounded()
            )
            self.publishState()
        }
        oopSurface.onWebContentProcessIdentifierChange = { [weak self] pid in
            guard let self else { return }
            self.state.oopWebContentPID = pid
            self.publishState()
        }
        oopSurface.refreshWebContentProcessIdentifier()
        oopSurface.translatesAutoresizingMaskIntoConstraints = false
        oopSurface.widthAnchor.constraint(equalToConstant: 320).isActive = true
        oopSurface.heightAnchor.constraint(equalToConstant: 210).isActive = true

        let diagnosticsRow = NSStackView(views: [oopSurface, stateDisplay])
        diagnosticsRow.orientation = .horizontal
        diagnosticsRow.alignment = .top
        diagnosticsRow.spacing = 12
        diagnosticsRow.distribution = .fill

        let stack = NSStackView(views: [
            title,
            criticalActions,
            retainedControls,
            hierarchyContainer,
            advancedActions,
            coordinateContainer,
            scrollRegion,
            dragTarget,
            windowMoveHandle,
            diffStatus,
            stateTitle,
            diagnosticsRow
        ])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12

        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -22),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 18),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -18),
            criticalActions.widthAnchor.constraint(equalTo: stack.widthAnchor),
            retainedControls.widthAnchor.constraint(equalTo: stack.widthAnchor),
            hierarchyContainer.widthAnchor.constraint(equalTo: stack.widthAnchor),
            advancedActions.widthAnchor.constraint(equalTo: stack.widthAnchor),
            coordinateContainer.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scrollRegion.widthAnchor.constraint(equalTo: stack.widthAnchor),
            dragTarget.widthAnchor.constraint(equalTo: stack.widthAnchor),
            windowMoveHandle.widthAnchor.constraint(equalTo: stack.widthAnchor),
            diagnosticsRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            stateDisplay.widthAnchor.constraint(greaterThanOrEqualToConstant: 400)
        ])
        contentView.layoutSubtreeIfNeeded()
        updateActionGeometry()
    }

    private func makeButton(title: String, marker: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.applyAccessibilityMarker(marker, label: title)
        return button
    }

    private func makeLabel(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func synchronizeStaticControls() {
        checkbox.state = .off
        slider.doubleValue = Double(state.sliderValue)
        loadingIndicator.stopAnimation(nil)
        scrollRegion.contentView.scroll(to: .zero)
        scrollRegion.reflectScrolledClipView(scrollRegion.contentView)
        state.scrollOffset = 0
        state.lastAction = "launch"
        updateActionGeometry()
        DispatchQueue.main.async { [weak self] in
            self?.scrollRegion.publishesScrollChanges = true
        }
    }

    private func configureScrollRegion() {
        let document = LabFlippedDocumentView(
            frame: NSRect(x: 0, y: 0, width: 680, height: 420)
        )
        let top = NSTextField(labelWithString: "CUA Lab Scroll Start")
        top.frame = NSRect(x: 18, y: 20, width: 240, height: 24)
        let bottom = NSTextField(labelWithString: "CUA Lab Scroll End")
        bottom.frame = NSRect(x: 18, y: 370, width: 240, height: 24)
        document.addSubview(top)
        document.addSubview(bottom)

        scrollRegion.hasVerticalScroller = true
        scrollRegion.documentView = document
        scrollRegion.applyAccessibilityMarker(
            AXMarker.scrollRegion,
            label: "CUA Lab Scroll Region"
        )
        scrollRegion.heightAnchor.constraint(equalToConstant: 86).isActive = true
        scrollRegion.onScroll = { [weak self] offset in
            guard let self else { return }
            self.state.scrollOffset = offset
            self.state.lastAction = "scroll"
            self.publishState()
        }
    }

    @objc private func resetState() {
        resetGeometryRestoreGeneration += 1
        let restoreGeneration = resetGeometryRestoreGeneration
        closeModalIfPresent()
        closeSecondaryIfPresent()
        restorePrimaryWindowGeometry()
        state.reset(windowX: state.windowX, windowY: state.windowY)
        checkbox.state = .off
        setValueField.stringValue = ""
        typeTextField.stringValue = ""
        selectTextField.stringValue = ""
        window?.makeFirstResponder(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        slider.doubleValue = Double(state.sliderValue)
        popup.selectItem(at: 0)
        restoreCoordinateLayout()
        scrollRegion.publishesScrollChanges = false
        scrollRegion.contentView.scroll(to: .zero)
        scrollRegion.reflectScrolledClipView(scrollRegion.contentView)
        dragTarget.resetPosition()
        loadingIndicator.stopAnimation(nil)
        rebuildHierarchy(mode: .initial)
        oopSurface.setClickCount(state.oopClickCount)
        oopSurface.setTextValue(state.oopTextValue)
        oopSurface.refreshWebContentProcessIdentifier()
        oopSurface.requestTargetMeasurement()
        updateDiffStatus()
        state.lastAction = "reset"
        updateActionGeometry()
        publishState()
        DispatchQueue.main.async { [weak self] in
            self?.scrollRegion.publishesScrollChanges = true
        }
        scheduleResetGeometryRestores(generation: restoreGeneration)
    }

    private func scheduleResetGeometryRestores(generation: Int) {
        for delay in [0.15, 0.35, 0.65, 1.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self,
                      self.resetGeometryRestoreGeneration == generation
                else {
                    return
                }
                self.restorePrimaryWindowGeometry()
                self.publishState()
            }
        }
    }

    private func restorePrimaryWindowGeometry() {
        guard let window else {
            return
        }
        if let resetWindowSize {
            window.setFrame(
                NSRect(origin: window.frame.origin, size: resetWindowSize),
                display: true
            )
        }
        Self.positionOnPrimaryScreen(window)
        updateWindowOrigin()
    }

    @objc private func fullStateProbe() {
        state.fullStateProbeCount += 1
        state.lastAction = "full-state-probe"
        publishState()
    }

    @objc private func diffProbe() {
        state.diffProbeCount += 1
        state.lastAction = "diff-probe"
        updateDiffStatus()
        publishState()
    }

    @objc private func primaryButtonClick() {
        state.buttonClickCount += 1
        state.lastAction = "button-click"
        publishState()
    }

    @objc private func toggleCheckbox() {
        state.checkboxChecked = checkbox.state == .on
        state.lastAction = "checkbox"
        publishState()
    }

    @objc private func mutateHierarchy() {
        state.hierarchyGeneration += 1
        state.lastAction = "mutate-hierarchy"
        rebuildHierarchy(mode: .uniqueReplacement)
        publishState()
    }

    @objc private func removeStaleTarget() {
        state.hierarchyGeneration += 1
        state.lastAction = "remove-stale-target"
        rebuildHierarchy(mode: .missing)
        publishState()
    }

    @objc private func duplicateStaleTarget() {
        state.hierarchyGeneration += 1
        state.lastAction = "duplicate-stale-target"
        rebuildHierarchy(mode: .ambiguous)
        publishState()
    }

    @objc private func staleTargetClick() {
        state.staleTargetClickCount += 1
        state.lastAction = "stale-target-click"
        publishState()
    }

    @objc private func staleDecoyClick() {
        state.wrongTargetClickCount += 1
        state.lastAction = "stale-decoy-click"
        publishState()
    }

    @objc private func duplicateFirst() {
        state.ambiguousLastTarget = "first"
        state.ambiguousClickCount += 1
        state.lastAction = "ambiguous-first"
        publishState()
    }

    @objc private func duplicateSecond() {
        state.ambiguousLastTarget = "second"
        state.ambiguousClickCount += 1
        state.lastAction = "ambiguous-second"
        publishState()
    }

    @objc private func coordinateTargetClick() {
        // mouseDown records the coordinate click before the control action fires.
    }

    @objc private func coordinateDecoyClick() {
        // mouseDown records the coordinate decoy click before the control action fires.
    }

    @objc private func mutateCoordinateLayout() {
        coordinateContainer.removeArrangedSubview(coordinateTarget)
        coordinateTarget.removeFromSuperview()
        coordinateContainer.insertArrangedSubview(coordinateTarget, at: 2)
        state.coordinateGeneration += 1
        state.lastAction = "coordinate-layout-mutate"
        window?.contentView?.layoutSubtreeIfNeeded()
        updateActionGeometry()
        publishState()
    }

    private func restoreCoordinateLayout() {
        coordinateContainer.removeArrangedSubview(coordinateTarget)
        coordinateTarget.removeFromSuperview()
        coordinateContainer.insertArrangedSubview(coordinateTarget, at: 1)
        window?.contentView?.layoutSubtreeIfNeeded()
    }

    @objc private func openModal() {
        guard let window, window.attachedSheet == nil else {
            return
        }
        let sheet = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 150),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        sheet.title = "CUA Lab Modal"
        sheet.setAccessibilityIdentifier(AXMarker.modalWindow)
        sheet.setAccessibilityLabel("CUA Lab Modal")

        let closeButton = makeButton(
            title: "CUA Lab Modal Close",
            marker: AXMarker.modalClose,
            action: #selector(closeModal)
        )
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        sheet.contentView?.addSubview(closeButton)
        NSLayoutConstraint.activate([
            closeButton.centerXAnchor.constraint(equalTo: sheet.contentView!.centerXAnchor),
            closeButton.centerYAnchor.constraint(equalTo: sheet.contentView!.centerYAnchor)
        ])
        state.modalOpen = true
        state.lastAction = "open-modal"
        publishState()
        window.beginSheet(sheet)
    }

    @objc private func openSecondaryWindow() {
        if let secondaryWindow {
            if ProcessInfo.processInfo.environment["CUA_LAB_BACKGROUND"] == "1" {
                secondaryWindow.orderFrontRegardless()
            } else {
                secondaryWindow.makeKeyAndOrderFront(nil)
            }
            state.secondaryWindowOpen = true
            state.lastAction = "open-secondary-window"
            publishState()
            return
        }

        let secondary = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 360),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        secondary.title = "CUA Lab Secondary Window"
        secondary.isReleasedWhenClosed = false
        secondary.delegate = self

        let marker = NSTextField(labelWithString: "CUA Lab Secondary Window")
        marker.font = NSFont.systemFont(ofSize: 18, weight: .semibold)
        marker.applyAccessibilityMarker(
            AXMarker.secondaryWindow,
            label: "CUA Lab Secondary Window"
        )
        let action = makeButton(
            title: "CUA Lab Secondary Button",
            marker: AXMarker.secondaryButton,
            action: #selector(secondaryButtonClick)
        )
        let close = makeButton(
            title: "CUA Lab Secondary Close",
            marker: AXMarker.secondaryClose,
            action: #selector(closeSecondaryWindow)
        )

        let scroll = makeSecondaryScrollRegion()
        secondaryScrollRegion = scroll

        let stack = NSStackView(views: [marker, action, scroll, close])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        secondary.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: secondary.contentView!.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: secondary.contentView!.trailingAnchor, constant: -22),
            stack.topAnchor.constraint(equalTo: secondary.contentView!.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: secondary.contentView!.bottomAnchor, constant: -20),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])

        if let mainFrame = window?.frame {
            secondary.setFrameOrigin(
                NSPoint(x: mainFrame.maxX + 24, y: mainFrame.maxY - secondary.frame.height)
            )
        } else {
            secondary.center()
        }
        secondaryWindow = secondary
        state.secondaryWindowOpen = true
        state.lastAction = "open-secondary-window"
        publishState()
        if ProcessInfo.processInfo.environment["CUA_LAB_BACKGROUND"] == "1" {
            secondary.orderFrontRegardless()
        } else {
            secondary.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func makeSecondaryScrollRegion() -> LabScrollView {
        let scroll = LabScrollView()
        let document = LabFlippedDocumentView(
            frame: NSRect(x: 0, y: 0, width: 440, height: 420)
        )
        let top = NSTextField(labelWithString: "CUA Lab Secondary Scroll Start")
        top.frame = NSRect(x: 18, y: 20, width: 280, height: 24)
        let bottom = NSTextField(labelWithString: "CUA Lab Secondary Scroll End")
        bottom.frame = NSRect(x: 18, y: 370, width: 280, height: 24)
        document.addSubview(top)
        document.addSubview(bottom)
        scroll.hasVerticalScroller = true
        scroll.documentView = document
        scroll.applyAccessibilityMarker(
            AXMarker.secondaryScrollRegion,
            label: "CUA Lab Secondary Scroll Region"
        )
        scroll.heightAnchor.constraint(equalToConstant: 150).isActive = true
        scroll.onScroll = { [weak self] offset in
            guard let self else { return }
            self.state.secondaryScrollOffset = offset
            self.state.lastAction = "secondary-scroll"
            self.publishState()
        }
        DispatchQueue.main.async {
            scroll.publishesScrollChanges = true
        }
        return scroll
    }

    @objc private func secondaryButtonClick() {
        state.secondaryButtonClickCount += 1
        state.lastAction = "secondary-button-click"
        publishState()
    }

    @objc private func closeSecondaryWindow() {
        secondaryWindow?.orderOut(nil)
        state.secondaryWindowOpen = false
        state.lastAction = "close-secondary-window"
        publishState()
        if ProcessInfo.processInfo.environment["CUA_LAB_BACKGROUND"] == "1" {
            window?.orderFrontRegardless()
        } else {
            window?.makeKeyAndOrderFront(nil)
        }
    }

    @objc private func closeModal() {
        guard let sheet = window?.attachedSheet else {
            return
        }
        window?.endSheet(sheet)
        sheet.orderOut(nil)
        state.modalOpen = false
        state.lastAction = "close-modal"
        publishState()
    }

    private func recordFocus(_ control: String, action: String) {
        state.focusedControl = control
        state.lastAction = action
        publishState()
    }

    private func updateDiffStatus() {
        let value = "CUA Lab Diff Revision \(state.diffProbeCount)"
        diffStatus.stringValue = value
        diffStatus.setAccessibilityLabel(value)
    }

    private func updateActionGeometry() {
        guard let window else {
            return
        }

        let coordinateRect = coordinateTarget.convert(
            coordinateTarget.bounds,
            to: nil
        )
        state.coordinateTargetX = Int(coordinateRect.midX.rounded())
        state.coordinateTargetY = Int(
            (window.frame.height - coordinateRect.midY).rounded()
        )

        let dragStart = dragTarget.convert(NSPoint(x: 42, y: 42), to: nil)
        let dragEndLocalX = min(max(160, dragTarget.bounds.width / 2), 320)
        let dragEnd = dragTarget.convert(
            NSPoint(x: dragEndLocalX, y: 42),
            to: nil
        )
        state.dragStartX = Int(dragStart.x.rounded())
        state.dragStartY = Int((window.frame.height - dragStart.y).rounded())
        state.dragEndX = Int(dragEnd.x.rounded())
        state.dragEndY = Int((window.frame.height - dragEnd.y).rounded())

        let moveRect = windowMoveHandle.convert(windowMoveHandle.bounds, to: nil)
        let moveStart = NSPoint(x: moveRect.midX, y: moveRect.midY)
        let moveEnd = NSPoint(
            x: max(moveRect.minX + 20, moveRect.midX - 280),
            y: moveRect.midY
        )
        state.windowMoveStartX = Int(moveStart.x.rounded())
        state.windowMoveStartY = Int((window.frame.height - moveStart.y).rounded())
        state.windowMoveEndX = Int(moveEnd.x.rounded())
        state.windowMoveEndY = Int((window.frame.height - moveEnd.y).rounded())
        let moveReturnEnd = NSPoint(
            x: min(moveRect.maxX - 20, moveRect.midX + 280),
            y: moveRect.midY
        )
        state.windowMoveReturnEndX = Int(moveReturnEnd.x.rounded())
        state.windowMoveReturnEndY = Int(
            (window.frame.height - moveReturnEnd.y).rounded()
        )
    }

    private func rebuildHierarchy(mode: HierarchyMode) {
        switch mode {
        case .initial:
            state.hierarchyMode = "initial"
        case .uniqueReplacement:
            state.hierarchyMode = "unique-replacement"
        case .missing:
            state.hierarchyMode = "missing"
        case .ambiguous:
            state.hierarchyMode = "ambiguous"
        }

        for view in hierarchyContainer.arrangedSubviews {
            hierarchyContainer.removeArrangedSubview(view)
            view.removeFromSuperview()
        }

        let mutateButton = makeButton(
            title: "CUA Lab Mutate Hierarchy",
            marker: AXMarker.hierarchyMutate,
            action: #selector(mutateHierarchy)
        )
        hierarchyContainer.addArrangedSubview(mutateButton)

        let removeButton = makeButton(
            title: "CUA Lab Remove Stale Target",
            marker: AXMarker.hierarchyRemove,
            action: #selector(removeStaleTarget)
        )
        hierarchyContainer.addArrangedSubview(removeButton)

        let duplicateButton = makeButton(
            title: "CUA Lab Duplicate Stale Target",
            marker: AXMarker.hierarchyDuplicate,
            action: #selector(duplicateStaleTarget)
        )
        hierarchyContainer.addArrangedSubview(duplicateButton)

        if mode != .initial {
            let decoy = makeButton(
                title: "CUA Lab Stale Decoy",
                marker: "cua.lab.stale-decoy",
                action: #selector(staleDecoyClick)
            )
            hierarchyContainer.addArrangedSubview(decoy)
        }

        if mode != .missing {
            let target = makeButton(
                title: "CUA Lab Stale Target",
                marker: AXMarker.staleTarget,
                action: #selector(staleTargetClick)
            )
            staleTargetButton = target
            hierarchyContainer.addArrangedSubview(target)
        } else {
            staleTargetButton = nil
        }

        if mode == .ambiguous {
            let duplicate = makeButton(
                title: "CUA Lab Stale Target",
                marker: AXMarker.staleTarget,
                action: #selector(staleTargetClick)
            )
            hierarchyContainer.addArrangedSubview(duplicate)
        }
    }

    private func closeModalIfPresent() {
        guard let sheet = window?.attachedSheet else {
            state.modalOpen = false
            return
        }
        window?.endSheet(sheet)
        sheet.orderOut(nil)
        state.modalOpen = false
    }

    private func closeSecondaryIfPresent() {
        secondaryWindow?.orderOut(nil)
        state.secondaryWindowOpen = false
        state.secondaryScrollOffset = 0
    }

    private func updateWindowOrigin() {
        guard let frame = window?.frame else {
            return
        }
        state.windowX = Int(frame.origin.x.rounded())
        state.windowY = Int(frame.origin.y.rounded())
        state.windowWidth = Int(frame.width.rounded())
        state.windowHeight = Int(frame.height.rounded())
        state.windowScreenX = Int((window?.screen?.frame.origin.x ?? 0).rounded())
        state.windowScreenY = Int((window?.screen?.frame.origin.y ?? 0).rounded())
        if let currentScreen = window?.screen, let primaryScreen = Self.primaryScreen() {
            state.windowOnSecondaryScreen =
                currentScreen.frame.origin != primaryScreen.frame.origin
        } else {
            state.windowOnSecondaryScreen = false
        }
        updateActionGeometry()
    }

    func windowDidMove(_ notification: Notification) {
        guard let movedWindow = notification.object as? NSWindow,
              movedWindow === window
        else {
            return
        }
        updateWindowOrigin()
        publishState()
    }

    func windowDidResize(_ notification: Notification) {
        guard let resizedWindow = notification.object as? NSWindow,
              resizedWindow === window
        else {
            return
        }
        updateWindowOrigin()
        publishState()
    }

    func windowWillClose(_ notification: Notification) {
        if let closedWindow = notification.object as? NSWindow,
           closedWindow === secondaryWindow {
            state.secondaryWindowOpen = false
            state.lastAction = "close-secondary-window"
            publishState()
            return
        }
        updateWindowOrigin()
        publishState()
    }

    func recordTermination() {
        oopSurface.removeLocalMouseMonitor()
        updateWindowOrigin()
        publishState()
    }

    private func publishState() {
        let data = serializeState(state)
        stateDisplay.text = String(decoding: data, as: UTF8.self)
        do {
            try stateWriter?.write(data)
        } catch {
            NSLog("Codex CUA Lab state write failed: %@", String(describing: error))
        }
    }
}
