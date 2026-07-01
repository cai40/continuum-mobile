import AVFoundation
import SnoreGuardCore

/// iOS implementation using AVAudioEngine. Wire this into `SleepSessionCoordinator` on iPhone.
public final class AVAudioCaptureService: AudioCaptureService, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let chunkDuration: TimeInterval = 1.5
    private var onChunk: (@Sendable (AudioChunk) -> Void)?
    private var isCapturing = false

    public init() {}

    public func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    public func startCapture(onChunk: @escaping @Sendable (AudioChunk) -> Void) async throws {
        self.onChunk = onChunk
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
        try session.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let sampleRate = format.sampleRate
        let frameCapacity = AVAudioFrameCount(sampleRate * chunkDuration)

        input.installTap(onBus: 0, bufferSize: frameCapacity, format: format) { [weak self] buffer, _ in
            guard let self, self.isCapturing else { return }
            let samples = Self.floatSamples(from: buffer)
            let chunk = AudioChunk(samples: samples, sampleRate: sampleRate)
            self.onChunk?(chunk)
        }

        try engine.start()
        isCapturing = true
    }

    public func stopCapture() async {
        isCapturing = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    private static func floatSamples(from buffer: AVAudioPCMBuffer) -> [Float] {
        guard let channelData = buffer.floatChannelData else { return [] }
        let frameCount = Int(buffer.frameLength)
        return Array(UnsafeBufferPointer(start: channelData[0], count: frameCount))
    }
}
