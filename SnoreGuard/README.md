# SnoreGuard

Native iOS + Apple Watch app that detects snoring and delivers gentle haptic nudges to interrupt snoring without fully waking you.

## Architecture

- **SnoreGuardCore** (Swift Package): shared models, snore detection engine, intervention policy, session coordinator
- **SnoreGuard** (iOS): overnight audio capture, session UI, settings, morning summary
- **SnoreGuardWatch** (watchOS): monitoring status + gentle haptic delivery

```
SnoreGuard/
├── Packages/SnoreGuardCore/     # Shared logic
├── SnoreGuard/                  # iOS app
├── SnoreGuardWatch/             # watchOS app
├── project.yml                  # XcodeGen spec
└── scripts/generate-xcodeproj.sh
```

## Requirements

- macOS with Xcode 15+
- XcodeGen (`brew install xcodegen`)
- Physical iPhone + Apple Watch for real overnight testing

## Quick start (macOS)

```bash
cd SnoreGuard
chmod +x scripts/generate-xcodeproj.sh
./scripts/generate-xcodeproj.sh
open SnoreGuard.xcodeproj
```

1. Select the **SnoreGuard** scheme
2. Run on a paired iPhone with Apple Watch
3. Grant microphone permission
4. Tap **Start Sleep Session** before bed

## Core flow

1. iPhone captures 1.5s audio chunks in the background
2. `SnoreDetectionEngine` classifies snore-like audio on-device
3. `InterventionPolicy` debounces, applies cooldown, and escalates haptics
4. Watch receives a `NudgeRequest` and plays a gentle tap

## Next implementation steps

1. Replace `StubWatchConnectivityService` with real `WCSession` bridge
2. Swap `StubAudioCaptureService` for `AVAudioCaptureService` in `AppModel`
3. Add a trained Core ML snore classifier (`SnoreClassifier.mlmodel`)
4. Add `WKExtendedRuntimeSession` alarm scheduling for Watch haptics
5. Persist sessions with SwiftData
6. Tune sensitivity on real-device recordings

## Privacy

v1 is designed for on-device processing only. No audio leaves the phone by default.

## Disclaimer

SnoreGuard is a wellness tool, not a medical device. It does not diagnose sleep apnea or other conditions.
