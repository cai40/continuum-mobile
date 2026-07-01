import Foundation

public struct SnoreEvent: Identifiable, Codable, Sendable {
    public let id: UUID
    public let timestamp: Date
    public let confidence: Double
    public let chunkDuration: TimeInterval

    public init(
        id: UUID = UUID(),
        timestamp: Date = .now,
        confidence: Double,
        chunkDuration: TimeInterval = 1.5
    ) {
        self.id = id
        self.timestamp = timestamp
        self.confidence = confidence
        self.chunkDuration = chunkDuration
    }
}

public struct InterventionEvent: Identifiable, Codable, Sendable {
    public let id: UUID
    public let timestamp: Date
    public let level: HapticLevel
    public let triggerConfidence: Double

    public init(
        id: UUID = UUID(),
        timestamp: Date = .now,
        level: HapticLevel,
        triggerConfidence: Double
    ) {
        self.id = id
        self.timestamp = timestamp
        self.level = level
        self.triggerConfidence = triggerConfidence
    }
}

public enum HapticLevel: Int, Codable, Sendable, CaseIterable {
    case gentle = 1
    case medium = 2
    case firm = 3
}
