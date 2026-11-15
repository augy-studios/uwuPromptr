// The bridge's host on the desktop (docs/flutter-desktop-app-spec.md §3): the shared screens ask
// Native.call / Native.has as they would on a phone, and this answers in Dart, so the screens
// need no desktop branches. Anything not here fails like an absent plugin ('unavailable'), and
// the screen's plain path runs. Never a phone-only feature (Nearby, the watch, volume keys).
import 'dart:io';

import '../app/env.dart';
import '../native/bridge.dart';
import 'desk.dart';
import 'notify.dart';

class DesktopHost implements NativeHost {
  @override
  Future<Map<String, dynamic>?> call(String plugin, String method, Map<String, dynamic> options) async {
    if (plugin != 'App') throw NativeError('No plugin $plugin', code: 'unavailable');
    switch (method) {
      case 'info':
        return {
          'platform': 'desktop',
          'version': Env.version,
          // For a bug report (lib/features/bug/bug_report.dart): the system and its version.
          'os': '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
          'features': ['notifications', 'links', 'glance', 'widgets', 'checkUpdate', 'keepAwake', 'hotkeys', 'onTop'],
        };
      case 'launchLink':
        final link = Desktop.linkIn(Desktop.launchArgs);
        return {'url': ?link};
      case 'openLink':
        await Desktop.openExternal('${options['url']}');
        return null;
      case 'notify':
        await DeskNotify.show(title: '${options['title'] ?? ''}', body: '${options['body'] ?? ''}', link: options['link'] as String?);
        return null;
      case 'background':
        await Desktop.hide();
        return {};
    }
    throw NativeError('No method $method', code: 'unavailable');
  }
}
