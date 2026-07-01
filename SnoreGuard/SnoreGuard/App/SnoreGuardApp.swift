import SnoreGuardCore
import SwiftUI

@main
struct SnoreGuardApp: App {
    @StateObject private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appModel)
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    let coordinator: SleepSessionCoordinator
    let connectivity = StubWatchConnectivityService()

    init() {
        coordinator = SleepSessionCoordinator(audioCapture: AVAudioCaptureService())
        coordinator.setNudgeHandler { [connectivity] request in
            Task {
                await connectivity.send(.nudgeRequest(request))
            }
        }
    }
}
