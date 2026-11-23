// The prompter page (main-site/index.html): the script on the stage in the reading colours, the
// focus arrows, the editor over it, and the three Edge Trays round it. The trays fade out of the
// way while the script moves, and come back on any touch, pointer movement or key.
import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import '../../app/env.dart';
import '../../app/fullscreen.dart';
import '../../app/nav.dart';
import '../../data/prompter_logic.dart';
import '../../data/scripts.dart';
import '../../native/bridge.dart';
import '../../theme/icons.dart';
import '../../theme/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/sheet.dart';
import '../bug/bug_report.dart';
import '../theme/theme_sheet.dart';
import '../tour/tour.dart';
import '../update/update_bar.dart';
import 'app_extras.dart';
import 'editor.dart';
import 'prompter.dart';
import 'remote_panel.dart';
import 'scripts_sheet.dart';
import 'session.dart';
import 'settings_sheet.dart';
import 'trays.dart';

/// The stage's colours: light mode is near-black on the brand colour, dark mode the brand colour
/// on near-black (main-site/css/app.css). In Material You, the device's palette instead, and in
/// the desktop's glass look, the system's accent, tinted glass that's nearly solid, for reading
/// from (solid where the window can't be seen through).
({Color bg, Color ink}) stageColours(
  BuildContext context, {
  String? mode,
  Color? brand,
}) {
  final t = ThemeController.I;
  final dark = (mode ?? t.mode) == 'dark';
  if (t.isGlass && mode == null) {
    final c = UwuColors.of(context);
    final see = t.backdrop == Backdrop.none ? 1.0 : 0.86;
    return dark
        ? (bg: const Color(0xFF0E0E10).withValues(alpha: see), ink: c.brandInk)
        : (bg: Color.alphaBlend(c.brand.withValues(alpha: 0.7), c.paper).withValues(alpha: see), ink: c.ink);
  }
  if (t.isMaterial && mode == null) {
    final s = Theme.of(context).colorScheme;
    return dark
        ? (bg: s.surface, ink: s.primary)
        : (bg: s.primaryContainer, ink: s.onPrimaryContainer);
  }
  final b = brand ?? t.colorTheme.color;
  return dark
      ? (bg: const Color(0xFF0C100E), ink: b)
      : (bg: b, ink: const Color(0xFF121815));
}

/// The bars come back for this long after the last touch or key while the script moves.
const _wakeFor = Duration(milliseconds: 2500);

class PrompterChrome {
  PrompterChrome._();

  /// True while the bars are awake over a moving script.
  static final ValueNotifier<bool> awake = ValueNotifier(false);
  static Timer? _timer;

  static void wake() {
    awake.value = true;
    _timer?.cancel();
    _timer = Timer(_wakeFor, () => awake.value = false);
  }
}

class PrompterScreen extends StatefulWidget {
  const PrompterScreen({super.key});

  @override
  State<PrompterScreen> createState() => _PrompterScreenState();
}

class _PrompterScreenState extends State<PrompterScreen> {
  double _topH = 76;
  double _bottomH = 74;

  @override
  Widget build(BuildContext context) {
    final listen = Listenable.merge([
      Session.I,
      Prompter.I,
      Trays.I,
      ThemeController.I,
      Scripts.I,
      PrompterChrome.awake,
      Fullscreen.on,
    ]);
    return ListenableBuilder(
      listenable: listen,
      builder: (context, _) {
        final size = MediaQuery.sizeOf(context);
        final pad = MediaQuery.paddingOf(context);
        final trays = Trays.I;
        final p = Prompter.I;
        final stage = stageColours(context);
        final hidden = p.playing && !PrompterChrome.awake.value;
        final narrow = size.width <= 480;
        final glassBtn = narrow ? 40.0 : 44.0;
        final edge = narrow ? 10.0 : 16.0;
        final sideRoom =
            glassBtn + edge + 12 + (trays.left ? pad.left : pad.right);
        final topRoom = trays.top ? _topH : 0.0;
        final bottomRoom = trays.bottom ? _bottomH : 0.0;
        final reduce = MediaQuery.disableAnimationsOf(context);
        final trayTime = Duration(milliseconds: reduce ? 0 : 340);
        const trayCurve = Cubic(0.2, 0.8, 0.2, 1);
        p.windowHeight = size.height;
        return Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) => PrompterChrome.wake(),
          onPointerHover: (_) => PrompterChrome.wake(),
          child: Container(
            color: stage.bg,
            child: Stack(
              children: [
                // The part of the stage the open trays leave clear.
                AnimatedPositioned(
                  duration: trayTime,
                  curve: trayCurve,
                  top: topRoom,
                  bottom: bottomRoom,
                  left: trays.side && trays.left ? sideRoom : 0,
                  right: trays.side && !trays.left ? sideRoom : 0,
                  // An open tray already keeps the stage clear of the bar behind it.
                  child: MediaQuery.removePadding(
                    context: context,
                    removeTop: trays.top,
                    removeBottom: trays.bottom,
                    child: _Reading(ink: stage.ink),
                  ),
                ),
                // The three trays, faded and untouchable while the script moves.
                Positioned.fill(
                  child: IgnorePointer(
                    ignoring: hidden,
                    child: AnimatedOpacity(
                      opacity: hidden ? 0 : 1,
                      duration: const Duration(milliseconds: 200),
                      child: Stack(
                        children: [
                          // Top.
                          AnimatedPositioned(
                            duration: trayTime,
                            curve: trayCurve,
                            left: 0,
                            right: 0,
                            top: trays.top ? 0 : -(_topH + 8),
                            child: _HBar(
                              top: true,
                              open: trays.top,
                              glassBtn: glassBtn,
                              child: _Measure(
                                onSize: (s) {
                                  if ((s.height - _topH).abs() > 0.5)
                                    setState(() => _topH = s.height);
                                },
                                child: _TopBar(wide: size.width > 720),
                              ),
                            ),
                          ),
                          // Bottom.
                          AnimatedPositioned(
                            duration: trayTime,
                            curve: trayCurve,
                            left: 0,
                            right: 0,
                            bottom: trays.bottom ? 0 : -(_bottomH + 8),
                            child: _HBar(
                              top: false,
                              open: trays.bottom,
                              glassBtn: glassBtn,
                              child: _Measure(
                                onSize: (s) {
                                  if ((s.height - _bottomH).abs() > 0.5)
                                    setState(() => _bottomH = s.height);
                                },
                                child: _Transport(wide: size.width > 720),
                              ),
                            ),
                          ),
                          // Side.
                          AnimatedPositioned(
                            duration: trayTime,
                            curve: trayCurve,
                            top: topRoom,
                            bottom: bottomRoom,
                            left: trays.left
                                ? (trays.side
                                      ? 0
                                      : -(glassBtn + 8 + edge + pad.left))
                                : null,
                            right: trays.left
                                ? null
                                : (trays.side
                                      ? 0
                                      : -(glassBtn + 8 + edge + pad.right)),
                            child: _SideTray(
                              glassBtn: glassBtn,
                              edge: edge + (trays.left ? pad.left : pad.right),
                            ),
                          ),
                        ],
                      ),
                    ),
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

/// Reports its child's size after layout, as edge-tray.js measures the bars.
class _Measure extends SingleChildRenderObjectWidget {
  const _Measure({required this.onSize, required super.child});
  final ValueChanged<Size> onSize;

  @override
  RenderObject createRenderObject(BuildContext context) => _MeasureBox(onSize);

  @override
  void updateRenderObject(BuildContext context, _MeasureBox renderObject) =>
      renderObject.onSize = onSize;
}

class _MeasureBox extends RenderProxyBox {
  _MeasureBox(this.onSize);
  ValueChanged<Size> onSize;
  Size? _last;

  @override
  void performLayout() {
    super.performLayout();
    if (size != _last) {
      _last = size;
      final s = size;
      WidgetsBinding.instance.addPostFrameCallback((_) => onSize(s));
    }
  }
}

/// The reading area: the script, scrolled by the engine, with the focus arrows over it and the
/// editor over everything.
class _Reading extends StatelessWidget {
  const _Reading({required this.ink});
  final Color ink;

  @override
  Widget build(BuildContext context) {
    final p = Prompter.I;
    final s = Session.I;
    final script = s.script;
    final font = Theme.of(context).textTheme.bodyLarge?.fontFamily;
    final flipX = p.flag('flipX'), flipY = p.flag('flipY');
    return LayoutBuilder(
      builder: (context, box) {
        p.viewWidth = box.maxWidth;
        final side = box.maxWidth * p.margin.toDouble() / 100;
        Widget text = Padding(
          padding: EdgeInsets.fromLTRB(side, p.padTop, side, p.padBottom),
          child: Text(
            '${script['body']}',
            key: TourTargets.key('script'),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: p.fontSize.toDouble(),
              height: p.lineHeight.toDouble(),
              color: ink,
              fontFamily: font,
            ),
          ),
        );
        // Both flips are one transform on the text, not on the scrolling box: flipping that would
        // turn the scroll round with the letters.
        if (flipX || flipY)
          text = Transform.flip(flipX: flipX, flipY: flipY, child: text);
        return Stack(
          children: [
            Positioned.fill(
              child: ScrollConfiguration(
                behavior: ScrollConfiguration.of(context).copyWith(
                  scrollbars: false,
                  overscroll: false,
                  dragDevices: PointerDeviceKind.values.toSet(),
                ),
                child: SingleChildScrollView(
                  controller: p.scroll,
                  physics: const ClampingScrollPhysics(),
                  child: SizedBox(width: box.maxWidth, child: text),
                ),
              ),
            ),
            if (p.flag('focusLine')) ...[
              _Arrow(
                top: box.maxHeight * p.focusPosition.toDouble() / 100,
                left: true,
                colour: ink,
              ),
              _Arrow(
                top: box.maxHeight * p.focusPosition.toDouble() / 100,
                left: false,
                colour: ink,
              ),
            ],
            if (s.editorOpen) const Positioned.fill(child: ScriptEditor()),
          ],
        );
      },
    );
  }
}

/// One focus arrow, at the edge, pointing in (the site's .show-focus triangles).
class _Arrow extends StatelessWidget {
  const _Arrow({required this.top, required this.left, required this.colour});
  final double top;
  final bool left;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: top - 12,
      left: left ? 0 : null,
      right: left ? null : 0,
      child: IgnorePointer(
        child: Opacity(
          opacity: 0.55,
          child: CustomPaint(
            size: const Size(16, 24),
            painter: _TrianglePainter(colour, pointsRight: left),
          ),
        ),
      ),
    );
  }
}

class _TrianglePainter extends CustomPainter {
  _TrianglePainter(this.colour, {required this.pointsRight});
  final Color colour;
  final bool pointsRight;

  @override
  void paint(Canvas canvas, Size size) {
    final path = pointsRight
        ? (Path()
            ..moveTo(0, 0)
            ..lineTo(size.width, size.height / 2)
            ..lineTo(0, size.height))
        : (Path()
            ..moveTo(size.width, 0)
            ..lineTo(0, size.height / 2)
            ..lineTo(size.width, size.height));
    canvas.drawPath(path..close(), Paint()..color = colour);
  }

  @override
  bool shouldRepaint(_TrianglePainter old) =>
      old.colour != colour || old.pointsRight != pointsRight;
}

/// A bar and its tab, which moves with it: the tab hangs 8px off the bar's inner edge, so a put
/// away bar leaves just the tab, flush with the screen's edge.
class _HBar extends StatelessWidget {
  const _HBar({
    required this.top,
    required this.open,
    required this.glassBtn,
    required this.child,
  });
  final bool top;
  final bool open;
  final double glassBtn;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final pad = MediaQuery.paddingOf(context);
    final name = top ? 'top' : 'bottom';
    final label = open ? 'Hide $name bar' : 'Show $name bar';
    // The chevron points the way the tray will go.
    final icon = top
        ? (open ? 'chevron-up' : 'chevron-down')
        : (open ? 'chevron-down' : 'chevron-up');
    final safe = top ? pad.top : pad.bottom;
    // Out of the way while the editor covers the stage: the top one would sit on its Cancel.
    final editing = Session.I.editorOpen;
    final tab = IgnorePointer(
      ignoring: editing,
      child: AnimatedOpacity(
        opacity: editing ? 0 : 1,
        duration: const Duration(milliseconds: 150),
        child: ExcludeSemantics(
          excluding: editing,
          child: _tabFor(context, top, open, name, label, icon, safe, c),
        ),
      ),
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: top
          ? [
              AnimatedOpacity(
                opacity: open ? 1 : 0,
                duration: const Duration(milliseconds: 270),
                child: child,
              ),
              const SizedBox(height: 8),
              tab,
            ]
          : [
              tab,
              const SizedBox(height: 8),
              AnimatedOpacity(
                opacity: open ? 1 : 0,
                duration: const Duration(milliseconds: 270),
                child: child,
              ),
            ],
    );
  }

  Widget _tabFor(
    BuildContext context,
    bool top,
    bool open,
    String name,
    String label,
    String icon,
    double safe,
    UwuColors c,
  ) {
    return Center(
      child: KeyedSubtree(
        key: TourTargets.key('$name-tab'),
        child: Tooltip(
          excludeFromSemantics: true,
          message: label,
          child: Semantics(
            button: true,
            expanded: open,
            label: label,
            excludeSemantics: true,
            child: Material(
              color: c.surfaceStrong,
              shape: RoundedRectangleBorder(
                borderRadius: open
                    ? BorderRadius.circular(12)
                    : (top
                          ? const BorderRadius.vertical(
                              bottom: Radius.circular(12),
                            )
                          : const BorderRadius.vertical(
                              top: Radius.circular(12),
                            )),
                side: BorderSide(color: c.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                mouseCursor: WidgetStateMouseCursor.clickable,
                onTap: () => Trays.I.toggle(name),
                child: Padding(
                  padding: EdgeInsets.only(
                    top: top && !open ? safe : 0,
                    bottom: !top && !open ? safe : 0,
                  ),
                  child: SizedBox(
                    width: glassBtn,
                    height: 24,
                    child: Center(child: AppIcon(icon, size: 16, color: c.ink)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String remoteLight(String status) => switch (status) {
  'connected' => 'ok',
  'waiting' || 'connecting' => 'warn',
  'error' => 'error',
  _ => '',
};

/// The top bar: the brand, the script switcher, Edit and Remote.
class _TopBar extends StatelessWidget {
  const _TopBar({required this.wide});
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final s = Session.I;
    final pad = MediaQuery.paddingOf(context);
    final light = remoteLight(s.remoteStatus);
    final badge = switch (light) {
      'ok' => c.ok,
      'warn' => c.warn,
      'error' => c.error,
      _ => c.busy,
    };
    return GlassPanel(
      radius: 0,
      blur: true,
      border: Border(bottom: BorderSide(color: c.border)),
      padding: EdgeInsets.fromLTRB(
        14 + pad.left,
        10 + pad.top,
        14 + pad.right,
        10,
      ),
      child: Row(
        children: [
          if (wide) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset(
                'assets/images/icon-512.png',
                width: 26,
                height: 26,
                excludeFromSemantics: true,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              'uwuPromptr',
              style: TextStyle(color: c.brandInk, fontSize: 16),
            ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: KeyedSubtree(
              key: TourTargets.key('script-switch'),
              child: Semantics(
                button: true,
                label: 'Scripts: ${s.script['name']}',
                excludeSemantics: true,
                child: Material(
                  color: c.brandFill,
                  shape: StadiumBorder(side: BorderSide(color: c.border)),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    mouseCursor: WidgetStateMouseCursor.clickable,
                    onTap: () => openScriptsSheet(context),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 9,
                      ),
                      child: Row(
                        children: [
                          AppIcon('scripts', size: 16, color: c.onBrand),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${s.script['name']}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(color: c.onBrand, fontSize: 14),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          KeyAction(
            hint: 'Ctrl+E',
            show: wide,
            child: KeyedSubtree(
              key: TourTargets.key('edit'),
              child: IconBtn(
                icon: 'edit',
                label: 'Edit script (Ctrl+E)',
                onPressed: s.openEditor,
              ),
            ),
          ),
          const SizedBox(width: 6),
          KeyAction(
            hint: 'Alt+R',
            show: wide,
            child: KeyedSubtree(
              key: TourTargets.key('remote-btn'),
              child: IconBtn(
                icon: 'remote',
                label: 'Remote control (Alt+R). ${s.statusText}',
                badge: badge,
                onPressed: () => openRemotePanel(context),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The transport: play, reset, the font and speed steppers, and the clock.
class _Transport extends StatelessWidget {
  const _Transport({required this.wide});
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final p = Prompter.I;
    final pad = MediaQuery.paddingOf(context);
    Widget stepper(
      String name,
      String label,
      String less,
      String more,
      String hint,
      String moreKey,
      String lessKey,
    ) => KeyAction(
      hint: hint,
      show: wide,
      child: KeyedSubtree(
        key: TourTargets.key('$name-stepper'),
        child: Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            color: c.surfaceStrong,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: c.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _StepButton(
                icon: 'minus',
                label: '$less ($lessKey)',
                onTap: () => p.nudge(name, -1),
              ),
              Semantics(
                button: true,
                label:
                    '$label ${formatSetting(name, p.get(name))}, opens settings',
                excludeSemantics: true,
                child: InkWell(
                  mouseCursor: WidgetStateMouseCursor.clickable,
                  borderRadius: BorderRadius.circular(8),
                  onTap: () => openSettingsSheet(context),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minWidth: 74),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 6,
                      ),
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: '$label ',
                              style: TextStyle(color: c.ink),
                            ),
                            TextSpan(
                              text: formatSetting(name, p.get(name)),
                              style: TextStyle(color: c.muted),
                            ),
                          ],
                        ),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                  ),
                ),
              ),
              _StepButton(
                icon: 'plus',
                label: '$more ($moreKey)',
                onTap: () => p.nudge(name, 1),
              ),
            ],
          ),
        ),
      ),
    );

    final controls = <Widget>[
      KeyAction(
        hint: 'Space',
        show: wide,
        child: KeyedSubtree(
          key: TourTargets.key('play'),
          child: Tooltip(
            excludeFromSemantics: true,
            message: p.playing ? 'Pause (Space)' : 'Play (Space)',
            child: Semantics(
              button: true,
              label: p.playing ? 'Pause (Space)' : 'Play (Space)',
              excludeSemantics: true,
              child: Material(
                color: c.brandFill,
                shape: CircleBorder(side: BorderSide(color: c.border)),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  mouseCursor: WidgetStateMouseCursor.clickable,
                  onTap: p.togglePlay,
                  child: SizedBox(
                    width: 52,
                    height: 52,
                    child: Center(
                      child: AppIcon(
                        p.playing ? 'pause' : 'play',
                        size: 22,
                        color: c.onBrand,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      KeyAction(
        hint: 'Esc',
        show: wide,
        child: IconBtn(
          icon: 'reset',
          label: 'Reset to the top (Esc)',
          onPressed: p.reset,
        ),
      ),
      stepper(
        'fontSize',
        'Font',
        'Smaller font',
        'Larger font',
        '↑ ↓',
        'Up arrow',
        'Down arrow',
      ),
      stepper(
        'speed',
        'Speed',
        'Slower',
        'Faster',
        '← →',
        'Right arrow',
        'Left arrow',
      ),
    ];
    final clock = p.flag('timer') ? _Clock(colour: c) : null;
    return SizedBox(
      width: double.infinity,
      child: GlassPanel(
        radius: 0,
        border: Border(top: BorderSide(color: c.border)),
        padding: EdgeInsets.fromLTRB(
          14 + pad.left,
          10,
          14 + pad.right,
          10 + pad.bottom,
        ),
        child: LayoutBuilder(
          builder: (context, box) {
            // One row, the clock at the far end, where it fits; wrapped onto two on a phone.
            if (box.maxWidth >= 620) {
              return Row(
                children: [
                  for (final w in controls)
                    Padding(
                      padding: const EdgeInsets.only(right: 10),
                      child: w,
                    ),
                  const Spacer(),
                  ?clock,
                ],
              );
            }
            return Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 10,
              runSpacing: 8,
              children: [...controls, ?clock],
            );
          },
        ),
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final String icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    return Tooltip(
      excludeFromSemantics: true,
      message: label,
      child: Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: InkWell(
          mouseCursor: WidgetStateMouseCursor.clickable,
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 32,
            height: 32,
            child: Center(child: AppIcon(icon, size: 15, color: c.muted)),
          ),
        ),
      ),
    );
  }
}

/// The elapsed time, redrawn twenty times a second while it runs.
class _Clock extends StatefulWidget {
  const _Clock({required this.colour});
  final UwuColors colour;

  @override
  State<_Clock> createState() => _ClockState();
}

class _ClockState extends State<_Clock> {
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(stateInterval, (_) {
      if (Prompter.I.playing && mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.colour;
    return Semantics(
      label: 'Elapsed time ${formatElapsed(Prompter.I.elapsedMs)}',
      excludeSemantics: true,
      child: Container(
        key: TourTargets.key('timer'),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: c.surfaceStrong,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: c.border),
        ),
        child: Text(
          formatElapsed(Prompter.I.elapsedMs),
          style: TextStyle(
            color: c.ink,
            fontSize: 15,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ),
    );
  }
}

/// The side tray: settings, the display toggles, fullscreen, the app's own actions, and theme.
class _SideTray extends StatelessWidget {
  const _SideTray({required this.glassBtn, required this.edge});
  final double glassBtn;
  final double edge;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final trays = Trays.I;
    final p = Prompter.I;
    final open = trays.side;
    final label = open ? 'Hide menu' : 'Show menu';
    // The tab points the way the tray will go.
    final towardsEdge = trays.left ? 'chevron-left' : 'chevron-right';
    final awayFromEdge = trays.left ? 'chevron-right' : 'chevron-left';
    final tab = KeyedSubtree(
      key: TourTargets.key('side-tab'),
      child: Tooltip(
        excludeFromSemantics: true,
        message: label,
        child: Semantics(
          button: true,
          expanded: open,
          label: label,
          excludeSemantics: true,
          child: Material(
            color: c.surfaceStrong,
            shape: RoundedRectangleBorder(
              borderRadius: open
                  ? BorderRadius.circular(12)
                  : (trays.left
                        ? const BorderRadius.horizontal(
                            right: Radius.circular(12),
                          )
                        : const BorderRadius.horizontal(
                            left: Radius.circular(12),
                          )),
              side: BorderSide(color: c.border),
            ),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              mouseCursor: WidgetStateMouseCursor.clickable,
              onTap: () => trays.toggle('side'),
              child: SizedBox(
                width: 24,
                height: glassBtn,
                child: Center(
                  child: AppIcon(
                    open ? towardsEdge : awayFromEdge,
                    size: 16,
                    color: c.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    Widget btn(
      String id,
      String icon,
      String label,
      VoidCallback onTap, {
      bool? active,
    }) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: KeyedSubtree(
        key: TourTargets.key(id),
        child: GlassButton(
          icon: icon,
          label: label,
          onPressed: onTap,
          active: active,
          size: glassBtn,
          longPressLabel: true,
        ),
      ),
    );
    Widget rule() => Container(
      width: 24,
      height: 1,
      margin: const EdgeInsets.symmetric(vertical: 4),
      color: c.ink.withValues(alpha: 0.25),
    );
    final extras = appTrayButtons(context);
    final column = KeyedSubtree(
      key: TourTargets.key('side-buttons'),
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            btn(
              'settings-btn',
              'settings',
              'Prompter settings (Ctrl+P)',
              () => openSettingsSheet(context),
            ),
            rule(),
            btn(
              'flipx-btn',
              'flipX',
              'Mirror across',
              () => p.toggle('flipX'),
              active: p.flag('flipX'),
            ),
            btn(
              'flipy-btn',
              'flipY',
              'Mirror down',
              () => p.toggle('flipY'),
              active: p.flag('flipY'),
            ),
            btn(
              'focus-btn',
              'focus',
              'Focus line',
              () => p.toggle('focusLine'),
              active: p.flag('focusLine'),
            ),
            ValueListenableBuilder<bool>(
              valueListenable: Fullscreen.on,
              builder: (context, full, _) => btn(
                'fullscreen-btn',
                full ? 'exitFullscreen' : 'fullscreen',
                full ? 'Exit fullscreen (F)' : 'Fullscreen (F)',
                Fullscreen.toggle,
              ),
            ),
            rule(),
            for (final e in extras)
              btn(e.id, e.icon, e.label, e.onTap, active: e.active),
            btn('bug-btn', 'bug', 'Report a bug', () => openBugReport(context)),
            btn(
              'theme-btn',
              ThemeController.I.mode == 'dark' ? 'moon' : 'sun',
              'Theme (Alt+T)',
              () => openThemeSheet(context),
            ),
          ],
        ),
      ),
    );
    return Center(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: trays.left
            ? [
                SizedBox(width: edge - 6),
                Flexible(child: column),
                const SizedBox(width: 8),
                tab,
              ]
            : [
                tab,
                const SizedBox(width: 8),
                Flexible(child: column),
                SizedBox(width: edge - 6),
              ],
      ),
    );
  }
}

/// The prompter's keyboard (app.js's wireKeyboard), at the app's root so it reaches past an
/// open window to toggle it shut. Never steals a key from a text field.
KeyEventResult prompterKey(BuildContext context, KeyEvent e) {
  if (e is! KeyDownEvent && e is! KeyRepeatEvent) return KeyEventResult.ignored;
  final focus = FocusManager.instance.primaryFocus?.context;
  if (focus != null &&
      (focus.widget is EditableText ||
          focus.findAncestorWidgetOfExactType<EditableText>() != null)) {
    return KeyEventResult.ignored;
  }
  final k = HardwareKeyboard.instance;
  final key = e.logicalKey;
  // Below the navigator, where windows open from.
  final ctx = AppNav.context ?? context;
  final s = Session.I;
  final p = Prompter.I;
  final ctrl = k.isControlPressed || k.isMetaPressed;
  if (ctrl || k.isAltPressed) {
    if (e is KeyRepeatEvent) return KeyEventResult.handled;
    if (ctrl && !k.isAltPressed && key == LogicalKeyboardKey.keyE) {
      s.editorOpen ? s.closeEditor() : s.openEditor();
    } else if (ctrl && !k.isAltPressed && key == LogicalKeyboardKey.keyP) {
      toggleSheet(ctx, 'settings', () => openSettingsSheet(ctx));
    } else if (k.isAltPressed && !ctrl && key == LogicalKeyboardKey.keyR) {
      toggleSheet(ctx, 'remote-panel', () => openRemotePanel(ctx));
    } else if (k.isAltPressed && !ctrl && key == LogicalKeyboardKey.keyT) {
      toggleSheet(ctx, 'theme', () => openThemeSheet(ctx));
    } else {
      return KeyEventResult.ignored;
    }
    PrompterChrome.wake();
    return KeyEventResult.handled;
  }
  final coarse = k.isShiftPressed;
  if (key == LogicalKeyboardKey.space ||
      key == LogicalKeyboardKey.keyB ||
      key == LogicalKeyboardKey.period) {
    if (e is KeyRepeatEvent) return KeyEventResult.handled;
    p.togglePlay();
  } else if (key == LogicalKeyboardKey.arrowUp) {
    p.nudge('fontSize', 1, coarse: coarse);
  } else if (key == LogicalKeyboardKey.arrowDown) {
    p.nudge('fontSize', -1, coarse: coarse);
  } else if (key == LogicalKeyboardKey.arrowRight ||
      key == LogicalKeyboardKey.pageDown) {
    p.nudge('speed', 1, coarse: coarse);
  } else if (key == LogicalKeyboardKey.arrowLeft ||
      key == LogicalKeyboardKey.pageUp) {
    p.nudge('speed', -1, coarse: coarse);
  } else if (key == LogicalKeyboardKey.escape) {
    // Whatever is open, or the scroll position when nothing is (app.js's Escape).
    if (AppSheet.anyOpen) {
      AppSheet.closeId(AppSheet.open.value.last);
    } else if (Fullscreen.on.value && Env.desktop) {
      Fullscreen.toggle();
    } else {
      p.reset();
    }
  } else if (key == LogicalKeyboardKey.keyF) {
    if (e is KeyRepeatEvent) return KeyEventResult.handled;
    Fullscreen.toggle();
  } else {
    return KeyEventResult.ignored;
  }
  PrompterChrome.wake();
  return KeyEventResult.handled;
}

/// Volume keys and a clicker's button, as the Android app forwards them (Prompter settings).
void listenForClicker() {
  Native.on('Cue', 'key', (_) {
    Prompter.I.togglePlay();
    PrompterChrome.wake();
  });
}

/// Android's Updates page from the side tray's Check for updates.
Future<void> checkForUpdates() => openUpdates();
