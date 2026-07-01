import Combine
import Foundation

@MainActor
public final class SleepSessionCoordinator: ObservableObject {
    @Published public private(set) var session: SleepSession
    @Published public private(set) var isMonitoring = false

    private var detectionEngine: SnoreDetectionEngine
    private var interventionPolicy: InterventionPolicy
    private let audioCapture: AudioCaptureService
    private var onNudge: ((NudgeRequest) -> Void)?

    public init(
        settings: UserSettings = UserSettings(),
        audioCapture: AudioCaptureService = StubAudioCaptureService()
    ) {
        self.session = SleepSession(settings: settings)
        self.detectionEngine = SnoreDetectionEngine(settings: settings)
        self.interventionPolicy = InterventionPolicy(settings: settings)
        self.audioCapture = audioCapture
    }

    public func setNudgeHandler(_ handler: @escaping (NudgeRequest) -> Void) {
        onNudge = handler
    }

    public func updateSettings(_ settings: UserSettings) {
        session.settings = settings
        detectionEngine.updateSettings(settings)
        interventionPolicy.updateSettings(settings)
    }

    public func armSession() {
        session.state = .arming
    }

    public func startSession() async throws {
        guard await audioCapture.requestPermission() else {
            throw AudioCaptureError.permissionDenied
        }

        session.state = .active
        session.startedAt = .now
        session.endedAt = nil
        isMonitoring = true
        interventionPolicy.reset()

        try await audioCapture.startCapture { [weak self] chunk in
            Task { @MainActor in
                self?.handle(chunk: chunk)
            }
        }
    }

    public func pauseSession() {
        session.state = .paused
        isMonitoring = false
        Task { await audioCapture.stopCapture() }
    }

    public func endSession() {
        session.state = .ended
        session.endedAt = .now
        isMonitoring = false
        Task { await audioCapture.stopCapture() }
    }

    private func handle(chunk: AudioChunk) {
        guard session.state == .active else { return }

        let result = detectionEngine.process(chunk: chunk)
        if case let .snore(confidence) = result {
            let event = SnoreEvent(confidence: confidence, chunkDuration: chunk.duration)
            session.snoreEvents.append(event)
        }

        let decision = interventionPolicy.evaluate(
            detection: result,
            interventionCount: session.interventionCount
        )

        guard decision.shouldIntervene else { return }

        let intervention = InterventionEvent(
            level: decision.level,
            triggerConfidence: confidence(from: result)
        )
        session.interventions.append(intervention)

        let request = NudgeRequest(
            sessionID: session.id,
            level: decision.level,
            confidence: intervention.triggerConfidence
        )
        onNudge?(request)
    }

    private func confidence(from result: SnoreDetectionResult) -> Double {
        if case let .snore(confidence) = result { return confidence }
        return 0
    }
}
