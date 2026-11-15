// The site's own API (main-site/api/*), called as the site's script.js calls it: JSON both
// ways, the session's token as a Bearer header, and an `error` field in a failed answer. Plus
// one notifier for whether the network is there at all, which the offline bar listens to.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// The site's host: the API's base, the links the app opens, and the update check.
const siteHost = 'cue.uwuapps.org';
const siteOrigin = 'https://$siteHost';

/// The Play build: no updater of its own (--dart-define=UWUPROMPTR_PLAY=true).
const isPlayBuild = bool.fromEnvironment('UWUPROMPTR_PLAY');

class ApiError implements Exception {
  ApiError(this.message, {this.status = 0});
  final String message;

  /// The HTTP status, or 0 when the server was never reached.
  final int status;
  bool get offline => status == 0;

  @override
  String toString() => message;
}

class Api {
  Api._();

  /// The session's token, or null as a guest.
  static String? token;

  /// For tests: answers instead of the network.
  static http.Client client = http.Client();

  /// True while the last request couldn't reach the server.
  static final ValueNotifier<bool> offline = ValueNotifier(false);

  static Map<String, String> authHeaders() => {if (token != null) 'Authorization': 'Bearer $token'};

  static Uri uri(String path) => Uri.parse('$siteOrigin/api$path');

  static Future<Map<String, dynamic>> call(String method, String path, [Map<String, dynamic>? body]) async {
    final req = http.Request(method, uri(path));
    req.headers['Content-Type'] = 'application/json';
    req.headers.addAll(authHeaders());
    if (body != null) req.body = jsonEncode(body);
    late final http.Response res;
    try {
      res = await http.Response.fromStream(await client.send(req).timeout(const Duration(seconds: 30)));
    } catch (_) {
      offline.value = true;
      throw ApiError('No connection', status: 0);
    }
    offline.value = false;
    Map<String, dynamic> data;
    try {
      final v = jsonDecode(utf8.decode(res.bodyBytes));
      data = v is Map ? Map<String, dynamic>.from(v) : {};
    } catch (_) {
      data = {};
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiError('${data['error'] ?? 'Request failed'}', status: res.statusCode);
    }
    return data;
  }

  /// Bytes from a route that answers with an image.
  static Future<({Uint8List bytes, String type})> bytes(String path) async {
    late final http.Response res;
    try {
      res = await client.get(uri(path), headers: authHeaders()).timeout(const Duration(seconds: 30));
    } catch (_) {
      offline.value = true;
      throw ApiError('No connection', status: 0);
    }
    offline.value = false;
    if (res.statusCode != 200) throw ApiError('HTTP ${res.statusCode}', status: res.statusCode);
    return (bytes: res.bodyBytes, type: (res.headers['content-type'] ?? 'image/png').split(';').first.trim());
  }

  /// Asks again, quietly, until the network is back. Started once, as the app opens.
  static Timer? _probe;
  static bool _watching = false;
  static void watchOffline() {
    if (_watching) return;
    _watching = true;
    offline.addListener(() {
      _probe?.cancel();
      if (!offline.value) return;
      _probe = Timer.periodic(const Duration(seconds: 15), (t) async {
        try {
          await client.head(Uri.parse('$siteOrigin/manifest.json')).timeout(const Duration(seconds: 8));
          offline.value = false;
          t.cancel();
        } catch (_) {
          // Still gone.
        }
      });
    });
  }
}
