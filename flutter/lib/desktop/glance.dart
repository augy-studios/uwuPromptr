// At a glance, outside the window (docs/desktop-features-spec.md §9). The spec's "live item" is
// the prompter: the open script, playing or not, how far through and for how long.
//
// - The tray countdown: switched on from a script's right-click menu or the tray, the prompter
//   followed outside the window. The script's name, whether it's playing, the clock and how far
//   through, in the tray icon's tooltip (Windows, Linux), and the clock beside the menu bar icon
//   with how far through on the Dock's badge (macOS), every second while it plays.
// - Favourites: the scripts (up to 10) as the Windows Jump List, the taskbar's thumbnail buttons
//   (previous script, start and stop, next script) and the macOS Dock menu, through the runner's
//   channel (runner.dart).
//
// Keys: trayStop ({ code, name }: the script followed, or null), favourites.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/prompter_logic.dart';
import '../data/scripts.dart';
import '../features/prompter/prompter.dart';
import '../features/prompter/session.dart';
import 'desk.dart';
import 'runner.dart';
import 'settings.dart';

/// The tray tooltip, cut to 127 characters (Windows' most) with an ellipsis.
String trayText({required String name, required bool playing, required int elapsed, required double progress}) {
  final lines = [
    name,
    '${playing ? 'Playing' : 'Paused'} · ${formatElapsed(elapsed)} · ${progress.round()}%',
  ];
  final text = lines.join('\n');
  return text.length <= 127 ? text : '${text.substring(0, 126)}…';
}

class Glance {
  Glance._();

  static Timer? _tick;

  /// Set by tray.dart: puts a new tooltip and title up.
  static void Function(String tooltip, String title)? onTray;
  static final ValueNotifier<Map<String, dynamic>?> followed = ValueNotifier(null);

  static void start() {
    final stop = DeskSettings.get<Map<String, dynamic>>('trayStop');
    if (stop != null) followed.value = stop;
    Scripts.I.addListener(_scriptsChanged);
    Prompter.I.addListener(refreshTray);
    _scriptsChanged();
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (Prompter.I.playing) refreshTray();
    });
  }

  static String _lastFavs = '';

  static void _scriptsChanged() {
    final favs = [
      for (final s in Scripts.I.all.take(10)) {'code': s['id'], 'name': s['name']},
    ];
    final key = favs.toString();
    if (key != _lastFavs) {
      _lastFavs = key;
      DeskSettings.write({'favourites': favs});
      Runner.setFavourites(favs);
    }
    refreshTray();
  }

  /// Follows the prompter in the tray (on the open script, or `script`), or stops (null).
  static void follow(Json? script) {
    if (script != null && script['id'] != Scripts.I.activeId) Session.I.switchTo('${script['id']}');
    final s = script ?? (followed.value == null ? Scripts.I.active : null);
    final v = s == null ? null : {'code': s['id'], 'name': s['name']};
    DeskSettings.write({'trayStop': v});
    followed.value = v;
    refreshTray();
  }

  static void refreshTray() {
    if (followed.value == null) {
      onTray?.call(Desktop.name, '');
      Runner.setBadge('');
      return;
    }
    final p = Prompter.I;
    final name = '${Session.I.script['name']}';
    onTray?.call(
      trayText(name: name, playing: p.playing, elapsed: p.elapsedMs, progress: p.progress),
      ' ${formatElapsed(p.elapsedMs)}',
    );
    Runner.setBadge(p.playing ? '${p.progress.round()}%' : '');
  }
}
