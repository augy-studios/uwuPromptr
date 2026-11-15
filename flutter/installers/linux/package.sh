#!/usr/bin/env bash
# Packages the Linux build (docs/desktop-features-spec.md §16): the bundle into /opt/uwuPromptr/, a
# symlink on the PATH, the .desktop file (with the uwu:// handler) and icons, as a .deb (dpkg-deb),
# an .rpm (rpmbuild) and an AppImage (appimagetool). One set per processor, built on it.
#
# The names are the 1.0.0 Electron app's (electron-builder's): the package uwupromptr-desktop, the
# app in /opt/uwuPromptr/ as uwupromptr, its menu entry uwupromptr-desktop.desktop, and the files
# uwupromptr-<version>-amd64.deb and uwupromptr-<version>-x86_64.AppImage, so the new version
# installs over the old as an upgrade and the old AppImage's updater finds it.
#
#   installers/linux/package.sh <version> <amd64|arm64> <bundle dir> <out dir>
set -euo pipefail

version="$1"; arch="$2"; bundle="$3"; out="$4"
here="$(cd "$(dirname "$0")" && pwd)"
icon="$here/../../assets/images/icon-512.png"
mkdir -p "$out"
case "$arch" in
  amd64) rpm_arch=x86_64; appimage_arch=x86_64 ;;
  arm64) rpm_arch=aarch64; appimage_arch=aarch64 ;;
  *) echo "unknown arch $arch" >&2; exit 1 ;;
esac

desktop_entry() {
  cat <<EOF
[Desktop Entry]
Type=Application
Name=uwuPromptr
GenericName=Teleprompter
Comment=A teleprompter that works offline, with a phone remote
Exec=$1 %u
Icon=uwupromptr
Terminal=false
Categories=AudioVideo;Video;Utility;
MimeType=x-scheme-handler/uwu;
StartupWMClass=uwupromptr
Keywords=teleprompter;prompter;autocue;script;remote;
EOF
}

# ---- the tree, shared by the .deb and the .rpm ----
root="$(mktemp -d)"
mkdir -p "$root/opt/uwuPromptr" "$root/usr/bin" "$root/usr/share/applications" "$root/usr/share/icons/hicolor/512x512/apps" "$root/usr/share/icons/hicolor/256x256/apps"
cp -a "$bundle/." "$root/opt/uwuPromptr/"
ln -s /opt/uwuPromptr/uwupromptr "$root/usr/bin/uwupromptr"
desktop_entry /opt/uwuPromptr/uwupromptr > "$root/usr/share/applications/uwupromptr-desktop.desktop"
cp "$icon" "$root/usr/share/icons/hicolor/512x512/apps/uwupromptr.png"
convert "$icon" -resize 256x256 "$root/usr/share/icons/hicolor/256x256/apps/uwupromptr.png" 2>/dev/null || cp "$icon" "$root/usr/share/icons/hicolor/256x256/apps/uwupromptr.png"
size_kb="$(du -sk "$root" | cut -f1)"

# ---- .deb ----
deb="$(mktemp -d)"
cp -a "$root/." "$deb/"
mkdir -p "$deb/DEBIAN"
cat > "$deb/DEBIAN/control" <<EOF
Package: uwupromptr-desktop
Version: $version
Section: video
Priority: optional
Architecture: $arch
Maintainer: Augy Studios <noreply@uwuapps.org>
Installed-Size: $size_kb
Depends: libgtk-3-0, libayatana-appindicator3-1 | libappindicator3-1, libkeybinder-3.0-0
Homepage: https://cue.uwuapps.org
Description: uwuPromptr, a teleprompter that works offline
 Write a script, press space, and it scrolls. Speed and font size adjust a step
 at a time while it runs, and a phone can drive it by a six-letter code.
EOF
cat > "$deb/DEBIAN/postinst" <<'EOF'
#!/bin/sh
update-desktop-database -q /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
EOF
chmod 755 "$deb/DEBIAN/postinst"
dpkg-deb --build --root-owner-group "$deb" "$out/uwupromptr-$version-$arch.deb"

# ---- .rpm ----
if command -v rpmbuild >/dev/null; then
  top="$(mktemp -d)"
  mkdir -p "$top"/{BUILD,RPMS,SOURCES,SPECS,SRPMS,BUILDROOT}
  cat > "$top/SPECS/uwupromptr-desktop.spec" <<EOF
Name: uwupromptr-desktop
Version: $version
Release: 1
Summary: uwuPromptr, a teleprompter that works offline
License: MIT
URL: https://cue.uwuapps.org
Requires: gtk3, keybinder3
AutoReqProv: no
%define _build_id_links none
%define __strip /bin/true

%description
Write a script, press space, and it scrolls, with a phone as the remote.

%install
cp -a $root/. %{buildroot}/

%files
/opt/uwuPromptr
/usr/bin/uwupromptr
/usr/share/applications/uwupromptr-desktop.desktop
/usr/share/icons/hicolor/512x512/apps/uwupromptr.png
/usr/share/icons/hicolor/256x256/apps/uwupromptr.png
EOF
  rpmbuild --define "_topdir $top" --target "$rpm_arch" -bb "$top/SPECS/uwupromptr-desktop.spec"
  cp "$top"/RPMS/*/*.rpm "$out/uwupromptr-$version-$rpm_arch.rpm"
fi

# ---- AppImage ----
appdir="$(mktemp -d)/uwuPromptr.AppDir"
mkdir -p "$appdir/usr/lib/uwupromptr"
cp -a "$bundle/." "$appdir/usr/lib/uwupromptr/"
cat > "$appdir/AppRun" <<'EOF'
#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
exec "$here/usr/lib/uwupromptr/uwupromptr" "$@"
EOF
chmod 755 "$appdir/AppRun"
desktop_entry uwupromptr > "$appdir/uwupromptr-desktop.desktop"
cp "$icon" "$appdir/uwupromptr.png"
tool="appimagetool-$appimage_arch.AppImage"
if [ ! -x "/tmp/$tool" ]; then
  curl -fsSL -o "/tmp/$tool" "https://github.com/AppImage/appimagetool/releases/download/continuous/$tool"
  chmod 755 "/tmp/$tool"
fi
ARCH="$appimage_arch" "/tmp/$tool" --appimage-extract-and-run "$appdir" "$out/uwupromptr-$version-$appimage_arch.AppImage"

ls -lh "$out"
