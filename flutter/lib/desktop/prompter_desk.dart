// What the desktop adds to the prompter, as the 1.0.0 Electron app had it (desktop/hotkeys.js,
// main.js, main-site/js/app-desktop.js), its settings read from the same keys:
//
// - Shortcuts in other apps: F8 starts and stops, F9 faster, F10 slower, whichever app is in
//   front, so a USB foot pedal or a Stream Deck button can drive the prompter. Off until turned
//   on in Prompter settings (`hotkeys`).
// - Keep on top: the prompter above slides, Zoom or OBS. The side tray's pin, or the tray's menu
//   (`onTop`).
// - Move to display: the window sent to another screen, maximised (the one under the prompter
//   glass), from the tray's menu with two or more screens.
// - The screen held on while the script plays or a remote is connected (wakelock_plus, in
//   prompter.dart), whether or not the window is in front.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hotkey_manager/hotkey_manager.dart';
import 'package:screen_retriever/screen_retriever.dart';
import 'package:window_manager/window_manager.dart';

import '../features/prompter/app_extras.dart';
import '../features/prompter/prompter.dart';
import '../features/prompter/prompter_screen.dart';
import '../features/prompter/settings_sheet.dart';
import '../theme/theme.dart';
import '../widgets/common.dart';
import 'settings.dart';
import 'updater.dart';

class PrompterDesk extends ChangeNotifier {
  PrompterDesk._();
  static final PrompterDesk I = PrompterDesk._();

  bool get hotkeys => DeskSettings.get<bool>('hotkeys') == true;
  bool get onTop => DeskSettings.get<bool>('onTop') == true;
  bool get updateNotices => DeskSettings.get<bool>('updateNotices') != false;

  /// Which of the three keys another app already has, after turning them on.
  List<String> taken = const [];

  static const _keys = [
    (PhysicalKeyboardKey.f8, 'F8', 'Start and stop'),
    (PhysicalKeyboardKey.f9, 'F9', 'Faster'),
    (PhysicalKeyboardKey.f10, 'F10', 'Slower'),
  ];

  Future<void> start() async {
    await windowManager.setAlwaysOnTop(onTop);
    if (hotkeys) await _register();
    // The desktop's extras in the shared screens.
    desktopTrayExtras = () => [
      TrayExtra('ontop-btn', 'pin', 'Keep on top', toggleOnTop, active: onTop),
      TrayExtra('updates-btn', 'download', 'Check for updates', Updater.checkNow),
    ];
    desktopSettingsSection = (context) => ListenableBuilder(listenable: this, builder: (context, _) => _section(context));
  }

  Future<void> _register() async {
    final failed = <String>[];
    for (final (key, name, _) in _keys) {
      try {
        await hotKeyManager.register(
          // `modifiers` given, even empty: left out, it's sent as null, and the Windows plugin
          // reads it as a list without looking, which ends the app (hotkey_manager_windows 0.2.0).
          HotKey(identifier: 'uwupromptr-$name', key: key, modifiers: const [], scope: HotKeyScope.system),
          keyDownHandler: (_) {
            final p = Prompter.I;
            switch (name) {
              case 'F8':
                p.togglePlay();
              case 'F9':
                p.nudge('speed', 1);
              case 'F10':
                p.nudge('speed', -1);
            }
            PrompterChrome.wake();
          },
        );
      } catch (_) {
        failed.add(name);
      }
    }
    taken = failed;
  }

  Future<void> setHotkeys(bool on) async {
    DeskSettings.write({'hotkeys': on});
    try {
      await hotKeyManager.unregisterAll();
    } catch (_) {}
    taken = const [];
    if (on) await _register();
    notifyListeners();
  }

  Future<void> toggleOnTop() async {
    final on = !onTop;
    DeskSettings.write({'onTop': on});
    await windowManager.setAlwaysOnTop(on);
    notifyListeners();
    Prompter.I.notifyListeners();
  }

  void setUpdateNotices(bool on) {
    DeskSettings.write({'updateNotices': on});
    notifyListeners();
  }

  /// The screens, when there are two or more, for the tray's Move to display.
  Future<List<Display>> displays() async {
    try {
      return await screenRetriever.getAllDisplays();
    } catch (_) {
      return const [];
    }
  }

  /// The window to another screen, maximised there.
  Future<void> moveTo(Display d) async {
    final at = d.visiblePosition ?? Offset.zero;
    final size = d.visibleSize ?? d.size;
    if (await windowManager.isMaximized()) await windowManager.unmaximize();
    if (await windowManager.isFullScreen()) await windowManager.setFullScreen(false);
    await windowManager.setBounds(Rect.fromLTWH(at.dx + 40, at.dy + 40, size.width - 80, size.height - 80));
    await windowManager.maximize();
    await windowManager.show();
    await windowManager.focus();
  }

  Widget _section(BuildContext context) {
    final c = UwuColors.of(context);
    final note = hotkeys
        ? (taken.isEmpty
              ? 'F8: start and stop. F9: faster. F10: slower. Most USB foot pedals and Stream Deck buttons can send these keys.'
              : 'Another app has ${taken.join(' and ')}, so ${taken.length == 1 ? 'it doesn’t' : 'they don’t'} reach the prompter. The rest work.')
        : 'Off: the keys only work while the prompter is in front.';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const FieldLabel('Desktop app'),
        ToggleGrid(
          children: [
            ToggleChip(icon: 'keyboard', label: 'Shortcuts in other apps', on: hotkeys, onTap: () => setHotkeys(!hotkeys)),
            ToggleChip(icon: 'bell', label: 'New version alerts', on: updateNotices, onTap: () => setUpdateNotices(!updateNotices)),
            ToggleChip(icon: 'pin', label: 'Keep on top', on: onTop, onTap: toggleOnTop),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(note, style: TextStyle(color: c.muted, fontSize: 12.5)),
        ),
      ],
    );
  }
}
