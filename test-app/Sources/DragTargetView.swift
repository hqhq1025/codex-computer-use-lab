import AppKit

final class DragTargetView: NSView {
    var onPositionChange: ((Int, Int) -> Void)?

    private let tokenSize = NSSize(width: 46, height: 46)
    private var tokenOrigin = NSPoint(x: 19, y: 19)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        applyAccessibilityMarker(AXMarker.dragTarget, label: "Draggable synthetic target")
        setAccessibilityRole(.group)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override var acceptsFirstResponder: Bool {
        true
    }

    func resetPosition() {
        tokenOrigin = NSPoint(x: 19, y: 19)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        NSColor.windowBackgroundColor.setFill()
        bounds.fill()

        let track = bounds.insetBy(dx: 1, dy: 1)
        let trackPath = NSBezierPath(roundedRect: track, xRadius: 6, yRadius: 6)
        NSColor.separatorColor.setStroke()
        trackPath.lineWidth = 1
        trackPath.stroke()

        let tokenRect = NSRect(origin: tokenOrigin, size: tokenSize)
        let tokenPath = NSBezierPath(roundedRect: tokenRect, xRadius: 5, yRadius: 5)
        NSColor.systemTeal.setFill()
        tokenPath.fill()

        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: NSColor.white
        ]
        let text = "DRAG" as NSString
        let textSize = text.size(withAttributes: attributes)
        text.draw(
            at: NSPoint(
                x: tokenRect.midX - textSize.width / 2,
                y: tokenRect.midY - textSize.height / 2
            ),
            withAttributes: attributes
        )
    }

    override func mouseDown(with event: NSEvent) {
        updatePosition(with: convert(event.locationInWindow, from: nil))
    }

    override func mouseDragged(with event: NSEvent) {
        updatePosition(with: convert(event.locationInWindow, from: nil))
    }

    private func updatePosition(with point: NSPoint) {
        let maxX = max(0, bounds.width - tokenSize.width)
        let maxY = max(0, bounds.height - tokenSize.height)
        tokenOrigin = NSPoint(
            x: min(max(0, point.x - tokenSize.width / 2), maxX),
            y: min(max(0, point.y - tokenSize.height / 2), maxY)
        )
        needsDisplay = true

        let centerX = Int((tokenOrigin.x + tokenSize.width / 2).rounded())
        let centerY = Int((tokenOrigin.y + tokenSize.height / 2).rounded())
        onPositionChange?(centerX, centerY)
    }
}
