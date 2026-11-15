// uwuPromptr for Windows, macOS and Linux: the same app as the phone's, with the desktop's extras
// round it (docs/desktop-features-spec.md lists each one, docs/flutter-desktop-app-spec.md says
// how), taking over from the 1.0.0 Electron app in place:
//
// - one copy at a time, links forwarded to it (desk.dart);
// - the update window at launch, and updating itself (splash.dart, updater.dart);
// - Make it yours, the first window, and from the tray's menu after (welcome.dart);
// - the tray, where closing the window leaves it running (tray.dart);
// - its own title bar and command bar, shortcuts, the macOS menu bar (chrome.dart);
// - the tray countdown, the Jump List, thumbnail buttons and Dock (glance.dart);
// - the mini remote, each in its own window and engine (widgets_window.dart);
// - Keep on top, Move to display and shortcuts in other apps (prompter_desk.dart);
// - starting at sign-in, uwu://cue/ links shared with the sibling apps (desk.dart);
// - the Electron app's scripts and settings brought across once (leveldb.dart).
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';

import '../app/app.dart';
import '../app/fullscreen.dart';
import '../data/migrate.dart';
import '../features/prompter/prompter.dart';
import '../features/prompter/scripts_sheet.dart';
import '../features/theme/theme_sheet.dart';
import '../native/bridge.dart';
import '../theme/theme.dart';
import 'adaptive.dart';
import 'chrome.dart';
import 'desk.dart';
import 'glance.dart';
import 'host.dart';
import 'leveldb.dart';
import 'notify.dart';
import 'prompter_desk.dart';
import 'runner.dart';
import 'settings.dart';
import 'splash.dart';
import 'tray.dart';
import 'updater.dart';
import 'welcome.dart';
import 'widgets_window.dart';

/// A desktop widget's own engine runs only its small screen. True when this engine was one.
Future<bool> runDesktopSubWindow(List<String> args) async {
  try {
    final c = await WindowController.fromCurrentEngine();
    if (c.arguments.isEmpty) return false;
    final m = jsonDecode(c.arguments);
    if (m is Map && m['kind'] == 'widget') {
      await runWidgetWindow('${m['id']}');
      return true;
    }
  } catch (_) {
    // The main window.
  }
  return false;
}

/// Before the app: one copy only, the window, the update window, and Make it yours the first time.
Future<void> desktopBeforeApp(List<String> args) async {
  Desktop.launchArgs = args;
  if (!await Desktop.claimInstance(args)) exit(0);
  Native.host = DesktopHost();
  // What the Electron app kept for the site, in its own folder (the same one as this app's).
  Migrate.desktopRead = () async =>
      LevelDbReader.readOrigin('${DeskSettings.folder}${Platform.pathSeparator}Local Storage${Platform.pathSeparator}leveldb', Desktop.site);
  await Desktop.setUp();
  ThemeController.I.init();
  ThemeController.I.systemAccent = DeskSettings.get<bool>('useSystemAccent') ?? false;

  // The update window, every launch of an installed copy.
  if (!Desktop.fromSource || Platform.environment['UWUPROMPTR_SPLASH_DEMO'] == '1') {
    await splashWindow();
    runApp(const SplashApp());
    await Updater.startup();
  }

  // Make it yours: once, for a new install, and the first time after updating from 1.0.0.
  if (DeskSettings.get<bool>('setupDone') != true) await _welcome();
}

Future<void> _welcome() async {
  final done = Completer<WelcomeChoices?>();
  await welcomeWindow();
  runApp(
    WelcomeApp(
      done: (c) {
        if (!done.isCompleted) done.complete(c);
      },
    ),
  );
  await applyWelcome(await done.future);
}

/// After the app's started: the chrome round it, the tray, notifications, the glance surfaces,
/// the mini remotes, links, start at sign-in, and the update checks.
Future<void> desktopAfterApp(List<String> args) async {
  desktopChrome = (context, child) => DesktopChrome(child: child);
  desktopAccentScheme = (b) => ColorScheme.fromSeed(seedColor: _systemAccent(), brightness: b);
  desktopAccentGet = () => ThemeController.I.systemAccent;
  desktopAccentSet = (on) {
    DeskSettings.write({'useSystemAccent': on});
    ThemeController.I.setSystemAccent(on);
  };
  Fullscreen.desktop = Desktop.setFullScreen;
  Desktop.fullScreen.addListener(() => Fullscreen.on.value = Desktop.fullScreen.value);
  desktopScriptMenu = (context, at, script) => showContextMenu(context, at, [
    MenuAction('Open', () => Desktop.show('uwu://cue/s/${script['id']}'), icon: 'scripts'),
    MenuAction('Pin to Desktop Widget', () => DeskWidgets.add(script), icon: 'widget'),
    MenuAction('Set as Tray Countdown', () => Glance.follow(script), icon: 'pin'),
  ]);
  ViewHistory.start();
  Runner.listen();
  Runner.onDock = (id) => Desktop.show('uwu://cue/s/$id');
  Runner.onThumb = (what) {
    if (what == 'toggle') {
      Prompter.I.togglePlay();
    } else if (what.startsWith('uwu://')) {
      Desktop.show(what);
    }
  };
  Runner.onOpen = (link) => link == null ? Desktop.show() : Desktop.onSecondCopy([link]);
  DeskWidgets.listen((link) => Desktop.show(link));
  Updater.showSplash = () async {
    await splashWindow();
    runApp(const SplashApp());
  };
  DeskTray.openWelcome = () async {
    await Desktop.hide();
    // Not the prompter's window for now: its size and place stay as they were kept, not the
    // welcome window's, and it comes back maximised if it was.
    Desktop.shown = false;
    final done = Completer<WelcomeChoices?>();
    await welcomeWindow();
    runApp(
      WelcomeApp(
        done: (c) {
          if (!done.isCompleted) done.complete(c);
        },
      ),
    );
    await applyWelcome(await done.future);
    Desktop.shown = false;
    runApp(const UwuPromptrApp());
    await Desktop.firstShow();
  };

  await DeskNotify.init();
  await Desktop.firstShow();
  await PrompterDesk.I.start();
  unawaited(DeskTray.I.start());
  Glance.start();
  unawaited(DeskWidgets.reopenAll());
  unawaited(Desktop.registerScheme());
  unawaited(Desktop.startAtLoginFirstRun());
  Updater.start();
}

/// The system's accent colour where it can be read, else uwuPromptr's green.
Color _systemAccent() {
  try {
    if (Platform.isWindows) {
      final r = Process.runSync('reg', ['query', r'HKCU\Software\Microsoft\Windows\DWM', '/v', 'AccentColor']);
      final m = RegExp(r'0x([0-9a-fA-F]{8})').firstMatch('${r.stdout}');
      if (m != null) {
        // ABGR.
        final v = int.parse(m.group(1)!, radix: 16);
        return Color.fromARGB(255, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
      }
    } else if (Platform.isMacOS) {
      final r = Process.runSync('defaults', ['read', '-g', 'AppleAccentColor']);
      const accents = {
        '-1': Color(0xFF8E8E93),
        '0': Color(0xFFFF3B30),
        '1': Color(0xFFFF9500),
        '2': Color(0xFFFFCC00),
        '3': Color(0xFF34C759),
        '5': Color(0xFFAF52DE),
        '6': Color(0xFFFF2D55),
      };
      return accents['${r.stdout}'.trim()] ?? const Color(0xFF007AFF);
    } else {
      final r = Process.runSync('gsettings', ['get', 'org.gnome.desktop.interface', 'accent-color']);
      const accents = {
        'blue': Color(0xFF3584E4),
        'teal': Color(0xFF2190A4),
        'green': Color(0xFF3A944A),
        'yellow': Color(0xFFC88800),
        'orange': Color(0xFFED5B00),
        'red': Color(0xFFE62D42),
        'pink': Color(0xFFD56199),
        'purple': Color(0xFF9141AC),
        'slate': Color(0xFF6F8396),
      };
      final c = accents['${r.stdout}'.replaceAll("'", '').trim()];
      if (c != null) return c;
    }
  } catch (_) {}
  return const Color(0xFF22A85A);
}
