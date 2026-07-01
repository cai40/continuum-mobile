import Foundation

public enum SleepSessionState: String, Codable, Sendable {
    case idle
    case arming
    case active
    case paused
    case ended
}

public struct SleepSession: Identifiable, Codable, Sendable {
    public let id: UUID
    public var state: SleepSessionState
    public var startedAt: Date?
    public var endedAt: Date?
    public var snoreEvents: [SnoreEvent]
    public var interventions: [InterventionEvent]
    public var settings: UserSettings

    public init(
        id: UUID = UUID(),
        state: SleepSessionState = .idle,
        startedAt: Date? = nil,
        endedAt: Date? = nil,
        snoreEvents: [SnoreEvent] = [],
        interventions: [InterventionEvent] = [],
        settings: UserSettings = UserSettings()
    ) {
        self.id = id
        self.state = state
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.snoreEvents = snoreEvents
        self.interventions = interventions
        self.settings = settings
    }

    public var snoreCount: Int { snoreEvents.count }
    public var interventionCount: Int { interventions.count }

    public var duration: TimeInterval? {
        guard let startedAt else { return nil }
        let end = endedAt ?? .now
        return end.timeIntervalSince(startedAt)
    }
}
