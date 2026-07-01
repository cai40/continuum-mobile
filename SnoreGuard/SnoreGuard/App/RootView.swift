import SnoreGuardCore
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        TabView {
            SleepSetupView()
                .tabItem { Label("Tonight", systemImage: "moon.zzz.fill") }

            DashboardView()
                .tabItem { Label("Summary", systemImage: "chart.bar.fill") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
    }
}
