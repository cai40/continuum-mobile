import Foundation

public struct AudioChunk: Sendable {
    public let samples: [Float]
    public let sampleRate: Double
    public let capturedAt: Date

    public init(samples: [Float], sampleRate: Double = 16_000, capturedAt: Date = .now) {
        self.samples = samples
        self.sampleRate = sampleRate
        self.capturedAt = capturedAt
    }

    public var duration: TimeInterval {
        guard sampleRate > 0 else { return 0 }
        return Double(samples.count) / sampleRate
    }
}

public enum AudioCaptureError: Error, Sendable {
    case permissionDenied
    case sessionSetupFailed
    case captureUnavailable
}

/// Captures short audio chunks for snore analysis.
/// Platform-specific implementation required (AVFoundation on iOS/watchOS).
public protocol AudioCaptureService: Sendable {
    func requestPermission() async -> Bool
    func startCapture(onChunk: @escaping @Sendable (AudioChunk) -> Void) async throws
    func stopCapture() async
}

public final class StubAudioCaptureService: AudioCaptureService, @unchecked Sendable {
    private var isCapturing = false

    public init() {}

    public func requestPermission() async -> Bool { true }

    public func startCapture(onChunk: @escaping @Sendable (AudioChunk) -> Void) async throws {
        isCapturing = true
        // Stub: emit silence chunks for scaffolding/tests.
        while isCapturing {
            try await Task.sleep(for: .milliseconds(1_500))
            onChunk(AudioChunk(samples: Array(repeating: 0, count: 1_600)))
        }
    }

    public func stopCapture() async {
        isCapturing = false
    }
}
