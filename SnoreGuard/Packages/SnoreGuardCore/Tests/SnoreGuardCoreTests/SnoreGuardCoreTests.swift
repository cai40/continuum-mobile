import Foundation
@testable import SnoreGuardCore
import XCTest

final class SnoreDetectionEngineTests: XCTestCase {
    func testSilentChunkReturnsSilent() {
        var engine = SnoreDetectionEngine(settings: UserSettings(sensitivity: 0.5))
        let chunk = AudioChunk(samples: Array(repeating: 0, count: 1_600))
        XCTAssertEqual(engine.process(chunk: chunk), .silent)
    }

    func testHighEnergyChunkCanTriggerSnore() {
        var engine = SnoreDetectionEngine(settings: UserSettings(sensitivity: 0.9))
        let samples = (0..<1_600).map { _ in Float.random(in: 0.08...0.12) }
        let chunk = AudioChunk(samples: samples)
        if case .snore = engine.process(chunk: chunk) {
            XCTAssertTrue(true)
        } else {
            XCTFail("Expected snore detection for high-energy test chunk")
        }
    }
}

final class InterventionPolicyTests: XCTestCase {
    func testDebounceRequiresMultipleHits() {
        var policy = InterventionPolicy(settings: UserSettings(debounceHitCount: 3))
        let snore: SnoreDetectionResult = .snore(confidence: 0.9)

        XCTAssertFalse(policy.evaluate(detection: snore, interventionCount: 0).shouldIntervene)
        XCTAssertFalse(policy.evaluate(detection: snore, interventionCount: 0).shouldIntervene)
        XCTAssertTrue(policy.evaluate(detection: snore, interventionCount: 0).shouldIntervene)
    }

    func testCooldownBlocksBackToBackInterventions() {
        var settings = UserSettings(cooldownMinutes: 10, debounceHitCount: 1)
        var policy = InterventionPolicy(settings: settings)
        let snore: SnoreDetectionResult = .snore(confidence: 0.9)
        let now = Date()

        XCTAssertTrue(policy.evaluate(detection: snore, interventionCount: 0, now: now).shouldIntervene)
        XCTAssertFalse(
            policy.evaluate(detection: snore, interventionCount: 1, now: now.addingTimeInterval(60)).shouldIntervene
        )
    }
}
