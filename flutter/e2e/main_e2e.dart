// The app as the Playwright suite runs it (README.md here): the real screens in a browser, with a
// stand-in for the Android side, so what only the phone can do (the Updates page, the release
// notifications switch, Nearby, the volume keys) is at least reached the right way. Every call to
// it lands in window.e2eCalls, and window.e2eEmit(plugin, event, json) says what Android would
// have said. Screen reader support is switched on: it's what the suite finds things by.
//
// Query parameters:
//   ?android=1     draw as the Android app does (its Updates page, Material You by default)
//   ?wallpaper=1   pretend the phone has wallpaper colours (a purple), for Material You
//   ?play=1        as the Google Play build: no updater of its own
//   ?nearby=1      as a phone with Google Play services: the offline remote's buttons
//   ?watch=1       with the Wear OS watch's link
//   ?desktop=1     drawn as the desktop apps are: their title bar and command bar, and the
//                  scripts beside the prompter (for the store's desktop pictures)
//   ?welcome=1     the desktop's Make it yours window
//   ?notour=1      no tours start by themselves
//   ?page=remote   open on the remote page (with &id=CODE, connecting to it)
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:uwupromptr/app/app.dart';
import 'package:uwupromptr/app/env.dart';
import 'package:uwupromptr/data/store.dart';
import 'package:uwupromptr/desktop/chrome.dart';
import 'package:uwupromptr/desktop/welcome.dart';
import 'package:uwupromptr/features/tour/tour.dart';
import 'package:uwupromptr/native/bridge.dart';
import 'package:uwupromptr/run.dart';
import 'package:uwupromptr/theme/theme.dart';

class _FakeAndroid implements NativeHost {
  _FakeAndroid({required this.play, required this.nearby, required this.watch}) {
    globalContext.setProperty('e2eCalls'.toJS, <JSAny>[].toJS);
    globalContext.setProperty(
      'e2eEmit'.toJS,
      ((JSString plugin, JSString event, JSString json) {
        Native.emit(plugin.toDart, event.toDart, Map<String, dynamic>.from(jsonDecode(json.toDart) as Map));
      }).toJS,
    );
  }

  final bool play;
  final bool nearby;
  final bool watch;

  @override
  Future<Map<String, dynamic>?> call(String plugin, String method, Map<String, dynamic> options) async {
    (globalContext.getProperty('e2eCalls'.toJS) as JSObject)
        .callMethod('push'.toJS, jsonEncode({'plugin': plugin, 'method': method, 'options': options}).toJS);
    switch ('$plugin.$method') {
      case 'App.info':
        return {
          'platform': 'android',
          'version': '2.0.0',
          'build': 2,
          'play': play,
          'release': '16',
          'model': 'Google Pixel 9',
          'sdk': 36,
          'features': ['links', 'push', 'brightness', 'keys', 'immersive', if (nearby) 'nearby', if (watch) 'watch', if (!play) 'update'],
        };
      case 'App.launchLink':
        return {};
      case 'Cue.nearbyAdvertise':
      case 'Cue.nearbyDiscover':
        return {'state': 'granted'};
      default:
        return {};
    }
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SemanticsBinding.instance.ensureSemantics();
  final q = Uri.base.queryParameters;
  if (q['notour'] == '1') Tour.off = true;
  if (q['android'] == '1') {
    Env.androidOverride = true;
    Native.host = _FakeAndroid(play: q['play'] == '1', nearby: q['nearby'] == '1', watch: q['watch'] == '1');
  }
  if (q['wallpaper'] == '1') {
    testLightDynamic = ColorScheme.fromSeed(seedColor: const Color(0xFF7B3FF2));
    testDarkDynamic = ColorScheme.fromSeed(seedColor: const Color(0xFF7B3FF2), brightness: Brightness.dark);
  }
  if (q['welcome'] == '1') {
    Env.desktopOverride = true;
    await Store.open();
    ThemeController.I.init();
    runApp(WelcomeApp(done: (_) {}));
    return;
  }
  if (q['desktop'] == '1') {
    Env.desktopOverride = true;
    desktopChrome = (context, child) => DesktopChrome(child: child);
  }
  await runUwuPromptr(const []);
  if (q['desktop'] == '1') ViewHistory.start();
}
