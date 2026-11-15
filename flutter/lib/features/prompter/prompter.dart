// The prompter itself (main-site/js/prompter.js): scrolling, the clock, and the settings that
// shape how the text reads. Everything that shows the prompter (the screen, the remote, the
// watch, the desktop's tray and widget) reads one state from here and redraws when it changes.
import 'dart:math' as math;

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../data/prompter_logic.dart';
import '../../data/scripts.dart';

class Prompter extends ChangeNotifier {
  Prompter._();
  static final Prompter I = Prompter._();

  /// The reading area's scroll. The screen attaches it; the engine moves it.
  final ScrollController scroll = ScrollController();

  late Json settings = Scripts.I.settings;
  bool playing = false;

  // The scroll position with its fraction, which the scroll position itself keeps too, but a
  // manual drag while paused moves only that, so this follows it.
  double _offset = 0;
  Duration? _lastFrame;
  int? _frameId;

  int _elapsed = 0;
  int _startedAt = 0;
  final Stopwatch _clock = Stopwatch()..start();

  /// While a remote or a watch is connected the screen stays on, playing or not.
  bool _keepAwake = false;
  bool _awake = false;

  /// The window's height, which the text's padding is measured from (the site's vh).
  double windowHeight = 800;

  /// The reading area's width, for the remote's copy of the screen.
  double viewWidth = 0;

  /// The text's padding: half a screen above, 60% below, so the first and last lines can reach
  /// the focus line.
  double get padTop => windowHeight * 0.5;
  double get padBottom => windowHeight * 0.6;

  /// Set by the screen: a play, a pause or a setting changed.
  final List<VoidCallback> onState = [];

  void init() {
    scroll.addListener(() {
      if (!playing && scroll.hasClients) _offset = scroll.position.pixels;
    });
  }

  // ---- settings ----

  num get(String name) => settings[name] is num
      ? settings[name] as num
      : (settingRanges[name]?.defaultValue ?? 0);
  bool flag(String name) => settings[name] == true;

  num get fontSize => get('fontSize');
  num get speed => get('speed');
  num get lineHeight => get('lineHeight');
  num get margin => get('margin');
  num get focusPosition => get('focusPosition');

  void set(String name, Object value, {bool silent = false}) {
    final Object next = settingRanges.containsKey(name)
        ? clampSetting(name, value)
        : value;
    if (settings[name] == next) return;
    settings = {...settings, name: next};
    Scripts.I.saveSettings(settings);
    if (!silent) _changed();
  }

  /// Back to what a setting ships as.
  void resetSetting(String name) {
    final r = settingRanges[name];
    if (r != null) set(name, r.defaultValue);
  }

  bool isDefault(String name) {
    final r = settingRanges[name];
    return r == null || get(name).toDouble() == r.defaultValue;
  }

  void nudge(String name, num direction, {bool coarse = false}) {
    final r = settingRanges[name];
    if (r == null) return;
    set(name, get(name) + (coarse ? r.coarse : r.step) * direction);
  }

  void toggle(String name) => set(name, !flag(name));

  // ---- transport ----

  void play() {
    if (playing) return;
    if (atEnd) rewind();
    playing = true;
    _lastFrame = null;
    _startedAt = _clock.elapsedMilliseconds;
    _schedule();
    _syncAwake();
    _changed();
  }

  void pause() {
    if (!playing) return;
    // Banked before playing goes false, or the clock would lose every second since Play.
    _elapsed = elapsedMs;
    playing = false;
    _startedAt = 0;
    if (_frameId != null)
      SchedulerBinding.instance.cancelFrameCallbackWithId(_frameId!);
    _frameId = null;
    _syncAwake();
    _changed();
  }

  void togglePlay() => playing ? pause() : play();

  /// Back to the top, paused, the clock left alone: what a new or changed script gets.
  void stop() {
    pause();
    rewind();
    _changed();
  }

  /// The reset button, and nothing else: the one thing that zeroes the clock.
  void reset() {
    pause();
    _elapsed = 0;
    stop();
  }

  void rewind() {
    _offset = 0;
    if (scroll.hasClients) scroll.jumpTo(0);
  }

  double get _max => scroll.hasClients ? scroll.position.maxScrollExtent : 0;
  double get _pixels => scroll.hasClients ? scroll.position.pixels : 0;

  bool get atEnd {
    final max = _max;
    return max <= 0 || _pixels >= max - 1;
  }

  /// How far through, 0 to 100.
  double get progress {
    final max = _max;
    if (max <= 0) return 0;
    return (_pixels / max * 100).clamp(0, 100).toDouble();
  }

  /// Jump to a point in the script, as a percentage: what the remote's scrubber sends.
  void seek(num percent) {
    final max = _max;
    _offset = (max * percent / 100).clamp(0, math.max(0, max)).toDouble();
    if (scroll.hasClients) scroll.jumpTo(_offset);
    _changed();
  }

  void _schedule() => _frameId = SchedulerBinding.instance
      .scheduleFrameCallback(_tick, rescheduling: true);

  void _tick(Duration now) {
    _frameId = null;
    if (!playing) return;
    // The first frame after play has nothing to measure against; skipping it avoids a jump.
    final last = _lastFrame;
    if (last != null && scroll.hasClients) {
      final dt = (now - last).inMicroseconds / 1e6;
      _offset += pixelsPerSecond(speed, fontSize) * dt;
      final max = _max;
      scroll.jumpTo(math.min(_offset, max));
      if (atEnd) {
        pause();
        return;
      }
    }
    _lastFrame = now;
    _schedule();
  }

  // ---- the clock ----

  int get elapsedMs {
    if (!playing || _startedAt == 0) return _elapsed;
    return _elapsed + (_clock.elapsedMilliseconds - _startedAt);
  }

  // ---- the screen staying on ----

  bool get wantsAwake => playing || _keepAwake;

  void setKeepAwake(bool on) {
    _keepAwake = on;
    _syncAwake();
  }

  void _syncAwake() {
    final want = wantsAwake;
    if (want == _awake) return;
    _awake = want;
    // Unsupported, or refused: the prompter carries on either way.
    WakelockPlus.toggle(enable: want).catchError((Object _) {});
  }

  // ---- what's shown ----

  /// The whole visible state, as state() in prompter.js gives it: what the remote mirrors.
  Json state() => {
    ...settings,
    'playing': playing,
    'elapsed': elapsedMs,
    'progress': progress,
    'view': view(),
  };

  /// The screen's geometry, which the remote needs to draw a copy of it that wraps on the same
  /// words.
  Json view() {
    final h = scroll.hasClients ? scroll.position.viewportDimension : 0.0;
    return {
      'width': viewWidth.round(),
      'height': h.round(),
      'scrollTop': _pixels.round(),
      'scrollHeight': (_max + h).round(),
      'padTop': padTop,
      'padBottom': padBottom,
    };
  }

  void _changed() {
    notifyListeners();
    for (final f in List.of(onState)) {
      f();
    }
  }

  /// The text changed under the reader: back to the top, the clock kept.
  void loaded() => stop();
}
