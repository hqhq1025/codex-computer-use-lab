import AppKit

final class LabTextField: NSTextField {
    var controlName = ""
    var onFocus: ((String) -> Void)?
    var onValueChange: ((String) -> Void)?
    var onSelectionChange: ((NSRange) -> Void)?

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted {
            onFocus?(controlName)
        }
        return accepted
    }

    override func textDidChange(_ notification: Notification) {
        super.textDidChange(notification)
        onValueChange?(stringValue)
    }

    override func setAccessibilitySelectedTextRange(_ accessibilitySelectedTextRange: NSRange) {
        super.setAccessibilitySelectedTextRange(accessibilitySelectedTextRange)
        onSelectionChange?(accessibilitySelectedTextRange)
    }
}

final class LabSlider: NSSlider {
    var onIncrement: ((Int) -> Void)?

    override func accessibilityPerformIncrement() -> Bool {
        doubleValue = min(maxValue, doubleValue + max(1, altIncrementValue))
        onIncrement?(Int(doubleValue.rounded()))
        return true
    }
}

final class LabScrollView: NSScrollView {
    var onScroll: ((Int) -> Void)?
    var publishesScrollChanges = false

    override func scrollWheel(with event: NSEvent) {
        super.scrollWheel(with: event)
        publishScrollOffset()
    }

    override func reflectScrolledClipView(_ clipView: NSClipView) {
        super.reflectScrolledClipView(clipView)
        publishScrollOffset()
    }

    private func publishScrollOffset() {
        guard publishesScrollChanges else {
            return
        }
        let offset = Int(contentView.bounds.origin.y.rounded())
        onScroll?(max(0, offset))
    }
}

final class LabFlippedDocumentView: NSView {
    override var isFlipped: Bool {
        true
    }
}

final class StateDisplayView: NSView {
    var text = "" {
        didSet {
            needsDisplay = true
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.textBackgroundColor.setFill()
        bounds.fill()
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: paragraph
        ]
        (text as NSString).draw(
            in: bounds.insetBy(dx: 14, dy: 14),
            withAttributes: attributes
        )
    }
}

final class CoordinateTargetButton: NSButton {
    var onCoordinateClick: (() -> Void)?

    override func mouseDown(with event: NSEvent) {
        onCoordinateClick?()
        super.mouseDown(with: event)
    }
}

final class WindowMoveHandleView: NSView {
    var onWindowMove: (() -> Void)?

    private var startPointInWindow: NSPoint?
    private var startWindowOrigin: NSPoint?

    override var acceptsFirstResponder: Bool {
        true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.controlAccentColor.withAlphaComponent(0.18).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 5, yRadius: 5).fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: NSColor.labelColor
        ]
        ("CUA Lab Window Handle" as NSString).draw(
            at: NSPoint(x: 12, y: 8),
            withAttributes: attributes
        )
    }

    override func mouseDown(with event: NSEvent) {
        startPointInWindow = event.locationInWindow
        startWindowOrigin = window?.frame.origin
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let startPointInWindow, let startWindowOrigin else {
            return
        }
        let deltaX = event.locationInWindow.x - startPointInWindow.x
        let deltaY = event.locationInWindow.y - startPointInWindow.y
        window.setFrameOrigin(
            NSPoint(x: startWindowOrigin.x + deltaX, y: startWindowOrigin.y + deltaY)
        )
        onWindowMove?()
    }
}
