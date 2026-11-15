// The Wear OS watch app (android/wear/), through the Android app (main-site/js/watch.js): the
// watch talks to uwuPromptr on its phone, and the page on show does what it asks: on the prompter,
// to this prompter; on the remote, through the remote to whichever prompter it's connected to. It
// speaks the web remote's own messages, so it's one more remote, with no code to type: only the
// same app on the paired watch, signed with the same key, can reach it at all.
//
// What goes back is a small summary: once a second while the script plays (the watch counts the
// seconds between), at once when anything else changes, and only while a watch has said hello
// lately.
import 'dart:async';
import 'dart:convert';

import '../native/bridge.dart';

const _attachedFor = Duration(seconds: 90);
const _steady = Duration(seconds: 1);
const _maxName = 80;
const _simple = {'toggle', 'play', 'pause', 'reset'};

/// What the watch shows.
class WatchSummary {
  const WatchSummary({
    required this.live,
    required this.role,
    required this.playing,
    required this.speed,
    required this.elapsed,
    required this.progress,
    required this.name,
  });
  final bool live;
  final String role;
  final bool playing;
  final num speed;
  final num elapsed;
  final num progress;
  final String name;
}

class Watch {
  Watch._();

  /// Set by the page on show: what the watch shows, and what to do with its commands.
  static WatchSummary Function()? summary;
  static void Function(Map<String, dynamic> command)? onCommand;
  static void Function(bool on)? onAttached;

  static DateTime _heardAt = DateTime.fromMillisecondsSinceEpoch(0);
  static bool attached = false;
  static String _lastKey = '';
  static DateTime _sentAt = DateTime.fromMillisecondsSinceEpoch(0);
  static bool _started = false;

  static void start() {
    if (_started || !Native.has('watch')) return;
    _started = true;
    Native.on('Cue', 'watch', (event) {
      Object? message;
      try {
        message = jsonDecode('${event['data']}');
      } catch (_) {
        return;
      }
      if (message is! Map) return;
      _heardAt = DateTime.now();
      _setAttached(true);
      if (message['type'] == 'command') {
        final command = checked(Map<String, dynamic>.from(message));
        if (command != null) onCommand?.call(command);
      }
      // A hello or a command, answered at once: the watch's tile waits on it.
      _send(force: true);
    });
    Timer.periodic(_steady, (_) => update());
  }

  /// Something the watch shows may have changed. Cheap to call often.
  static void update() {
    if (summary == null) return;
    if (attached && DateTime.now().difference(_heardAt) > _attachedFor) _setAttached(false);
    if (attached) _send(force: false);
  }

  static void _setAttached(bool on) {
    if (attached == on) return;
    attached = on;
    _lastKey = '';
    onAttached?.call(on);
  }

  static void _send({required bool force}) {
    final get = summary;
    if (get == null) return;
    final s = get();
    final name = s.name.length > _maxName ? s.name.substring(0, _maxName) : s.name;
    final key = jsonEncode([s.live, s.role, s.playing, s.speed, name]);
    final now = DateTime.now();
    if (!force && key == _lastKey && !(s.playing && now.difference(_sentAt) >= _steady)) return;
    _lastKey = key;
    _sentAt = now;
    final data = jsonEncode({
      'v': 1,
      'live': s.live,
      'role': s.role,
      'playing': s.playing,
      'speed': s.speed,
      'elapsed': s.elapsed.round(),
      'progress': (s.progress * 10).round() / 10,
      'name': name,
    });
    Native.tryCall('Cue', 'watchSend', {'data': data});
  }

  /// The command in the remote's own shape, or null for anything a watch may not do: it drives
  /// the prompter, and never edits the script, hangs up the remote or changes more than the speed.
  static Map<String, dynamic>? checked(Map<String, dynamic> m) {
    if (_simple.contains(m['name'])) return {'type': 'command', 'name': m['name']};
    if (m['setting'] != 'speed') return null;
    final value = m['value'] is num ? m['value'] as num : num.tryParse('${m['value']}');
    if (value == null || !value.isFinite) return null;
    if (m['name'] == 'nudge') return {'type': 'command', 'name': 'nudge', 'setting': 'speed', 'value': value.sign, 'coarse': m['coarse'] == true};
    if (m['name'] == 'set') return {'type': 'command', 'name': 'set', 'setting': 'speed', 'value': value};
    return null;
  }
}
