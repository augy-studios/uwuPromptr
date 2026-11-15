// The ICE servers a pairing uses, as main-site/js/remote.js loads them: a short-lived TURN relay
// from the site's /api/turn-credentials when it's set up, which is what gets a phone on mobile
// data through to a laptop on another network, else STUN alone. Not having a relay is a supported
// state: the list is empty or the fetch fails, and pairing carries on with STUN, which reaches any
// device on the same network.
import 'dart:convert';

import '../api/api.dart';

class Ice {
  Ice._();

  static const fallback = [
    {'urls': 'stun:stun.l.google.com:19302'},
    {'urls': 'stun:stun.cloudflare.com:3478'},
  ];

  static Future<List<Map<String, dynamic>>>? _pending;
  static DateTime? _at;

  /// Kept for half an hour: the credentials last an hour, and a fetch on every reconnect would be
  /// noise.
  static Future<List<Map<String, dynamic>>> servers() {
    final at = _at;
    if (_pending == null || at == null || DateTime.now().difference(at) > const Duration(minutes: 30)) {
      _at = DateTime.now();
      _pending = _load();
    }
    return _pending!;
  }

  static Future<List<Map<String, dynamic>>> _load() async {
    try {
      final res = await Api.client.get(Api.uri('/turn-credentials')).timeout(const Duration(seconds: 6));
      if (res.statusCode != 200) return fallback;
      final body = jsonDecode(res.body);
      final data = body is Map ? body['data'] : null;
      final list = data is Map ? data['iceServers'] : null;
      if (list is List && list.isNotEmpty) {
        return [
          for (final s in list)
            if (s is Map) Map<String, dynamic>.from(s),
        ];
      }
    } catch (_) {
      // Offline, or no relay: STUN alone.
    }
    return fallback;
  }
}
