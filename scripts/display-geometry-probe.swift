#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

private struct PointValue: Codable, Equatable {
    let x: Double
    let y: Double
}

private struct SizeValue: Codable, Equatable {
    let width: Double
    let height: Double
}

private struct PixelSize: Codable, Equatable {
    let width: Int
    let height: Int
}

private struct RectValue: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct EdgeInsetsValue: Codable, Equatable {
    let top: Double
    let left: Double
    let bottom: Double
    let right: Double
}

private struct ScaleValue: Codable, Equatable {
    let x: Double
    let y: Double
}

private struct DeviceDescriptionValue: Codable, Equatable {
    let sanitizedProjection: Bool
    let screenNumberMatchesDisplayID: Bool
    let isScreen: Bool?
    let sizePoints: SizeValue?
    let resolutionDPI: SizeValue?
    let bitsPerSample: Int?
    let colorSpaceName: String?
}

private struct NSScreenValue: Codable, Equatable {
    let framePoints: RectValue
    let visibleFramePoints: RectValue
    let visibleInsetsPoints: EdgeInsetsValue
    let backingScaleFactor: Double
    let deviceDescription: DeviceDescriptionValue
}

private struct CoreGraphicsValue: Codable, Equatable {
    let boundsPoints: RectValue
    let pixels: PixelSize
    let pixelsPerPoint: ScaleValue
    let isMain: Bool
    let isBuiltin: Bool
    let isActive: Bool
    let isOnline: Bool
    let rotationDegrees: Double
}

private struct AlignmentValue: Codable, Equatable {
    let appKitFrameConvertedToCoreGraphicsPoints: RectValue
    let appKitAndCoreGraphicsBoundsAgree: Bool
    let appKitBackingScaleMatchesCoreGraphicsPixels: Bool
}

private struct DisplayNameValue: Codable, Equatable {
    let modelAlias: String
    let duplicateOrdinalSuffixRemoved: Bool
}

private struct DisplayValue: Codable, Equatable {
    let alias: String
    let displayID: UInt32
    let name: DisplayNameValue
    let nsScreen: NSScreenValue
    let coreGraphics: CoreGraphicsValue
    let alignment: AlignmentValue
}

private struct ModelGroupValue: Codable, Equatable {
    let alias: String
    let displayAliases: [String]
    let displayCount: Int
    let allPointSizesEqual: Bool
    let allPixelSizesEqual: Bool
}

private struct AxisTransformValue: Codable, Equatable {
    let appKitOrigin: String
    let coreGraphicsOrigin: String
    let xOffsetPoints: Double
    let appKitMainTopYPoints: Double
    let rectFormula: String
}

private struct DesktopValue: Codable, Equatable {
    let screenCount: Int
    let onlineCoreGraphicsDisplayCount: Int
    let unmatchedOnlineDisplayIDs: [UInt32]
    let mainDisplayAlias: String
    let appKitUnionPoints: RectValue
    let coreGraphicsUnionPoints: RectValue
    let hasNegativeAppKitCoordinates: Bool
    let hasNegativeCoreGraphicsCoordinates: Bool
    let axisTransform: AxisTransformValue
}

private struct CoordinateSpaceValue: Codable, Equatable {
    let unit: String
    let origin: String
    let xDirection: String
    let yDirection: String
}

private struct CoordinateSpacesValue: Codable, Equatable {
    let appKitGlobal: CoordinateSpaceValue
    let coreGraphicsGlobal: CoordinateSpaceValue
    let displayPixels: CoordinateSpaceValue
}

private struct SafetyValue: Codable, Equatable {
    let readOnly: Bool
    let computerUseSocketContacted: Bool
    let computerUseActionsInvoked: Bool
    let accessibilityQueried: Bool
    let screenshotsCaptured: Bool
    let windowMetadataCollected: Bool
    let serialNumbersCollected: Bool
    let rawLocalizedNamesPersisted: Bool
    let hostMetadataCollected: Bool
}

private struct ProbeOutput: Codable, Equatable {
    let schemaVersion: Int
    let probe: String
    let safety: SafetyValue
    let coordinateSpaces: CoordinateSpacesValue
    let desktop: DesktopValue
    let modelGroups: [ModelGroupValue]
    let displays: [DisplayValue]
}

private struct ScreenObservation {
    let screen: NSScreen
    let displayID: CGDirectDisplayID
    let normalizedName: String
    let duplicateOrdinalSuffixRemoved: Bool
    let cgBounds: CGRect
    let pixels: PixelSize
}

private func clean(_ value: CGFloat) -> Double {
    let number = Double(value)
    if abs(number) < 0.000_000_5 {
        return 0
    }
    return (number * 1_000_000).rounded() / 1_000_000
}

private func clean(_ value: Double) -> Double {
    if abs(value) < 0.000_000_5 {
        return 0
    }
    return (value * 1_000_000).rounded() / 1_000_000
}

private func rectValue(_ rect: CGRect) -> RectValue {
    RectValue(
        x: clean(rect.origin.x),
        y: clean(rect.origin.y),
        width: clean(rect.size.width),
        height: clean(rect.size.height)
    )
}

private func sizeValue(_ size: CGSize) -> SizeValue {
    SizeValue(width: clean(size.width), height: clean(size.height))
}

private func union(_ rects: [CGRect]) -> CGRect {
    rects.dropFirst().reduce(rects.first ?? .zero) { partial, rect in
        partial.union(rect)
    }
}

private func normalizedDisplayName(_ name: String) -> (name: String, removed: Bool) {
    let normalized = name.replacingOccurrences(
        of: #"\s+\(\d+\)$"#,
        with: "",
        options: .regularExpression
    )
    return (normalized, normalized != name)
}

private func displayID(for screen: NSScreen) throws -> CGDirectDisplayID {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    guard let number = screen.deviceDescription[key] as? NSNumber else {
        throw ProbeError.missingDisplayID
    }
    return number.uint32Value
}

private func optionalBool(
    _ description: [NSDeviceDescriptionKey: Any],
    key: String
) -> Bool? {
    let value = description[NSDeviceDescriptionKey(key)]
    if let bool = value as? Bool {
        return bool
    }
    if let text = value as? String {
        switch text.lowercased() {
        case "yes", "true", "1":
            return true
        case "no", "false", "0":
            return false
        default:
            break
        }
    }
    return (value as? NSNumber)?.boolValue
}

private func optionalInt(
    _ description: [NSDeviceDescriptionKey: Any],
    key: String
) -> Int? {
    (description[NSDeviceDescriptionKey(key)] as? NSNumber)?.intValue
}

private func optionalSize(
    _ description: [NSDeviceDescriptionKey: Any],
    key: String
) -> SizeValue? {
    guard let value = description[NSDeviceDescriptionKey(key)] as? NSValue else {
        return nil
    }
    return sizeValue(value.sizeValue)
}

private func optionalString(
    _ description: [NSDeviceDescriptionKey: Any],
    key: String
) -> String? {
    description[NSDeviceDescriptionKey(key)] as? String
}

private func approximatelyEqual(_ left: Double, _ right: Double) -> Bool {
    abs(left - right) <= 0.000_001
}

private func rectsApproximatelyEqual(_ left: RectValue, _ right: RectValue) -> Bool {
    approximatelyEqual(left.x, right.x)
        && approximatelyEqual(left.y, right.y)
        && approximatelyEqual(left.width, right.width)
        && approximatelyEqual(left.height, right.height)
}

private func onlineDisplayIDs() throws -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    guard CGGetOnlineDisplayList(0, nil, &count) == .success else {
        throw ProbeError.onlineDisplayEnumerationFailed
    }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetOnlineDisplayList(count, &displays, &count) == .success else {
        throw ProbeError.onlineDisplayEnumerationFailed
    }
    return Array(displays.prefix(Int(count))).sorted()
}

private enum ProbeError: Error, CustomStringConvertible {
    case noScreens
    case missingDisplayID
    case missingMainScreen
    case onlineDisplayEnumerationFailed

    var description: String {
        switch self {
        case .noScreens:
            return "NSScreen.screens returned no displays"
        case .missingDisplayID:
            return "NSScreen.deviceDescription is missing NSScreenNumber"
        case .missingMainScreen:
            return "the CoreGraphics main display was not present in NSScreen.screens"
        case .onlineDisplayEnumerationFailed:
            return "CGGetOnlineDisplayList failed"
        }
    }
}

private func collect() throws -> ProbeOutput {
    let screens = NSScreen.screens
    guard !screens.isEmpty else {
        throw ProbeError.noScreens
    }

    var observations = try screens.map { screen -> ScreenObservation in
        let id = try displayID(for: screen)
        let name = normalizedDisplayName(screen.localizedName)
        return ScreenObservation(
            screen: screen,
            displayID: id,
            normalizedName: name.name,
            duplicateOrdinalSuffixRemoved: name.removed,
            cgBounds: CGDisplayBounds(id),
            pixels: PixelSize(
                width: Int(CGDisplayPixelsWide(id)),
                height: Int(CGDisplayPixelsHigh(id))
            )
        )
    }

    let mainDisplayID = CGMainDisplayID()
    observations.sort { left, right in
        let leftMain = left.displayID == mainDisplayID
        let rightMain = right.displayID == mainDisplayID
        if leftMain != rightMain {
            return leftMain
        }
        let leftBounds = left.cgBounds
        let rightBounds = right.cgBounds
        if leftBounds.minX != rightBounds.minX {
            return leftBounds.minX < rightBounds.minX
        }
        if leftBounds.minY != rightBounds.minY {
            return leftBounds.minY < rightBounds.minY
        }
        return left.displayID < right.displayID
    }

    guard let mainObservation = observations.first(where: {
        $0.displayID == mainDisplayID
    }) else {
        throw ProbeError.missingMainScreen
    }

    let mainFrame = mainObservation.screen.frame
    var modelAliasByName: [String: String] = [:]
    for observation in observations {
        if modelAliasByName[observation.normalizedName] == nil {
            modelAliasByName[observation.normalizedName] =
                "display-model-\(modelAliasByName.count + 1)"
        }
    }

    let displays = observations.enumerated().map { index, observation -> DisplayValue in
        let screen = observation.screen
        let frame = screen.frame
        let visibleFrame = screen.visibleFrame
        let cgBounds = rectValue(observation.cgBounds)
        let converted = RectValue(
            x: clean(frame.minX - mainFrame.minX),
            y: clean(mainFrame.maxY - frame.maxY),
            width: clean(frame.width),
            height: clean(frame.height)
        )
        let xScale = observation.cgBounds.width == 0
            ? 0
            : Double(observation.pixels.width) / Double(observation.cgBounds.width)
        let yScale = observation.cgBounds.height == 0
            ? 0
            : Double(observation.pixels.height) / Double(observation.cgBounds.height)
        let backingScale = Double(screen.backingScaleFactor)
        let description = screen.deviceDescription
        let screenNumber = (
            description[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        )?.uint32Value

        return DisplayValue(
            alias: "display-\(index + 1)",
            displayID: observation.displayID,
            name: DisplayNameValue(
                modelAlias: modelAliasByName[observation.normalizedName]!,
                duplicateOrdinalSuffixRemoved: observation.duplicateOrdinalSuffixRemoved
            ),
            nsScreen: NSScreenValue(
                framePoints: rectValue(frame),
                visibleFramePoints: rectValue(visibleFrame),
                visibleInsetsPoints: EdgeInsetsValue(
                    top: clean(frame.maxY - visibleFrame.maxY),
                    left: clean(visibleFrame.minX - frame.minX),
                    bottom: clean(visibleFrame.minY - frame.minY),
                    right: clean(frame.maxX - visibleFrame.maxX)
                ),
                backingScaleFactor: clean(backingScale),
                deviceDescription: DeviceDescriptionValue(
                    sanitizedProjection: true,
                    screenNumberMatchesDisplayID: screenNumber == observation.displayID,
                    isScreen: optionalBool(description, key: "NSDeviceIsScreen"),
                    sizePoints: optionalSize(description, key: "NSDeviceSize"),
                    resolutionDPI: optionalSize(description, key: "NSDeviceResolution"),
                    bitsPerSample: optionalInt(description, key: "NSDeviceBitsPerSample"),
                    colorSpaceName: optionalString(
                        description,
                        key: "NSDeviceColorSpaceName"
                    )
                )
            ),
            coreGraphics: CoreGraphicsValue(
                boundsPoints: cgBounds,
                pixels: observation.pixels,
                pixelsPerPoint: ScaleValue(x: clean(xScale), y: clean(yScale)),
                isMain: CGDisplayIsMain(observation.displayID) != 0,
                isBuiltin: CGDisplayIsBuiltin(observation.displayID) != 0,
                isActive: CGDisplayIsActive(observation.displayID) != 0,
                isOnline: CGDisplayIsOnline(observation.displayID) != 0,
                rotationDegrees: clean(CGDisplayRotation(observation.displayID))
            ),
            alignment: AlignmentValue(
                appKitFrameConvertedToCoreGraphicsPoints: converted,
                appKitAndCoreGraphicsBoundsAgree: rectsApproximatelyEqual(
                    converted,
                    cgBounds
                ),
                appKitBackingScaleMatchesCoreGraphicsPixels:
                    approximatelyEqual(backingScale, xScale)
                    && approximatelyEqual(backingScale, yScale)
            )
        )
    }

    let displayByAlias = Dictionary(uniqueKeysWithValues: displays.map {
        ($0.alias, $0)
    })
    let groupedNames = Dictionary(grouping: observations.enumerated()) {
        $0.element.normalizedName
    }
    let modelGroups = modelAliasByName
        .map { name, alias -> ModelGroupValue in
            let members = groupedNames[name]!.map { index, _ in
                displays[index].alias
            }
            let pointSizes = members.map {
                displayByAlias[$0]!.nsScreen.framePoints
            }
            let pixelSizes = members.map {
                displayByAlias[$0]!.coreGraphics.pixels
            }
            return ModelGroupValue(
                alias: alias,
                displayAliases: members,
                displayCount: members.count,
                allPointSizesEqual: pointSizes.dropFirst().allSatisfy {
                    $0.width == pointSizes[0].width && $0.height == pointSizes[0].height
                },
                allPixelSizesEqual: pixelSizes.dropFirst().allSatisfy {
                    $0 == pixelSizes[0]
                }
            )
        }
        .sorted { $0.alias < $1.alias }

    let onlineIDs = try onlineDisplayIDs()
    let matchedIDs = Set(observations.map(\.displayID))
    let appKitUnion = union(observations.map(\.screen.frame))
    let coreGraphicsUnion = union(observations.map(\.cgBounds))
    let mainAlias = displays.first(where: {
        $0.displayID == mainDisplayID
    })!.alias

    return ProbeOutput(
        schemaVersion: 1,
        probe: "display-geometry",
        safety: SafetyValue(
            readOnly: true,
            computerUseSocketContacted: false,
            computerUseActionsInvoked: false,
            accessibilityQueried: false,
            screenshotsCaptured: false,
            windowMetadataCollected: false,
            serialNumbersCollected: false,
            rawLocalizedNamesPersisted: false,
            hostMetadataCollected: false
        ),
        coordinateSpaces: CoordinateSpacesValue(
            appKitGlobal: CoordinateSpaceValue(
                unit: "points",
                origin: "bottom-left of main display",
                xDirection: "right",
                yDirection: "up"
            ),
            coreGraphicsGlobal: CoordinateSpaceValue(
                unit: "points",
                origin: "top-left of main display",
                xDirection: "right",
                yDirection: "down"
            ),
            displayPixels: CoordinateSpaceValue(
                unit: "pixels",
                origin: "top-left of each display image",
                xDirection: "right",
                yDirection: "down"
            )
        ),
        desktop: DesktopValue(
            screenCount: displays.count,
            onlineCoreGraphicsDisplayCount: onlineIDs.count,
            unmatchedOnlineDisplayIDs: onlineIDs.filter { !matchedIDs.contains($0) },
            mainDisplayAlias: mainAlias,
            appKitUnionPoints: rectValue(appKitUnion),
            coreGraphicsUnionPoints: rectValue(coreGraphicsUnion),
            hasNegativeAppKitCoordinates:
                appKitUnion.minX < 0 || appKitUnion.minY < 0,
            hasNegativeCoreGraphicsCoordinates:
                coreGraphicsUnion.minX < 0 || coreGraphicsUnion.minY < 0,
            axisTransform: AxisTransformValue(
                appKitOrigin: "bottom-left of main display",
                coreGraphicsOrigin: "top-left of main display",
                xOffsetPoints: clean(-mainFrame.minX),
                appKitMainTopYPoints: clean(mainFrame.maxY),
                rectFormula:
                    "cg.x=appKit.x-main.minX; cg.y=main.maxY-appKit.maxY"
            )
        ),
        modelGroups: modelGroups,
        displays: displays
    )
}

do {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(collect())
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
} catch {
    FileHandle.standardError.write(Data("display geometry probe failed: \(error)\n".utf8))
    exit(1)
}
