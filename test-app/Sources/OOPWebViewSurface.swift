import AppKit
import Darwin
import WebKit

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler? = nil) {
        self.delegate = delegate
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

private final class OOPAccessibilityButtonElement: NSAccessibilityElement {
    var onPress: (() -> Void)?

    override func accessibilityPerformPress() -> Bool {
        onPress?()
        return true
    }
}

final class OOPWebViewSurface: NSView, WKNavigationDelegate, WKScriptMessageHandler {
    private static let messageName = "oopClick"

    var onClick: ((Bool) -> Void)?
    var onTextInput: ((String, Bool) -> Void)?
    var onTextChange: ((String, Bool) -> Void)?
    var onHostLocalMouseEvent: ((NSEvent.EventType) -> Void)?
    var onTargetCenterChange: ((NSPoint) -> Void)?
    var onWebContentProcessIdentifierChange: ((Int) -> Void)?

    private let contentController: WKUserContentController
    private let messageHandler: WeakScriptMessageHandler
    private let webView: WKWebView
    private let accessibilityButton = OOPAccessibilityButtonElement()
    private var localMouseMonitor: Any?
    private var clickCount = 0
    private var textValue = ""

    override init(frame frameRect: NSRect) {
        let contentController = WKUserContentController()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        self.contentController = contentController
        messageHandler = WeakScriptMessageHandler()
        webView = WKWebView(frame: .zero, configuration: configuration)

        super.init(frame: frameRect)

        messageHandler.delegate = self
        contentController.add(messageHandler, name: Self.messageName)
        configureWebView()
        configureAccessibility()
        installLocalMouseMonitor()
        webView.loadHTMLString(Self.html, baseURL: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        removeLocalMouseMonitor()
        contentController.removeScriptMessageHandler(forName: Self.messageName)
    }

    func setClickCount(_ value: Int) {
        clickCount = value
        accessibilityButton.setAccessibilityValue(
            "CUA Lab OOP Click Count: \(value)"
        )
        webView.evaluateJavaScript("window.setOOPClickCount(\(value));")
    }

    func setTextValue(_ value: String) {
        textValue = value
        let encoded = try? JSONSerialization.data(
            withJSONObject: value,
            options: [.fragmentsAllowed]
        )
        guard let encoded,
              let literal = String(data: encoded, encoding: .utf8)
        else {
            return
        }
        webView.evaluateJavaScript("window.setOOPTextValue(\(literal));")
    }

    func requestTargetMeasurement() {
        webView.evaluateJavaScript("window.publishOOPTarget();")
    }

    func refreshWebContentProcessIdentifier() {
        onWebContentProcessIdentifierChange?(webContentProcessIdentifier())
    }

    func removeLocalMouseMonitor() {
        guard let localMouseMonitor else {
            return
        }
        NSEvent.removeMonitor(localMouseMonitor)
        self.localMouseMonitor = nil
    }

    private func configureWebView() {
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.allowsMagnification = false

        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    private func configureAccessibility() {
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityIdentifier(AXMarker.oopSurface)
        setAccessibilityLabel("CUA Lab OOP Web Surface")

        accessibilityButton.setAccessibilityParent(self)
        accessibilityButton.setAccessibilityRole(.button)
        accessibilityButton.setAccessibilityIdentifier(AXMarker.oopButton)
        accessibilityButton.setAccessibilityLabel("CUA Lab OOP Button")
        accessibilityButton.setAccessibilityValue("CUA Lab OOP Click Count: 0")
        accessibilityButton.setAccessibilityEnabled(true)
        accessibilityButton.onPress = { [weak self] in
            self?.webView.evaluateJavaScript(
                "document.getElementById('\(AXMarker.oopButton)').click();"
            )
        }
        setAccessibilityChildren([accessibilityButton, webView])
    }

    private func installLocalMouseMonitor() {
        localMouseMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .leftMouseUp]
        ) { [weak self] event in
            guard let self,
                  event.window === self.webView.window
            else {
                return event
            }
            let point = self.webView.convert(event.locationInWindow, from: nil)
            if self.webView.bounds.contains(point) {
                self.onHostLocalMouseEvent?(event.type)
            }
            return event
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.messageName,
              message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any],
              let action = body["action"] as? String
        else {
            return
        }
        switch action {
        case "click":
            guard let isTrusted = body["isTrusted"] as? Bool else {
                return
            }
            onClick?(isTrusted)
        case "target":
            guard let x = body["x"] as? NSNumber,
                  let y = body["y"] as? NSNumber
            else {
                return
            }
            let webPoint = NSPoint(
                x: CGFloat(truncating: x),
                y: webView.bounds.height - CGFloat(truncating: y)
            )
            let width = CGFloat(truncating: body["width"] as? NSNumber ?? 44)
            let height = CGFloat(truncating: body["height"] as? NSNumber ?? 44)
            accessibilityButton.setAccessibilityFrameInParentSpace(
                NSRect(
                    x: webPoint.x - width / 2,
                    y: webPoint.y - height / 2,
                    width: width,
                    height: height
                )
            )
            onTargetCenterChange?(webView.convert(webPoint, to: nil))
        case "text-input", "text-change":
            guard let value = body["value"] as? String,
                  let isTrusted = body["isTrusted"] as? Bool
            else {
                return
            }
            if action == "text-input" {
                onTextInput?(value, isTrusted)
            } else {
                onTextChange?(value, isTrusted)
            }
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshWebContentProcessIdentifier()
        setClickCount(clickCount)
        setTextValue(textValue)
        requestTargetMeasurement()
    }

    private func webContentProcessIdentifier() -> Int {
        let selector = NSSelectorFromString("_webProcessIdentifier")
        guard webView.responds(to: selector),
              let implementation = webView.method(for: selector)
        else {
            return 0
        }
        typealias Getter = @convention(c) (AnyObject, Selector) -> pid_t
        let getter = unsafeBitCast(implementation, to: Getter.self)
        return Int(getter(webView, selector))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let scheme = navigationAction.request.url?.scheme
        let isMemoryDocument =
            navigationAction.navigationType == .other &&
            (scheme == nil || scheme == "about")
        decisionHandler(isMemoryDocument ? .allow : .cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let scheme = navigationResponse.response.url?.scheme
        decisionHandler((scheme == nil || scheme == "about") ? .allow : .cancel)
    }

    private static let html = """
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src 'none'"
      >
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        :root {
          color-scheme: light dark;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: Canvas;
          color: CanvasText;
        }
        main {
          width: min(100%, 320px);
          padding: 12px;
          display: grid;
          gap: 8px;
          border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
          border-radius: 6px;
        }
        h2 {
          margin: 0;
          font-size: 15px;
          font-weight: 650;
          letter-spacing: 0;
        }
        button {
          min-height: 36px;
          border: 0;
          border-radius: 5px;
          padding: 0 14px;
          background: #087f5b;
          color: white;
          font: inherit;
          font-weight: 650;
          cursor: pointer;
        }
        button:active {
          transform: scale(0.98);
        }
        button:focus-visible {
          outline: 3px solid #74c0fc;
          outline-offset: 2px;
        }
        input {
          width: 100%;
          min-height: 34px;
          border: 1px solid color-mix(in srgb, CanvasText 30%, transparent);
          border-radius: 5px;
          padding: 6px 9px;
          background: Canvas;
          color: CanvasText;
          font: inherit;
        }
        input:focus-visible {
          outline: 3px solid #74c0fc;
          outline-offset: 1px;
        }
        [role="status"] {
          min-height: 18px;
          color: color-mix(in srgb, CanvasText 72%, transparent);
          font-size: 12px;
        }
      </style>
    </head>
    <body aria-label="CUA Lab OOP Web Surface">
      <main id="\(AXMarker.oopSurface)" aria-label="CUA Lab OOP Web Surface">
        <h2>CUA Lab OOP Web Surface</h2>
        <input
          id="\(AXMarker.oopText)"
          type="text"
          aria-label="CUA Lab OOP Text Field"
          aria-describedby="\(AXMarker.oopTextStatus)"
          autocomplete="off"
          spellcheck="false"
        >
        <div
          id="\(AXMarker.oopTextStatus)"
          role="status"
          aria-live="polite"
          aria-label="CUA Lab OOP Text Value"
        >
          CUA Lab OOP Text Value:
        </div>
        <button
          id="\(AXMarker.oopButton)"
          type="button"
          aria-label="CUA Lab OOP Button"
          aria-describedby="\(AXMarker.oopCount)"
        >
          CUA Lab OOP Button
        </button>
        <div
          id="\(AXMarker.oopCount)"
          role="status"
          aria-live="polite"
          aria-label="CUA Lab OOP Click Count"
        >
          CUA Lab OOP Click Count: 0
        </div>
      </main>
      <script>
        const button = document.getElementById("\(AXMarker.oopButton)");
        const countValue = document.getElementById("\(AXMarker.oopCount)");
        const textInput = document.getElementById("\(AXMarker.oopText)");
        const textStatus = document.getElementById("\(AXMarker.oopTextStatus)");

        window.setOOPClickCount = (value) => {
          countValue.textContent = `CUA Lab OOP Click Count: ${value}`;
        };

        window.setOOPTextValue = (value) => {
          textInput.value = value;
          textStatus.textContent = `CUA Lab OOP Text Value: ${value}`;
        };

        window.publishOOPTarget = () => {
          const rect = button.getBoundingClientRect();
          window.webkit.messageHandlers.\(messageName).postMessage({
            action: "target",
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
          });
        };

        button.addEventListener("click", (event) => {
          window.webkit.messageHandlers.\(messageName).postMessage({
            action: "click",
            isTrusted: event.isTrusted
          });
        });

        textInput.addEventListener("input", (event) => {
          textStatus.textContent = `CUA Lab OOP Text Value: ${textInput.value}`;
          window.webkit.messageHandlers.\(messageName).postMessage({
            action: "text-input",
            value: textInput.value,
            isTrusted: event.isTrusted
          });
        });

        textInput.addEventListener("change", (event) => {
          window.webkit.messageHandlers.\(messageName).postMessage({
            action: "text-change",
            value: textInput.value,
            isTrusted: event.isTrusted
          });
        });

        window.addEventListener("load", () => {
          requestAnimationFrame(window.publishOOPTarget);
        }, { once: true });
      </script>
    </body>
    </html>
    """
}
