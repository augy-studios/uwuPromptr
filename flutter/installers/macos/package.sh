#!/usr/bin/env bash
# Packages the macOS build (docs/desktop-features-spec.md §16): Flutter builds one universal app;
# it's thinned to each processor (ditto --arch), signed ad hoc, zipped for the app's own updates
# (ditto -c -k --keepParent) and put in a .dmg with an Applications link (hdiutil).
#
#   installers/macos/package.sh <version> <path to uwuPromptr.app> <out dir>
set -euo pipefail

version="$1"; app="$2"; out="$3"
mkdir -p "$out"
for arch in arm64 x64; do
  case "$arch" in arm64) lipo_arch=arm64 ;; x64) lipo_arch=x86_64 ;; esac
  work="$(mktemp -d)"
  ditto --arch "$lipo_arch" "$app" "$work/uwuPromptr.app"
  codesign --force --deep --sign - "$work/uwuPromptr.app"
  ditto -c -k --keepParent "$work/uwuPromptr.app" "$out/uwupromptr-$version-mac-$arch.zip"
  stage="$(mktemp -d)"
  cp -R "$work/uwuPromptr.app" "$stage/"
  ln -s /Applications "$stage/Applications"
  hdiutil create -volname "uwuPromptr $version" -srcfolder "$stage" -ov -format UDZO "$out/uwupromptr-$version-mac-$arch.dmg"
done
ls -lh "$out"
