// What the apps add to the prompter over the site (main-site/js/app-native.js and app-desktop.js),
// each only where the platform says it can (Native.has):
//
//   Android  Full brightness (this window only, the phone's own setting untouched), Check for
//            updates (the Updates page), Volume keys start and stop, New version alerts, Space
//            above the navigation bar
//   Desktop  Keep on top, Check for updates, Shortcuts in other apps (F8, F9, F10), New version
//            alerts (lib/desktop/ sets these up)
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/env.dart';
import '../../data/store.dart';
import '../../native/bridge.dart';
import '../update/update_bar.dart';

const keyBrightness = 'uwupromptr.fullBrightness';
const keyVolumeKeys = 'uwupromptr.volumeKeys';
const keyReleaseAlerts = 'uwupromptr.releaseAlerts';
const keyBottomGap = 'uwupromptr.bottomGap';

/// Space above the navigation bar, added to (or taken off) what the phone says the bar needs, in
/// the app's pixels: for a phone that gets it wrong, so the bottom rows sit where they read best.
const bottomGapMin = -24.0, bottomGapMax = 48.0, bottomGapStep = 2.0;

class TrayExtra {
  const TrayExtra(this.id, this.icon, this.label, this.onTap, {this.active});
  final String id;
  final String icon;
  final String label;
  final VoidCallback onTap;
  final bool? active;
}

/// Set by the desktop layer: its buttons for the side tray.
List<TrayExtra> Function()? desktopTrayExtras;

class AppExtras extends ChangeNotifier {
  AppExtras._();
  static final AppExtras I = AppExtras._();

  bool get brightness => Store.I.get(keyBrightness) == '1';
  bool get volumeKeys => Store.I.get(keyVolumeKeys) == '1';

  /// 0 (the phone's own measure) unless changed; Android only.
  double get bottomGap {
    if (!Env.android) return 0;
    final v = double.tryParse(Store.I.get(keyBottomGap) ?? '') ?? 0;
    return v.clamp(bottomGapMin, bottomGapMax);
  }

  void setBottomGap(double v) {
    final snapped = ((v / bottomGapStep).round() * bottomGapStep).clamp(bottomGapMin, bottomGapMax);
    if (snapped == bottomGap) return;
    Store.I.put(keyBottomGap, snapped == 0 ? null : '${snapped.round()}');
    notifyListeners();
  }

  /// The screen's measures with the gap applied, for the whole app (lib/app/app.dart), so every
  /// bottom row moves together: the prompter's controls, the remote, the windows and the editor.
  /// Not while the keyboard is up: it covers the bar, and the rows sit on the keyboard instead.
  MediaQueryData withBottomGap(MediaQueryData mq) {
    final gap = bottomGap;
    if (gap == 0 || mq.viewInsets.bottom > 0) return mq;
    double moved(double b) => math.max(0, b + gap);
    return mq.copyWith(
      padding: mq.padding.copyWith(bottom: moved(mq.padding.bottom)),
      viewPadding: mq.viewPadding.copyWith(bottom: moved(mq.viewPadding.bottom)),
    );
  }

  /// On the prompter page: the brightness and the keys as they were left. Off the remote page,
  /// none of the prompter's screen or key settings apply (app-native.js's resetAppFeatures).
  void applyForPage(bool prompter) {
    if (!Env.android) return;
    if (Native.has('brightness'))
      Native.tryCall('Cue', 'brightness', {
        'level': prompter && brightness ? 1.0 : -1.0,
      });
    if (Native.has('keys'))
      Native.tryCall('Cue', 'keys', {'on': prompter && volumeKeys});
  }

  void toggleBrightness() {
    Store.I.put(keyBrightness, brightness ? '0' : '1');
    applyForPage(true);
    notifyListeners();
  }

  void toggleVolumeKeys() {
    Store.I.put(keyVolumeKeys, volumeKeys ? '0' : '1');
    applyForPage(true);
    notifyListeners();
  }
}

List<TrayExtra> appTrayButtons(BuildContext context) {
  final desk = desktopTrayExtras;
  if (desk != null) return desk();
  if (!Env.android) return const [];
  final x = AppExtras.I;
  return [
    if (Native.has('brightness'))
      TrayExtra(
        'brightness-btn',
        'brightness',
        'Full brightness',
        x.toggleBrightness,
        active: x.brightness,
      ),
    TrayExtra('updates-btn', 'download', 'Check for updates', openUpdates),
  ];
}
