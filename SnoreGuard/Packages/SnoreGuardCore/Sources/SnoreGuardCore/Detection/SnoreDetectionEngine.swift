import Foundation

public enum SnoreDetectionResult: Sendable, Equatable {
    case silent
    case notSnore
    case snore(confidence: Double)
}

public struct VoiceActivityDetector: Sendable {
  public var energyThreshold: Float

  public init(energyThreshold: Float = 0.002) {
    self.energyThreshold = energyThreshold
  }

  public func isActive(_ chunk: AudioChunk) -> Bool {
    guard !chunk.samples.isEmpty else { return false }
    let energy = chunk.samples.reduce(0) { $0 + $1 * $1 } / Float(chunk.samples.count)
    return energy > energyThreshold
  }
}

/// Core ML wrapper placeholder. Replace `predict` with a real model at integration time.
public struct SnoreClassifier: Sendable {
  public init() {}

  public func predict(_ chunk: AudioChunk) -> Double {
    // Stub heuristic: higher energy bands correlate with snore-like signal in tests.
    guard !chunk.samples.isEmpty else { return 0 }
    let energy = chunk.samples.reduce(0) { $0 + abs($1) } / Float(chunk.samples.count)
    return min(Double(energy) * 12, 1.0)
  }
}

public struct SnoreDetectionEngine: Sendable {
  public var vad: VoiceActivityDetector
  public var classifier: SnoreClassifier
  public var settings: UserSettings

  public init(
    vad: VoiceActivityDetector = VoiceActivityDetector(),
    classifier: SnoreClassifier = SnoreClassifier(),
    settings: UserSettings = UserSettings()
  ) {
    self.vad = vad
    self.classifier = classifier
    self.settings = settings
  }

  public mutating func updateSettings(_ settings: UserSettings) {
    self.settings = settings
  }

  public func process(chunk: AudioChunk) -> SnoreDetectionResult {
    guard vad.isActive(chunk) else { return .silent }
    let confidence = classifier.predict(chunk)
    if confidence >= settings.detectionThreshold {
      return .snore(confidence: confidence)
    }
    return .notSnore
  }
}
