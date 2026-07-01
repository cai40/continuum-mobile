#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen is required. Install with: brew install xcodegen"
  exit 1
fi

xcodegen generate
echo "Generated SnoreGuard.xcodeproj"
echo "Open with: open SnoreGuard.xcodeproj"
