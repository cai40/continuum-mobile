import SnoreGuardCore
import SwiftUI

struct SleepActiveView: View {
    @EnvironmentObject private var watchModel: WatchAppModel

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: statusIcon)
                .font(.system(size: 40))
                .foregroundStyle(statusColor)

            Text(statusTitle)
                .font(.headline)

            Text(statusSubtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if watchModel.nudgeCount > 0 {
                Text("\(watchModel.nudgeCount) gentle nudges tonight")
                    .font(.caption2)
            }
        }
        .padding()
    }

    private var statusIcon: String {
        switch watchModel.sessionState {
        case .active: return "waveform"
        case .arming: return "moon.zzz"
        case .ended: return "sun.max"
        default: return "moon"
        }
    }

    private var statusColor: Color {
        watchModel.sessionState == .active ? .green : .indigo
    }

    private var statusTitle: String {
        switch watchModel.sessionState {
        case .idle: return "SnoreGuard"
        case .arming: return "Arming..."
        case .active: return "Monitoring"
        case .paused: return "Paused"
        case .ended: return "Session ended"
        }
    }

    private var statusSubtitle: String {
        switch watchModel.sessionState {
        case .active:
            return "You'll feel a gentle tap if snoring is detected."
        case .ended:
            return "Check your iPhone for the morning summary."
        default:
            return "Start a session from your iPhone."
        }
    }
}
