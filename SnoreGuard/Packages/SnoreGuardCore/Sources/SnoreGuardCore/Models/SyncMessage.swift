import Foundation

public enum SyncMessage: Codable, Sendable {
    case sessionState(SleepSessionState)
    case nudgeRequest(NudgeRequest)
    case sessionSummary(SleepSession)
    case settingsUpdate(UserSettings)
    case heartbeat(Date)
}

public struct NudgeRequest: Codable, Sendable {
    public let sessionID: UUID
    public let level: HapticLevel
    public let confidence: Double
    public let timestamp: Date

    public init(
        sessionID: UUID,
        level: HapticLevel,
        confidence: Double,
        timestamp: Date = .now
    ) {
        self.sessionID = sessionID
        self.level = level
        self.confidence = confidence
        self.timestamp = timestamp
    }
}
