import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let targetPid = pid_t(CommandLine.arguments[1])
else {
    FileHandle.standardError.write(
        Data("usage: frontmost-sentinel.swift <target-pid> <output-json>\n".utf8)
    )
    exit(64)
}

let outputPath = CommandLine.arguments[2]
let stopped = DispatchSemaphore(value: 0)
signal(SIGTERM, SIG_IGN)
let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM)
signalSource.setEventHandler {
    stopped.signal()
}
signalSource.resume()

func frontmostApplicationPid() -> pid_t? {
    guard let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return nil
    }
    for window in windows {
        guard let layer = window[kCGWindowLayer as String] as? Int,
              layer == 0,
              let pid = window[kCGWindowOwnerPID as String] as? pid_t
        else {
            continue
        }
        return pid
    }
    return nil
}

var sampleCount = 0
var targetForegroundSamples = 0
var maximumGapMilliseconds = 0
var previousSampleMilliseconds: Int64?

FileHandle.standardOutput.write(Data("READY\n".utf8))
while true {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    if let previousSampleMilliseconds {
        maximumGapMilliseconds = max(
            maximumGapMilliseconds,
            Int(now - previousSampleMilliseconds)
        )
    }
    previousSampleMilliseconds = now
    sampleCount += 1
    if frontmostApplicationPid() == targetPid {
        targetForegroundSamples += 1
    }
    if stopped.wait(timeout: .now() + .milliseconds(10)) == .success {
        break
    }
}

let result: [String: Any] = [
    "sampleCount": sampleCount,
    "targetForegroundSamples": targetForegroundSamples,
    "maxGapMilliseconds": maximumGapMilliseconds,
]
let data = try JSONSerialization.data(
    withJSONObject: result,
    options: [.prettyPrinted, .sortedKeys]
)
try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
