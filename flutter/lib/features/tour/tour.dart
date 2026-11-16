// First-visit tours (docs/page-tour-spec.md, the site's js/tour.js): the page dims, one thing on
// it is lit, and a chalk arrow runs to it from a line saying what it does. A tour for each page
// (the prompter, which is also the welcome, and the remote) and for the remote control window,
// shown the first time each is on screen. Settings' Show me around replays any of them. Each step
// is scrolled into view before it's lit, and the card and its arrow are kept on screen whatever
// the size of the window or of the thing lit. Seen under the site's keys.
import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/env.dart';
import '../../app/nav.dart';
import '../../app/pages.dart';
import '../../data/scripts.dart';
import '../../data/store.dart';
import '../../theme/theme.dart';
import '../../widgets/sheet.dart';
import '../prompter/remote_panel.dart';
import '../remote/remote_session.dart';

const _welcomeKey = 'uwupromptr.tour.welcome';
const _pagesKey = 'uwupromptr.tour.pages';

/// Things a tour can point at, by name: each widget that can be pointed at carries one of these
/// keys.
class TourTargets {
  TourTargets._();
  static final Map<String, GlobalKey> _keys = {};
  static GlobalKey key(String id) =>
      _keys.putIfAbsent(id, () => GlobalKey(debugLabel: 'tour:$id'));

  /// Where the thing is, measured from the top left of the navigator's overlay, which is where the
  /// tour draws. That isn't the window's top left on the desktop, whose title bar sits above it.
  static Rect? rectOf(String id) {
    final ctx = _keys[id]?.currentContext;
    final box = ctx?.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return null;
    final layer = AppNav.navigatorKey.currentState?.overlay?.context
        .findRenderObject();
    final origin = layer is RenderBox && layer.attached
        ? layer.localToGlobal(Offset.zero)
        : Offset.zero;
    final r = (box.localToGlobal(Offset.zero) - origin) & box.size;
    return r.width > 0 && r.height > 0 ? r : null;
  }
}

class TourStep {
  const TourStep(this.targets, this.text, {this.when});

  /// Alternatives, in order: the first on screen is used.
  final List<String> targets;
  final String text;
  final bool Function()? when;
}

class TourDef {
  const TourDef(this.label, this.steps, {this.page});
  final String label;
  final List<TourStep> steps;
  final String? page;
}

/// Wide enough for the scripts beside the prompter (lib/app/home.dart).
bool _wideForPane() {
  final ctx = AppNav.context;
  return ctx != null && MediaQuery.sizeOf(ctx).width > Env.splitWidth;
}

/// The prompter's tour is the welcome: its key things, then where the remote is and where tours
/// are replayed.
final tours = <String, TourDef>{
  'prompter': TourDef('Prompter', [
    const TourStep([
      'script-switch',
      'top-tab',
    ], 'Your scripts. Switch to another one, or start a new one, here.'),
    const TourStep([
      'edit',
      'top-tab',
    ], 'Write or paste your script. It saves as you type.'),
    const TourStep([
      'play',
      'bottom-tab',
    ], 'Start and stop the scroll. Space does it too.'),
    const TourStep(
      ['speed-stepper', 'bottom-tab'],
      'Faster or slower while it runs, a tenth at a time. The font size is beside it.',
    ),
    const TourStep([
      'remote-btn',
      'top-tab',
    ], 'Drive it from your phone: this gives a code to type in there.'),
    TourStep(
      const ['scripts-pane'],
      'Your scripts, beside the prompter. The buttons at the top, by Copy link, put them away, or make this computer the remote for a prompter somewhere else.',
      when: () => Env.desktop && Scripts.I.pane && _wideForPane(),
    ),
    const TourStep([
      'settings-btn',
      'side-tab',
    ], 'Settings has every option, and Show me around for these tours again.'),
  ], page: AppPages.prompter),
  'remote': const TourDef('Remote', [
    TourStep(
      ['code-input'],
      'Type the remote ID the prompter shows: on another device, or the website.',
    ),
    TourStep(
      ['connect-btn'],
      'Connect. Both devices need to be on the same network, or a hotspot from one to the other.',
    ),
    TourStep(['remote-play'], 'Start and stop the prompter from here.'),
    TourStep([
      'remote-speed',
    ], 'The outer buttons are big steps, the inner ones fine.'),
    TourStep(
      ['remote-mirror'],
      'A copy of the prompter’s screen, scrolling with it. Edit changes its script.',
    ),
    TourStep(['remote-home'], 'Back to this device’s own prompter.'),
  ], page: AppPages.remote),
  'remote-panel': const TourDef('Remote control', [
    TourStep([
      'remote-code',
    ], 'Type this ID into the remote on the other device. Tap it to copy it.'),
    TourStep(['remote-qr'], 'Or scan this with the other phone’s camera.'),
    TourStep([
      'nearby-host',
    ], 'No wifi? Two phones with the app connect straight to each other.'),
    TourStep(['remote-open'], 'To make this device the remote instead.'),
  ], page: 'remote-panel'),
};

const tourOrder = ['prompter', 'remote', 'remote-panel'];

class Tour {
  Tour._();

  static OverlayEntry? _entry;
  static bool _starting = false;
  static List<({String target, String text})> _steps = [];
  static List<String> _marks = [];
  static final ValueNotifier<int> _at = ValueNotifier(0);
  static Timer? _waiting;

  /// For tests and screenshots: no tours start by themselves.
  static bool off = false;

  /// What's on screen now: a page, or the window open over it.
  static String? currentPage() {
    final open = AppSheet.open.value;
    if (open.isNotEmpty) return open.last;
    return AppPages.active();
  }

  /// Opens a page (or the remote control window) for its tour.
  static Future<void> openPage(String page) async {
    if (page == 'remote-panel') {
      AppSheet.closeAll();
      AppPages.open(AppPages.prompter);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      final ctx = AppNav.context;
      if (ctx != null && ctx.mounted) unawaited(openRemotePanel(ctx));
      return;
    }
    AppSheet.closeAll();
    AppPages.open(page);
  }

  static bool get active => _entry != null || _starting;

  static bool seen(String id) {
    try {
      if (id == 'prompter') return Store.I.get(_welcomeKey) == 'done';
      return (jsonDecode(Store.I.get(_pagesKey) ?? '[]') as List).contains(id);
    } catch (_) {
      // Broken storage counts every tour as seen, rather than showing one on every visit.
      return true;
    }
  }

  static void markSeen(String id) {
    try {
      if (id == 'prompter') return Store.I.put(_welcomeKey, 'done');
      final list = (jsonDecode(Store.I.get(_pagesKey) ?? '[]') as List)
          .cast<Object?>();
      if (!list.contains(id)) Store.I.put(_pagesKey, jsonEncode([...list, id]));
    } catch (_) {
      // Shown again next time.
    }
  }

  static StreamSubscription<void>? _sub;

  /// Once the app is on screen: the first tour, unless a link opened something.
  static void init() {
    _sub ??= AppPages.changes.listen((_) => forPage());
    // A link that opened the remote came for that, not a tour.
    if (RemoteSession.I.status != 'idle') return;
    forPage();
  }

  /// The tour for what's on screen, the first time, once it's drawn (about a second, so the
  /// switch's animation is done first).
  static void forPage() {
    if (active || off) return;
    final id = currentPage();
    if (id == null || !tours.containsKey(id) || seen(id)) return;
    _waiting?.cancel();
    var tries = 0;
    _waiting = Timer.periodic(const Duration(milliseconds: 500), (t) {
      tries++;
      if (currentPage() != id || active) return t.cancel();
      if (tries < 2) return;
      t.cancel();
      start(id);
    });
  }

  static Future<void> start(String id) async {
    final tour = tours[id];
    if (active || tour == null) return;
    final from = currentPage();
    if (from == null) return;
    final goTo = tour.page;
    _starting = true;
    if (goTo != null && from != goTo) {
      await openPage(goTo);
      await Future<void>.delayed(const Duration(milliseconds: 450));
    } else {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    _starting = false;
    // What's on screen changed while the page was drawn: not this tour, now.
    if (currentPage() != (goTo ?? from)) {
      Timer(const Duration(milliseconds: 600), forPage);
      return;
    }
    final steps = <({String target, String text})>[];
    String? lastTarget;
    for (final s in tour.steps) {
      if (s.when != null && !s.when!()) continue;
      final target = s.targets
          .where((t) => TourTargets.rectOf(t) != null)
          .firstOrNull;
      // Two steps can land on the same thing, such as a put away bar's tab.
      if (target == null || target == lastTarget) continue;
      lastTarget = target;
      steps.add((target: target, text: s.text));
    }
    if (steps.isEmpty) {
      markSeen(id);
      _backTo(from);
      return;
    }
    _marks = [id];
    _steps = steps;
    _at.value = 0;
    _began = from;
    final overlay = AppNav.navigatorKey.currentState?.overlay;
    if (overlay == null) return;
    _entry = OverlayEntry(builder: (_) => const _TourLayer());
    overlay.insert(_entry!);
  }

  static String? _began;

  static void next() {
    if (_at.value < _steps.length - 1) {
      _at.value++;
    } else {
      end();
    }
  }

  static void end() {
    for (final id in _marks) {
      markSeen(id);
    }
    _marks = [];
    _entry?.remove();
    _entry = null;
    final back = _began;
    _began = null;
    if (!_backTo(back)) Timer(const Duration(milliseconds: 600), forPage);
  }

  /// Back to the page a replay began on (never a window: one that has closed since stays closed).
  /// True if it went back.
  static bool _backTo(String? page) {
    if (page == null || !AppPages.all.contains(page)) return false;
    if (AppSheet.anyOpen &&
        AppSheet.open.value.last == 'remote-panel' &&
        page != 'remote-panel')
      AppSheet.closeAll();
    if (AppPages.active() == page) return false;
    AppPages.open(page);
    return true;
  }
}

class _TourLayer extends StatefulWidget {
  const _TourLayer();

  @override
  State<_TourLayer> createState() => _TourLayerState();
}

class _TourLayerState extends State<_TourLayer> {
  final _focus = FocusNode();
  final _placed = _Placement();

  @override
  void initState() {
    super.initState();
    Tour._at.addListener(_reveal);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focus.requestFocus();
      _reveal();
    });
  }

  @override
  void dispose() {
    Tour._at.removeListener(_reveal);
    _focus.dispose();
    super.dispose();
  }

  /// The step's target scrolled into view if it's off the edge of what scrolls it (a column past
  /// the right of the board, a field below the fold of a window), then the spotlight moved to it.
  Future<void> _reveal() async {
    if (Tour._steps.isEmpty) return;
    final ctx =
        TourTargets._keys[Tour._steps[Tour._at.value].target]?.currentContext;
    if (ctx == null) return;
    const d = Duration(milliseconds: 220);
    for (final policy in [
      ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
      ScrollPositionAlignmentPolicy.keepVisibleAtStart,
    ]) {
      if (!ctx.mounted) return;
      await Scrollable.ensureVisible(ctx, duration: d, alignmentPolicy: policy);
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: Tour._at,
      builder: (context, at, _) {
        final c = UwuColors.of(context);
        final step = Tour._steps[at];
        final size = MediaQuery.sizeOf(context);
        final pad = MediaQuery.paddingOf(context);
        final screen = Offset.zero & size;
        // Lit up to the screen's edge, never past it.
        final target = TourTargets.rectOf(step.target);
        final lit = target?.inflate(8).intersect(screen.deflate(2));
        final hole = lit != null && lit.width > 0 && lit.height > 0
            ? lit
            : null;
        // Where the card may go: inside the screen and its safe area, and clear of Skip.
        final bounds = Rect.fromLTRB(
          pad.left + 12,
          pad.top + 60,
          size.width - pad.right - 12,
          size.height - pad.bottom - 12,
        );
        final cardW = math.min(340.0, bounds.width);
        final last = at == Tour._steps.length - 1;
        return Focus(
          focusNode: _focus,
          onKeyEvent: (_, e) {
            if (e is! KeyDownEvent) return KeyEventResult.ignored;
            if (e.logicalKey == LogicalKeyboardKey.escape) {
              Tour.end();
              return KeyEventResult.handled;
            }
            if (e.logicalKey == LogicalKeyboardKey.arrowRight ||
                e.logicalKey == LogicalKeyboardKey.enter) {
              Tour.next();
              return KeyEventResult.handled;
            }
            return KeyEventResult.ignored;
          },
          child: Material(
            type: MaterialType.transparency,
            child: Stack(
              children: [
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {},
                    child: CustomPaint(
                      painter: _DimPainter(
                        hole,
                        c.scrim.withValues(alpha: 0.62),
                        _placed,
                        c.brand,
                      ),
                    ),
                  ),
                ),
                Positioned.fill(
                  child: CustomSingleChildLayout(
                    delegate: _CardLayout(hole, bounds, cardW, _placed),
                    child: Semantics(
                      scopesRoute: true,
                      namesRoute: true,
                      label: 'Tour',
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
                        decoration: BoxDecoration(
                          color: Color.alphaBlend(c.surfaceStrong, c.paper),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: c.border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Scrolls inside the card, rather than off the screen, with very
                            // large text on a small screen.
                            Flexible(
                              child: SingleChildScrollView(
                                child: Semantics(
                                  liveRegion: true,
                                  child: Text(
                                    step.text,
                                    style: TextStyle(
                                      color: c.ink,
                                      fontSize: 15,
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                for (var i = 0; i < Tour._steps.length; i++)
                                  Container(
                                    margin: const EdgeInsets.only(right: 5),
                                    width: 7,
                                    height: 7,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: i == at ? c.brandInk : c.border,
                                    ),
                                  ),
                                const Spacer(),
                                FilledButton(
                                  onPressed: Tour.next,
                                  child: Text(last ? 'Done' : 'Next'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                // Top left, as on the site: the top right is the tray's, which steps point at.
                Positioned(
                  top: pad.top + 10,
                  left: pad.left + 14,
                  child: OutlinedButton(
                    onPressed: Tour.end,
                    child: const Text('Skip'),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Where the card went and where its arrow runs, worked out as the card is laid out (when its
/// height is known) and read as the arrow is painted, later in the same frame.
class _Placement {
  Offset? from;
  Offset? tip;
}

/// The card beside the lit thing: below it if it fits, else above, else to its right or left,
/// and if none fits (a target nearly the screen's size), over it at the bottom, without an arrow.
/// Always inside [bounds].
class _CardLayout extends SingleChildLayoutDelegate {
  _CardLayout(this.hole, this.bounds, this.width, this.placed);
  final Rect? hole;
  final Rect bounds;
  final double width;
  final _Placement placed;

  static const gap = 56.0;
  static const sideGap = 48.0;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) =>
      BoxConstraints(
        minWidth: width,
        maxWidth: width,
        maxHeight: math.max(0, bounds.height),
      );

  @override
  Offset getPositionForChild(Size size, Size card) {
    final w = card.width, h = card.height;
    double x(double v) =>
        v.clamp(bounds.left, math.max(bounds.left, bounds.right - w));
    double y(double v) =>
        v.clamp(bounds.top, math.max(bounds.top, bounds.bottom - h));
    placed.from = null;
    placed.tip = null;
    final r = hole;
    if (r == null)
      return Offset(x(bounds.center.dx - w / 2), y(bounds.center.dy - h / 2));

    // The arrow meets the lit box near its middle, but not at a rounded corner.
    double alongX(Rect a) => a.width > 24
        ? a.center.dx.clamp(a.left + 12, a.right - 12)
        : a.center.dx;
    double alongY(Rect a) => a.height > 24
        ? a.center.dy.clamp(a.top + 12, a.bottom - 12)
        : a.center.dy;

    if (bounds.bottom - r.bottom >= h + gap) {
      final at = Offset(x(r.center.dx - w / 2), r.bottom + gap);
      placed.tip = Offset(alongX(r), r.bottom + 4);
      placed.from = Offset(
        placed.tip!.dx.clamp(at.dx + 24, at.dx + w - 24),
        at.dy - 4,
      );
      return at;
    }
    if (r.top - bounds.top >= h + gap) {
      final at = Offset(x(r.center.dx - w / 2), r.top - gap - h);
      placed.tip = Offset(alongX(r), r.top - 4);
      placed.from = Offset(
        placed.tip!.dx.clamp(at.dx + 24, at.dx + w - 24),
        at.dy + h + 4,
      );
      return at;
    }
    if (bounds.right - r.right >= w + sideGap) {
      final at = Offset(r.right + sideGap, y(r.center.dy - h / 2));
      placed.tip = Offset(r.right + 4, alongY(r));
      placed.from = Offset(
        at.dx - 4,
        placed.tip!.dy.clamp(at.dy + 20, at.dy + h - 20),
      );
      return at;
    }
    if (r.left - bounds.left >= w + sideGap) {
      final at = Offset(r.left - sideGap - w, y(r.center.dy - h / 2));
      placed.tip = Offset(r.left - 4, alongY(r));
      placed.from = Offset(
        at.dx + w + 4,
        placed.tip!.dy.clamp(at.dy + 20, at.dy + h - 20),
      );
      return at;
    }
    return Offset(x(r.center.dx - w / 2), y(bounds.bottom - h));
  }

  @override
  bool shouldRelayout(_CardLayout old) =>
      old.hole != hole || old.bounds != bounds || old.width != width;
}

class _DimPainter extends CustomPainter {
  _DimPainter(this.hole, this.dim, this.placed, this.chalk);
  final Rect? hole;
  final Color dim;
  final _Placement placed;
  final Color chalk;

  @override
  void paint(Canvas canvas, Size size) {
    final outer = Path()..addRect(Offset.zero & size);
    final r = hole;
    if (r == null) {
      canvas.drawPath(outer, Paint()..color = dim);
      return;
    }
    final cut = Path()
      ..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(12)));
    canvas.drawPath(
      Path.combine(PathOperation.difference, outer, cut),
      Paint()..color = dim,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(r, const Radius.circular(12)),
      Paint()
        ..color = chalk
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );
    // The chalk arrow, from the card to the thing it's about, with a slight bow.
    final start = placed.from, tip = placed.tip;
    if (start == null || tip == null || (tip - start).distance < 8) return;
    final along = tip - start;
    final bow = Offset(-along.dy, along.dx) / along.distance * 24;
    final ctrl = Offset((start.dx + tip.dx) / 2, (start.dy + tip.dy) / 2) + bow;
    final line = Paint()
      ..color = chalk
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(
      Path()
        ..moveTo(start.dx, start.dy)
        ..quadraticBezierTo(ctrl.dx, ctrl.dy, tip.dx, tip.dy),
      line,
    );
    final ang = math.atan2(tip.dy - ctrl.dy, tip.dx - ctrl.dx);
    for (final a in [ang + math.pi * 0.8, ang - math.pi * 0.8]) {
      canvas.drawLine(
        tip,
        tip + Offset(math.cos(a) * 14, math.sin(a) * 14),
        line,
      );
    }
  }

  // The card's place is only known once it's laid out, in the same frame, so always repaint.
  @override
  bool shouldRepaint(_DimPainter old) => true;
}

/// Settings' Show me around: a button per tour. The settings window closes first.
class TourPicks extends StatelessWidget {
  const TourPicks({super.key});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final id in tourOrder)
          OutlinedButton(
            onPressed: () {
              AppSheet.closeAll();
              Timer(const Duration(milliseconds: 300), () => Tour.start(id));
            },
            child: Text(tours[id]!.label),
          ),
      ],
    );
  }
}

/// "Show me around" on its own (the desktop's command bar and menu): a button per tour.
Future<void> openTourPicker(BuildContext context) {
  return AppSheet.show(
    context,
    id: 'tour',
    width: 420,
    builder: (context) {
      final c = UwuColors.of(context);
      return SheetFrame(
        title: 'Show me around',
        children: [
          const TourPicks(),
          const SizedBox(height: 12),
          Text(
            'Each page shows you around the first time you open it. Pick one to see its tour again.',
            style: TextStyle(color: c.muted, fontSize: 12.5),
          ),
        ],
      );
    },
  );
}
