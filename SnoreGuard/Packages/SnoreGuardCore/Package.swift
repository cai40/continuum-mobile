// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SnoreGuardCore",
    platforms: [
        .iOS(.v17),
        .watchOS(.v10),
    ],
    products: [
        .library(name: "SnoreGuardCore", targets: ["SnoreGuardCore"]),
    ],
    targets: [
        .target(name: "SnoreGuardCore"),
        .testTarget(
            name: "SnoreGuardCoreTests",
            dependencies: ["SnoreGuardCore"]
        ),
    ]
)
