#!/usr/bin/env bash
# Builds the Linux installers on any Linux machine (Debian 13's own Node 20 is
# enough) and copies them, with latest-linux.yml, to release/<version>/.
#
#   bash desktop/build-linux.sh
#
# Run it with bash rather than chmod +x: a mode change shows in git and blocks
# the next git pull. CI builds every platform anyway (build-desktop.yml); this
# is for building by hand.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

if [ ! -d node_modules/electron-builder ] || [ ! -d node_modules/electron-updater ]; then
  npm ci
fi

npm run build:linux

version="$(node -p "require('./package.json').version")"
out="$here/../release/$version"
mkdir -p "$out"
cp "dist/uwupromptr-$version-amd64.deb" "dist/uwupromptr-$version-x86_64.AppImage" dist/latest-linux.yml "$out/"

echo
echo "Built $version:"
ls -lh "$out"
echo
echo "The installers are over GitHub's 100 MB limit: they go on the GitHub release, never into git."
