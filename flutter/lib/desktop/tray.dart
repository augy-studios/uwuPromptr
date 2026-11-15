// The tray icon (the menu bar on macOS) and its menu (docs/desktop-features-spec.md §4): a click
// shows or hides the window on Windows and Linux; the menu, rebuilt whenever something in it
// changes, top to bottom:
//   Restart to update to x.y.z / Download version x.y.z (only while there is one)
//   Tray countdown: {script} and Stop the tray countdown (while it's on)
//   Open uwuPromptr, Prompter, Remote
//   Start / Pause the script, Tray countdown, Keep on top (a check box), Move to display
//   Add a mini remote, Make it yours...
//   Check for updates..., Start when I sign in (a check box)
//   Quit
import 'dart:async';
import 'dart:io';

import 'package:tray_manager/tray_manager.dart';

import '../app/pages.dart';
import '../features/prompter/prompter.dart';
import 'desk.dart';
import 'glance.dart';
import 'prompter_desk.dart';
import 'updater.dart';
import 'widgets_window.dart';

class DeskTray with TrayListener {
  DeskTray._();
  static final DeskTray I = DeskTray._();

  /// Set by desktop_main.dart: opens Make it yours again.
  static Future<void> Function()? openWelcome;

  bool _login = false;
  bool _playing = false;

  Future<void> start() async {
    final icon = Platform.isWindows ? 'assets/images/tray.ico' : (Platform.isMacOS ? 'assets/images/tray_template.png' : 'assets/images/tray.png');
    await trayManager.setIcon(icon, isTemplate: Platform.isMacOS);
    await trayManager.setToolTip(Desktop.name);
    trayManager.addListener(this);
    Glance.onTray = (tooltip, title) {
      trayManager.setToolTip(tooltip);
      if (Platform.isMacOS) trayManager.setTitle(title);
    };
    Glance.followed.addListener(rebuild);
    Updater.available.addListener(rebuild);
    Updater.ready.addListener(rebuild);
    Updater.checking.addListener(rebuild);
    PrompterDesk.I.addListener(rebuild);
    Prompter.I.addListener(() {
      if (Prompter.I.playing == _playing) return;
      _playing = Prompter.I.playing;
      rebuild();
    });
    _login = await Desktop.startsAtLogin();
    await rebuild();
  }

  String _screenName(int i, String? name) => name != null && name.isNotEmpty ? name : 'Display ${i + 1}';

  Future<void> rebuild() async {
    final ready = Updater.ready.value;
    final available = Updater.available.value;
    final followed = Glance.followed.value;
    final checking = Updater.checking.value;
    final screens = await PrompterDesk.I.displays();
    await trayManager.setContextMenu(
      Menu(
        items: [
          if (ready != null) ...[
            MenuItem(key: 'restart', label: 'Restart to update to $ready', onClick: (_) => Updater.restartToUpdate()),
            MenuItem.separator(),
          ] else if (available != null && !Updater.canInstall) ...[
            MenuItem(key: 'download', label: 'Download version $available', onClick: (_) => Desktop.openExternal(Desktop.releases)),
            MenuItem.separator(),
          ],
          if (followed != null) ...[
            MenuItem(key: 'countdown', label: 'Tray countdown: ${followed['name']}', onClick: (_) => Desktop.show('uwu://cue/s/${followed['code']}')),
            MenuItem(key: 'stop', label: 'Stop the tray countdown', onClick: (_) => Glance.follow(null)),
            MenuItem.separator(),
          ],
          MenuItem(key: 'open', label: 'Open ${Desktop.name}', onClick: (_) => Desktop.show()),
          MenuItem(
            key: 'prompter',
            label: 'Prompter',
            onClick: (_) async {
              await Desktop.show();
              AppPages.open(AppPages.prompter);
            },
          ),
          MenuItem(
            key: 'remote',
            label: 'Remote',
            onClick: (_) async {
              await Desktop.show();
              AppPages.open(AppPages.remote);
            },
          ),
          MenuItem.separator(),
          MenuItem(key: 'play', label: _playing ? 'Pause the script' : 'Start the script', onClick: (_) => Prompter.I.togglePlay()),
          if (followed == null) MenuItem(key: 'follow', label: 'Tray countdown', onClick: (_) => Glance.follow(null)),
          MenuItem.checkbox(key: 'ontop', label: 'Keep on top', checked: PrompterDesk.I.onTop, onClick: (_) => PrompterDesk.I.toggleOnTop()),
          if (screens.length > 1)
            MenuItem.submenu(
              key: 'display',
              label: 'Move to display',
              submenu: Menu(
                items: [
                  for (final (i, d) in screens.indexed)
                    MenuItem(
                      key: 'display-$i',
                      label: '${_screenName(i, d.name)} (${d.size.width.round()} × ${d.size.height.round()})',
                      onClick: (_) => PrompterDesk.I.moveTo(d),
                    ),
                ],
              ),
            ),
          MenuItem(key: 'widget', label: 'Add a mini remote', onClick: (_) => DeskWidgets.add()),
          MenuItem(key: 'welcome', label: 'Make it yours...', onClick: (_) => openWelcome?.call()),
          MenuItem.separator(),
          MenuItem(key: 'check', label: checking ? 'Checking for updates...' : 'Check for updates...', disabled: checking, onClick: (_) => Updater.checkNow()),
          MenuItem.checkbox(
            key: 'login',
            label: 'Start when I sign in',
            checked: _login,
            onClick: (_) async {
              _login = !_login;
              await Desktop.setStartAtLogin(_login);
              rebuild();
            },
          ),
          MenuItem.separator(),
          MenuItem(key: 'quit', label: 'Quit', onClick: (_) => Desktop.quit()),
        ],
      ),
    );
  }

  @override
  void onTrayIconMouseDown() {
    // macOS opens the menu on a click; Windows and Linux show or hide the window.
    if (Platform.isMacOS) {
      trayManager.popUpContextMenu();
    } else {
      Desktop.toggle();
    }
  }

  @override
  void onTrayIconRightMouseDown() {
    Desktop.startsAtLogin().then((on) {
      _login = on;
      // On Windows a tray menu only closes on a click elsewhere if the app is the foreground
      // window as it opens (TrackPopupMenu's rule); this doesn't show a hidden window.
      // ignore: deprecated_member_use
      rebuild().then((_) => trayManager.popUpContextMenu(bringAppToFront: Platform.isWindows));
    });
  }
}
