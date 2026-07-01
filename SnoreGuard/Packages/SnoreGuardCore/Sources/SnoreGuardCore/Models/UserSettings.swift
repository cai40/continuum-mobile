import Foundation

public struct UserSettings: Codable, Sendable, Equatable {
    public var sensitivity: Double
    public var cooldownMinutes: Int
    public var maxInterventionsPerNight: Int
    public var enableEscalation: Bool
    public var useWatchHaptics: Bool
    public var debounceWindowSeconds: TimeInterval
    public var debounceHitCount: Int

    public init(
        sensitivity: Double = 0.65,
        cooldownMinutes: Int = 6,
        maxInterventionsPerNight: Int = 8,
        enableEscalation: Bool = true,
        useWatchHaptics: Bool = true,
        debounceWindowSeconds: TimeInterval = 10,
        debounceHitCount: Int = 3
    ) {
        self.sensitivity = sensitivity
        self.cooldownMinutes = cooldownMinutes
        self.maxInterventionsPerNight = maxInterventionsPerNight
        self.enableEscalation = enableEscalation
        self.useWatchHaptics = useWatchHaptics
        self.debounceWindowSeconds = debounceWindowSeconds
        self.debounceHitCount = debounceHitCount
    }

    public var detectionThreshold: Double {
        // Higher sensitivity lowers the confidence bar for triggering.
        min(max(1.0 - sensitivity, 0.35), 0.9)
    }
}
