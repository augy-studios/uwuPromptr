// The first launch after updating from the old apps (1.0.0 was the site in a WebView on Android,
// and in Electron on the desktop): everything the site kept in their localStorage for
// https://cue.uwuapps.org (the scripts, the settings, the theme, the trays, the remote's id)
// brought into the app's own store as it was, once, and never over a value the app has set since.
// The old copy is left alone, so nothing's lost either way.
//
//   Android  a WebView that's never shown, given the site's address, reads its storage
//            (MainActivity.java's App.migrate)
//   Desktop  Chromium's LevelDB in the old app's folder, read in Dart (lib/desktop/leveldb.dart)
import '../native/bridge.dart';
import 'store.dart';

class Migrate {
  Migrate._();

  static const doneKey = 'app.migrated';

  /// Set by the desktop layer: the old Electron app's stored values for the site, or null.
  static Future<Map<String, String>?> Function()? desktopRead;

  /// How many values came across this time (0 when it was done before, or there was nothing).
  static Future<int> run(Store store) async {
    if (store.has(doneKey)) return 0;
    Map<String, dynamic> items = const {};
    try {
      final desk = desktopRead;
      if (desk != null) {
        items = (await desk()) ?? const {};
      } else if (Native.available && Native.platform == 'android') {
        final r = await Native.call('App', 'migrate');
        items = Map<String, dynamic>.from((r?['items'] as Map?) ?? const {});
      }
    } catch (_) {
      // Nothing to read: a device that never had the old app either.
    }
    var n = 0;
    items.forEach((k, v) {
      // Only the site's own, and never over anything the app has set since.
      if (v is! String || store.has(k)) return;
      if (!k.startsWith('uwupromptr.') && !k.startsWith('tour.')) return;
      store.put(k, v);
      n++;
    });
    store.put(doneKey, DateTime.now().millisecondsSinceEpoch.toString());
    return n;
  }
}
