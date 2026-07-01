import SnoreGuardCore
import SwiftUI

struct SleepSetupView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "bed.double.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.indigo)

                Text("Ready for tonight?")
                    .font(.title2.bold())

                Text("Place your iPhone on the nightstand. Your Apple Watch will deliver gentle taps when snoring is detected.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                if appModel.coordinator.isMonitoring {
                    Label("Monitoring active", systemImage: "waveform")
                        .foregroundStyle(.green)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button(appModel.coordinator.isMonitoring ? "End Session" : "Start Sleep Session") {
                    Task { await toggleSession() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding()
            .navigationTitle("SnoreGuard")
        }
    }

    private func toggleSession() async {
        errorMessage = nil
        if appModel.coordinator.isMonitoring {
            appModel.coordinator.endSession()
            await appModel.connectivity.send(.sessionState(.ended))
            return
        }

        do {
            appModel.coordinator.armSession()
            await appModel.connectivity.send(.sessionState(.arming))
            try await appModel.coordinator.startSession()
            await appModel.connectivity.send(.sessionState(.active))
        } catch {
            errorMessage = "Could not start monitoring. Check microphone permission."
        }
    }
}
