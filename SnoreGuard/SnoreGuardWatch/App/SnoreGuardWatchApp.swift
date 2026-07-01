#if os(watchOS)
import WatchKit
#endif
import SnoreGuardCore
import SwiftUI

@main
struct SnoreGuardWatchApp: App {
    @StateObject private var watchModel = WatchAppModel()

    var body: some Scene {
        WindowGroup {
            SleepActiveView()
                .environmentObject(watchModel)
        }
    }
}

@MainActor
final class WatchAppModel: ObservableObject {
    @Published var sessionState: SleepSessionState = .idle
    @Published var lastNudge: Date?
    @Published var nudgeCount = 0

    let connectivity = StubWatchConnectivityService()

    init() {
        connectivity.setMessageHandler { [weak self] message in
            Task { @MainActor in
                self?.handle(message)
            }
        }
    }

    private func handle(_ message: SyncMessage) {
        switch message {
        case let .sessionState(state):
            sessionState = state
        case let .nudgeRequest(request):
            lastNudge = .now
            nudgeCount += 1
            HapticInterventionService.play(level: request.level)
        case let .sessionSummary(session):
            sessionState = session.state
            nudgeCount = session.interventionCount
        case .settingsUpdate, .heartbeat:
            break
        }
    }
}

enum HapticInterventionService {
    static func play(level: HapticLevel) {
        #if os(watchOS)
        let device = WKInterfaceDevice.current()
        switch level {
        case .gentle:
            device.play(.notification)
        case .medium:
            device.play(.directionUp)
        case .firm:
            device.play(.failure)
        }
        #endif
    }
}
