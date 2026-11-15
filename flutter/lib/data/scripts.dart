// Scripts and prompter settings, as the site keeps them (main-site/js/storage.js): the same keys,
// the same JSON, the same defaults and ranges. Everything is on the device: nothing is uploaded,
// and the prompter works with no network at all.
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'store.dart';

const appKey = 'uwupromptr';
const keyScripts = '$appKey.scripts';
const keyActive = '$appKey.activeScript';
const keySettings = '$appKey.settings';
const keyHostCode = '$appKey.hostCode';
const keyLastRemoteId = '$appKey.lastRemoteId';

typedef Json = Map<String, dynamic>;

/// One numeric setting's limits: the same as SETTING_RANGES in storage.js.
class SettingRange {
  const SettingRange({required this.min, required this.max, required this.step, required this.coarse, required this.defaultValue});
  final double min;
  final double max;
  final double step;
  final double coarse;
  final double defaultValue;

  /// How many decimals its step has, so repeated nudges don't build up floating point noise.
  int get decimals {
    final s = step.toString();
    final dot = s.indexOf('.');
    if (dot < 0) return 0;
    final frac = s.substring(dot + 1).replaceFirst(RegExp(r'0+$'), '');
    return frac.length;
  }
}

/// Granular, which is the point of this app: promptr.tv moves in whole steps, this moves in tenths
/// and single pixels.
const settingRanges = <String, SettingRange>{
  'fontSize': SettingRange(min: 16, max: 200, step: 1, coarse: 4, defaultValue: 60),
  'speed': SettingRange(min: 0.1, max: 40, step: 0.1, coarse: 1, defaultValue: 12),
  'lineHeight': SettingRange(min: 1, max: 2.4, step: 0.05, coarse: 0.1, defaultValue: 1.4),
  'margin': SettingRange(min: 0, max: 40, step: 1, coarse: 5, defaultValue: 8),
  // Where the focus line sits, as a percentage down the reading area.
  'focusPosition': SettingRange(min: 10, max: 80, step: 1, coarse: 5, defaultValue: 40),
};

/// The toggles, and their defaults.
const settingToggles = <String, bool>{'flipX': false, 'flipY': false, 'focusLine': true, 'timer': true};

Json defaultSettings() => {
  for (final e in settingRanges.entries) e.key: _num(e.value.defaultValue),
  ...settingToggles,
};

/// A whole number as an int, so it's written as 60 rather than 60.0, as the site writes it.
num _num(double v) => v == v.roundToDouble() && v.abs() < 1e15 ? v.round() : v;

/// A setting held within its range and rounded to its step (clampSetting in storage.js).
num clampSetting(String name, Object? value) {
  final range = settingRanges[name];
  final n = value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
  if (range == null) return n;
  final clamped = math.min(range.max, math.max(range.min, n));
  return _num(double.parse(clamped.toStringAsFixed(range.decimals)));
}

/// How a setting reads: speed as 12.0, line height as 1.40, the rest as whole numbers.
String formatSetting(String name, num value) {
  if (name == 'speed') return value.toDouble().toStringAsFixed(1);
  if (name == 'lineHeight') return value.toDouble().toStringAsFixed(2);
  return '${value.round()}';
}

const welcomeScript = '''Welcome to uwuPromptr.

Tap Edit to replace this with your own script, or open the scripts menu up top to start a new one.

Press space to start and stop scrolling. Up and down change the font size, left and right change the speed, and holding shift with them moves in bigger steps.

Everything you write stays on this device, and the prompter keeps working with no connection at all.''';

/// A new id, as newId() in storage.js makes them: "s" then the time and five random characters.
String newScriptId() {
  final r = math.Random();
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  final tail = List.generate(5, (_) => chars[r.nextInt(chars.length)]).join();
  return 's${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}$tail';
}

/// The scripts, the open one and the settings, read and written through the store under the site's
/// keys. A ChangeNotifier, so the screens redraw when anything here changes.
class Scripts extends ChangeNotifier {
  Scripts._();
  static final Scripts I = Scripts._();

  Object? _readJson(String key) {
    try {
      final raw = Store.I.get(key);
      if (raw == null || raw.isEmpty) return null;
      return jsonDecode(raw);
    } catch (_) {
      // Corrupt storage is not a reason to fail to start: defaults instead.
      return null;
    }
  }

  void _writeJson(String key, Object? value) => Store.I.put(key, jsonEncode(value));

  /// Every script, oldest first. Never empty: a first run gets the welcome script.
  List<Json> get all {
    final v = _readJson(keyScripts);
    if (v is List && v.isNotEmpty) {
      final list = [
        for (final s in v)
          if (s is Map && s['id'] is String) Json.from(s),
      ];
      if (list.isNotEmpty) return list;
    }
    final first = [
      {'id': newScriptId(), 'name': 'My first script', 'body': welcomeScript, 'updated': DateTime.now().millisecondsSinceEpoch},
    ];
    _writeJson(keyScripts, first);
    return first;
  }

  /// Something else changed the store (another window): everything showing scripts redraws.
  void touch() => notifyListeners();

  void save(List<Json> scripts) {
    _writeJson(keyScripts, scripts);
    notifyListeners();
  }

  String get activeId {
    final scripts = all;
    final stored = Store.I.get(keyActive);
    if (stored != null && scripts.any((s) => s['id'] == stored)) return stored;
    return scripts.first['id'] as String;
  }

  set activeId(String id) {
    Store.I.put(keyActive, id);
    notifyListeners();
  }

  Json get active {
    final scripts = all;
    final id = activeId;
    return scripts.firstWhere((s) => s['id'] == id, orElse: () => scripts.first);
  }

  Json? byId(String id) {
    for (final s in all) {
      if (s['id'] == id) return s;
    }
    return null;
  }

  void update(String id, {String? name, String? body}) {
    final scripts = [
      for (final s in all)
        if (s['id'] == id) {...s, 'name': ?name, 'body': ?body, 'updated': DateTime.now().millisecondsSinceEpoch} else s,
    ];
    save(scripts);
  }

  Json create([String name = 'Untitled script']) {
    final script = {'id': newScriptId(), 'name': name, 'body': '', 'updated': DateTime.now().millisecondsSinceEpoch};
    save([...all, script]);
    return script;
  }

  /// Never leaves the app with nothing: the last one deleted is replaced by an empty script.
  void delete(String id) {
    final remaining = all.where((s) => s['id'] != id).toList();
    final scripts = remaining.isNotEmpty
        ? remaining
        : [
            {'id': newScriptId(), 'name': 'Untitled script', 'body': '', 'updated': DateTime.now().millisecondsSinceEpoch},
          ];
    final wasActive = activeId == id;
    _writeJson(keyScripts, scripts);
    if (wasActive) Store.I.put(keyActive, scripts.first['id'] as String);
    notifyListeners();
  }

  // ---- settings ----

  Json get settings {
    final v = _readJson(keySettings);
    return {...defaultSettings(), if (v is Map) ...Json.from(v)};
  }

  void saveSettings(Json settings) => _writeJson(keySettings, settings);

  // ---- the remote id this prompter publishes ----

  /// Kept, so a remote that was paired can come back on the id it was given. Only New ID, or a
  /// remote that signs off, clears it.
  String get hostCode => Store.I.get(keyHostCode) ?? '';
  set hostCode(String code) => Store.I.put(keyHostCode, code.isEmpty ? null : code);

  /// The desktop's scripts beside the prompter: shown unless hidden (an app-only key).
  bool get pane => Store.I.get('app.scriptsPane') != '0';
  set pane(bool on) {
    Store.I.put('app.scriptsPane', on ? '1' : '0');
    notifyListeners();
  }

  /// Words in a script, as the scripts menu counts them.
  static int wordCount(String body) {
    final t = body.trim();
    return t.isEmpty ? 0 : t.split(RegExp(r'\s+')).length;
  }

  /// A script's first line, or "Empty", as the scripts menu shows it.
  static String preview(String body) {
    final first = body.trim().split('\n').first;
    return first.isEmpty ? 'Empty' : first;
  }
}
