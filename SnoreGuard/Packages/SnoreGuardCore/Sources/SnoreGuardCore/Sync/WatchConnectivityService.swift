import Foundation

public protocol WatchConnectivityServing: Sendable {
    func send(_ message: SyncMessage) async
    func setMessageHandler(_ handler: @escaping @Sendable (SyncMessage) -> Void)
}

public final class StubWatchConnectivityService: WatchConnectivityServing, @unchecked Sendable {
    private var handler: (@Sendable (SyncMessage) -> Void)?

    public init() {}

    public func send(_ message: SyncMessage) async {
        handler?(message)
    }

    public func setMessageHandler(_ handler: @escaping @Sendable (SyncMessage) -> Void) {
        self.handler = handler
    }
}
