import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var labWindowController: LabWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
        let controller = LabWindowController()
        labWindowController = controller
        if ProcessInfo.processInfo.environment["CUA_LAB_BACKGROUND"] == "1" {
            DispatchQueue.main.async {
                NSApp.unhideWithoutActivation()
                controller.window?.collectionBehavior.insert(.moveToActiveSpace)
                controller.window?.orderFrontRegardless()
            }
        } else {
            controller.showWindow(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        labWindowController?.recordTermination()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        let quitItem = NSMenuItem(
            title: "Quit Codex CUA Lab",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenu.addItem(quitItem)
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)
        NSApp.mainMenu = mainMenu
    }
}
