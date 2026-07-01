import SnoreGuardCore
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        NavigationStack {
            List {
                Section("Last session") {
                    LabeledContent("Snore events", value: "\(appModel.coordinator.session.snoreCount)")
                    LabeledContent("Gentle nudges", value: "\(appModel.coordinator.session.interventionCount)")
                    if let duration = appModel.coordinator.session.duration {
                        LabeledContent("Duration", value: formatted(duration))
                    }
                }

                Section("Recent nudges") {
                    if appModel.coordinator.session.interventions.isEmpty {
                        Text("No interventions yet")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(appModel.coordinator.session.interventions.suffix(5)) { event in
                            HStack {
                                Text(event.timestamp, style: .time)
                                Spacer()
                                Text("Level \(event.level.rawValue)")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Summary")
        }
    }

    private func formatted(_ interval: TimeInterval) -> String {
        let hours = Int(interval) / 3600
        let minutes = (Int(interval) % 3600) / 60
        return "\(hours)h \(minutes)m"
    }
}
