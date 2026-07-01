import SnoreGuardCore
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var settings = UserSettings()

    var body: some View {
        NavigationStack {
            Form {
                Section("Detection") {
                    Slider(value: $settings.sensitivity, in: 0.3...0.95) {
                        Text("Sensitivity")
                    }
                    Text("Higher sensitivity reacts to quieter snoring.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Interventions") {
                    Stepper("Cooldown: \(settings.cooldownMinutes) min", value: $settings.cooldownMinutes, in: 3...15)
                    Stepper("Max per night: \(settings.maxInterventionsPerNight)", value: $settings.maxInterventionsPerNight, in: 3...15)
                    Toggle("Escalate haptics", isOn: $settings.enableEscalation)
                    Toggle("Use Apple Watch haptics", isOn: $settings.useWatchHaptics)
                }
            }
            .navigationTitle("Settings")
            .onAppear { settings = appModel.coordinator.session.settings }
            .onChange(of: settings) { _, newValue in
                appModel.coordinator.updateSettings(newValue)
                Task { await appModel.connectivity.send(.settingsUpdate(newValue)) }
            }
        }
    }
}
