import Foundation

public struct InterventionDecision: Sendable, Equatable {
    public let shouldIntervene: Bool
    public let level: HapticLevel
    public let reason: String

    public static let none = InterventionDecision(shouldIntervene: false, level: .gentle, reason: "no trigger")
}

public struct InterventionPolicy: Sendable {
    public var settings: UserSettings
    private var recentSnoreTimestamps: [Date] = []
    private var lastInterventionAt: Date?
    private var consecutiveInterventions: Int = 0

    public init(settings: UserSettings = UserSettings()) {
        self.settings = settings
    }

    public mutating func reset() {
        recentSnoreTimestamps.removeAll()
        lastInterventionAt = nil
        consecutiveInterventions = 0
    }

    public mutating func updateSettings(_ settings: UserSettings) {
        self.settings = settings
    }

    public mutating func evaluate(
        detection: SnoreDetectionResult,
        interventionCount: Int,
        now: Date = .now
    ) -> InterventionDecision {
        pruneRecentSnores(now: now)

        guard case let .snore(confidence) = detection else {
            return .none
        }

        recentSnoreTimestamps.append(now)
        pruneRecentSnores(now: now)

        guard recentSnoreTimestamps.count >= settings.debounceHitCount else {
            return InterventionDecision(
                shouldIntervene: false,
                level: .gentle,
                reason: "debouncing"
            )
        }

        if interventionCount >= settings.maxInterventionsPerNight {
            return InterventionDecision(
                shouldIntervene: false,
                level: .gentle,
                reason: "nightly cap reached"
            )
        }

        if let lastInterventionAt {
            let cooldown = TimeInterval(settings.cooldownMinutes * 60)
            if now.timeIntervalSince(lastInterventionAt) < cooldown {
                return InterventionDecision(
                    shouldIntervene: false,
                    level: .gentle,
                    reason: "cooldown active"
                )
            }
        }

        let level: HapticLevel
        if settings.enableEscalation {
            consecutiveInterventions = min(consecutiveInterventions + 1, HapticLevel.firm.rawValue)
            level = HapticLevel(rawValue: consecutiveInterventions) ?? .gentle
        } else {
            level = .gentle
        }

        lastInterventionAt = now
        recentSnoreTimestamps.removeAll()

        return InterventionDecision(
            shouldIntervene: true,
            level: level,
            reason: "snore confirmed"
        )
    }

    private mutating func pruneRecentSnores(now: Date) {
        recentSnoreTimestamps.removeAll {
            now.timeIntervalSince($0) > settings.debounceWindowSeconds
        }
    }
}
