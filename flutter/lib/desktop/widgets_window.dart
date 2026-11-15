// Desktop widgets (docs/desktop-features-spec.md §8), for a prompter: the mini remote, a small
// frameless window that drives the prompter in the main window from anywhere on the desktop, so a
// speaker with the prompter full screen on another display keeps its controls to hand. Each is
// its own window and Flutter engine (desktop_multi_window), started from main(args) with
// { kind: 'widget', id } and running only this small screen.
//
// - Added from the tray (Add a mini remote) or a script's right-click menu (Pin to Desktop
//   Widget, which opens that script first).
// - Shows the open script's name, the clock, how far through, play or pause, the speed with its
//   - and +, and reset to the top, asked of the main window four times a second.
// - Its own buttons: open the main window, pin on top of other windows, remove (×).
// - Moved by dragging its top; resized from any edge, down to 200 × 110. Default 320 × 200.
// - Kept: each one's pin and place, reopened where it was when the app starts. Removing one with
//   × forgets it; quitting keeps them all. Not in the taskbar or Alt+Tab.
//
// Keys: widgets: [{ id, code, name, items: [], onTop, bounds }] (the spec's field names).
import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../data/prompter_logic.dart';
import '../data/scripts.dart';
import '../data/store.dart';
import '../features/prompter/prompter.dart';
import '../features/prompter/session.dart';
import '../theme/icons.dart';
import '../theme/theme.dart';
import 'settings.dart';

const widgetChannel = WindowMethodChannel('org.uwuapps.cue/widgets', mode: ChannelMode.unidirectional);

class DeskWidgets {
  DeskWidgets._();

  static List<Map<String, dynamic>> _all() => [
    for (final w in (DeskSettings.get<List<dynamic>>('widgets') ?? const []))
      if (w is Map) Map<String, dynamic>.from(w),
  ];

  static void _save(List<Map<String, dynamic>> list) => DeskSettings.write({'widgets': list});

  static Future<void> _open(Map<String, dynamic> w) async {
    try {
      final c = await WindowController.create(WindowConfiguration(hiddenAtLaunch: true, arguments: jsonEncode({'kind': 'widget', 'id': w['id']})));
      await c.show();
    } catch (_) {
      // No second window on this system.
    }
  }

  /// A new mini remote, on `script` if one's given.
  static Future<void> add([Json? script]) async {
    if (script != null && script['id'] != Scripts.I.activeId) Session.I.switchTo('${script['id']}');
    final id = 'w${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}';
    final w = <String, dynamic>{'id': id, 'code': script?['id'], 'name': script?['name'] ?? 'Mini remote', 'items': <dynamic>[], 'onTop': true, 'bounds': null};
    _save([..._all(), w]);
    await _open(w);
  }

  /// Every kept widget, where it was, as the app starts.
  static Future<void> reopenAll() async {
    for (final w in _all()) {
      await _open(w);
    }
  }

  /// The main window answers its widgets: the prompter's state, a command, open the window.
  static void listen(void Function(String? link) open) {
    widgetChannel.setMethodCallHandler((call) async {
      switch (call.method) {
        case 'state':
          final p = Prompter.I;
          return jsonEncode({
            'name': Session.I.script['name'],
            'playing': p.playing,
            'elapsed': p.elapsedMs,
            'progress': p.progress,
            'speed': p.speed,
          });
        case 'command':
          final m = call.arguments is String ? jsonDecode(call.arguments as String) : null;
          if (m is Map) Session.I.handleRemoteMessage({'type': 'command', ...Map<String, dynamic>.from(m)});
          return null;
        case 'open':
          open(call.arguments is String ? call.arguments as String : null);
          return null;
      }
      return null;
    });
  }
}

/// A widget's own engine: its window set up, then its screen.
Future<void> runWidgetWindow(String id) async {
  await Store.open();
  ThemeController.I.init();
  await windowManager.ensureInitialized();
  final w = DeskWidgets._all().where((x) => x['id'] == id).firstOrNull;
  if (w == null) return;
  final b = w['bounds'];
  await windowManager.waitUntilReadyToShow(
    WindowOptions(
      size: b is Map ? Size((b['width'] as num).toDouble(), (b['height'] as num).toDouble()) : const Size(320, 200),
      minimumSize: const Size(200, 110),
      skipTaskbar: true,
      titleBarStyle: TitleBarStyle.hidden,
      windowButtonVisibility: false,
      alwaysOnTop: w['onTop'] == true,
      backgroundColor: Colors.transparent,
    ),
  );
  if (b is Map) await windowManager.setPosition(Offset((b['x'] as num).toDouble(), (b['y'] as num).toDouble()));
  await windowManager.setAsFrameless();
  await windowManager.show();
  runApp(_WidgetApp(id: id));
}

class _WidgetApp extends StatefulWidget {
  const _WidgetApp({required this.id});
  final String id;

  @override
  State<_WidgetApp> createState() => _WidgetAppState();
}

class _WidgetAppState extends State<_WidgetApp> with WindowListener {
  Map<String, dynamic> _w = {};
  Map<String, dynamic>? _state;
  bool _reached = true;
  Timer? _poll;
  Timer? _keep;

  @override
  void initState() {
    super.initState();
    _w = DeskWidgets._all().firstWhere((x) => x['id'] == widget.id, orElse: () => {'id': widget.id});
    windowManager.addListener(this);
    _fetch();
    _poll = Timer.periodic(const Duration(milliseconds: 250), (_) => _fetch());
  }

  @override
  void dispose() {
    _poll?.cancel();
    windowManager.removeListener(this);
    super.dispose();
  }

  Future<void> _fetch() async {
    try {
      final raw = await widgetChannel.invokeMethod<String>('state');
      final v = raw == null ? null : jsonDecode(raw);
      if (!mounted) return;
      setState(() {
        _state = v is Map ? Map<String, dynamic>.from(v) : null;
        _reached = true;
      });
    } catch (_) {
      if (mounted) setState(() => _reached = false);
    }
  }

  void _command(Map<String, Object?> m) {
    widgetChannel.invokeMethod('command', jsonEncode(m)).catchError((Object _) => null);
    Timer(const Duration(milliseconds: 60), _fetch);
  }

  void _update(Map<String, dynamic> changes) {
    final list = DeskWidgets._all();
    final i = list.indexWhere((x) => x['id'] == widget.id);
    if (i < 0) return;
    list[i] = {...list[i], ...changes};
    _w = list[i];
    DeskWidgets._save(list);
  }

  Future<void> _togglePin() async {
    final on = _w['onTop'] != true;
    _update({'onTop': on});
    await windowManager.setAlwaysOnTop(on);
    setState(() {});
  }

  Future<void> _remove() async {
    DeskWidgets._save(DeskWidgets._all().where((x) => x['id'] != widget.id).toList());
    await windowManager.close();
  }

  void _keepBounds() {
    _keep?.cancel();
    _keep = Timer(const Duration(milliseconds: 500), () async {
      final r = await windowManager.getBounds();
      _update({
        'bounds': {'x': r.left.round(), 'y': r.top.round(), 'width': r.width.round(), 'height': r.height.round()},
      });
    });
  }

  @override
  void onWindowMoved() => _keepBounds();

  @override
  void onWindowResized() => _keepBounds();

  @override
  Widget build(BuildContext context) {
    final t = ThemeController.I;
    // Dark by default, with its own compact look; light when the app is light.
    final dark = t.mode == 'dark' || t.modePreference == 'time' && t.mode == 'dark';
    final theme = buildTheme(look: lookUwuApps, brightness: dark ? Brightness.dark : Brightness.light, brand: t.colorTheme.color, desktop: true);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: theme,
      home: Builder(builder: (context) => _body(context)),
    );
  }

  Widget _body(BuildContext context) {
    final c = UwuColors.of(context);
    final s = _state;
    final playing = s?['playing'] == true;
    final progress = (s?['progress'] as num? ?? 0).toDouble();
    Widget small(String icon, String label, VoidCallback onTap, {bool on = false}) => Tooltip(
      message: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.all(5), child: AppIcon(icon, size: 14, color: on ? c.brandInk : c.muted)),
      ),
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Container(
        decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(14), border: Border.all(color: c.border)),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DragToMoveArea(
              child: Container(
                color: c.surfaceStrong,
                padding: const EdgeInsets.fromLTRB(10, 4, 4, 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _reached ? '${s?['name'] ?? 'uwuPromptr'}' : 'uwuPromptr isn’t open',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: c.ink, fontSize: 13),
                      ),
                    ),
                    small('monitor', 'Open uwuPromptr', () => widgetChannel.invokeMethod('open').catchError((Object _) => null)),
                    small('pin', 'Keep on top', _togglePin, on: _w['onTop'] == true),
                    small('close', 'Remove', _remove),
                  ],
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                child: LayoutBuilder(
                  builder: (context, box) {
                    final tight = box.maxHeight < 90;
                    return Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Row(
                          children: [
                            Text(formatElapsed(s?['elapsed'] as num? ?? 0), style: TextStyle(color: c.ink, fontSize: 20, fontFeatures: const [FontFeature.tabularFigures()])),
                            const Spacer(),
                            Text('Speed ${(s?['speed'] as num? ?? 12).toDouble().toStringAsFixed(1)}', style: TextStyle(color: c.muted, fontSize: 12)),
                          ],
                        ),
                        const SizedBox(height: 6),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(value: math.min(1, progress / 100), minHeight: 5, color: c.brandInk, backgroundColor: c.surfaceStrong),
                        ),
                        if (!tight) const SizedBox(height: 10),
                        if (!tight)
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              IconButton(tooltip: 'Reset to the top', onPressed: () => _command({'name': 'reset'}), icon: AppIcon('reset', size: 18, color: c.ink)),
                              IconButton(
                                tooltip: 'Slower',
                                onPressed: () => _command({'name': 'nudge', 'setting': 'speed', 'value': -1}),
                                icon: AppIcon('minus', size: 18, color: c.ink),
                              ),
                              FilledButton(
                                onPressed: _reached ? () => _command({'name': 'toggle'}) : null,
                                style: FilledButton.styleFrom(shape: const CircleBorder(), padding: const EdgeInsets.all(12)),
                                child: AppIcon(playing ? 'pause' : 'play', size: 20, color: c.onBrand),
                              ),
                              IconButton(
                                tooltip: 'Faster',
                                onPressed: () => _command({'name': 'nudge', 'setting': 'speed', 'value': 1}),
                                icon: AppIcon('plus', size: 18, color: c.ink),
                              ),
                            ],
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
