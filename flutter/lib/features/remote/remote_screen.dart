// The remote page (main-site/remote.html): enter the id shown on a prompter (the site's or an
// app's) and drive it: play and pause, the font and the speed in fine and coarse steps, reset, a
// scrubber, a scaled copy of the prompter's screen, and editing its script. While the prompter's
// own editor is open this page is covered, so two people never type into one script.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/pages.dart';
import '../../data/prompter_logic.dart';
import '../../remote/codes.dart';
import '../../remote/nearby.dart';
import '../../theme/icons.dart';
import '../../theme/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/sheet.dart';
import '../prompter/prompter_screen.dart';
import '../theme/theme_sheet.dart';
import '../tour/tour.dart';
import 'remote_session.dart';

class RemoteScreen extends StatefulWidget {
  const RemoteScreen({super.key});

  @override
  State<RemoteScreen> createState() => _RemoteScreenState();
}

class _RemoteScreenState extends State<RemoteScreen> {
  bool _wasLive = false;
  double _scrub = 0;
  bool _scrubbing = false;

  @override
  void initState() {
    super.initState();
    RemoteSession.I.addListener(_changed);
    RemoteSession.I.watchMirror(true);
  }

  @override
  void dispose() {
    RemoteSession.I.removeListener(_changed);
    RemoteSession.I.watchMirror(false);
    super.dispose();
  }

  void _changed() {
    final live = RemoteSession.I.live;
    // On the edge into a live connection, anything over the controls is put away: they came for
    // the prompter.
    if (live && !_wasLive) AppSheet.closeAll();
    _wasLive = live;
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([RemoteSession.I, ThemeController.I]),
      builder: (context, _) {
        final c = UwuColors.of(context);
        final r = RemoteSession.I;
        final pad = MediaQuery.paddingOf(context);
        return Stack(
          children: [
            Column(
              children: [
                GlassPanel(
                  radius: 0,
                  border: Border(bottom: BorderSide(color: c.border)),
                  padding: EdgeInsets.fromLTRB(
                    14 + pad.left,
                    10 + pad.top,
                    14 + pad.right,
                    10,
                  ),
                  child: Row(
                    children: [
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
                      Semantics(
                        header: true,
                        child: Text(
                          'Remote',
                          style: TextStyle(color: c.brandInk, fontSize: 16),
                        ),
                      ),
                      const Spacer(),
                      KeyedSubtree(
                        key: TourTargets.key('remote-home'),
                        child: IconBtn(
                          icon: 'scripts',
                          label: 'Open the prompter',
                          onPressed: () => AppPages.open(AppPages.prompter),
                        ),
                      ),
                      const SizedBox(width: 6),
                      IconBtn(
                        icon: ThemeController.I.mode == 'dark' ? 'moon' : 'sun',
                        label: 'Theme',
                        onPressed: () => openThemeSheet(context),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(
                      16 + pad.left,
                      16,
                      16 + pad.right,
                      16 + pad.bottom,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 560),
                        child: r.live
                            ? _controls(context, c, r)
                            : _connectForm(context, c, r),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            if (r.locked) const Positioned.fill(child: _EditingLock()),
          ],
        );
      },
    );
  }

  Widget _connectForm(BuildContext context, UwuColors c, RemoteSession r) {
    final nearby = nearbyAvailable();
    return GlassPanel(
      key: TourTargets.key('connect-form'),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const NoteBanner(
            'This device must be on the same network as the prompter. Share a mobile hotspot from one to the other if there is no shared wifi.',
          ),
          const FieldLabel('Enter the remote ID shown on the prompter'),
          Named(
            'Remote ID',
            child: TextField(
              key: TourTargets.key('code-input'),
              controller: r.codeField,
              textAlign: TextAlign.center,
              maxLength: codeLength,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.characters,
              style: TextStyle(fontSize: 30, letterSpacing: 10, color: c.ink),
              inputFormatters: [
                TextInputFormatter.withFunction((old, value) {
                  final n = normaliseCode(value.text);
                  return TextEditingValue(
                    text: n,
                    selection: TextSelection.collapsed(offset: n.length),
                  );
                }),
              ],
              onSubmitted: (v) => r.connect(normaliseCode(v)),
              decoration: const InputDecoration(
                hintText: 'ABC123',
                counterText: '',
                labelText: 'Remote ID',
                floatingLabelBehavior: FloatingLabelBehavior.never,
              ),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            key: TourTargets.key('connect-btn'),
            onPressed: () => r.connect(normaliseCode(r.codeField.text)),
            child: Text(r.connectLabel),
          ),
          if (nearby) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () =>
                  r.connect(normaliseCode(r.codeField.text), nearby: true),
              icon: AppIcon('nearby', size: 16, color: c.ink),
              label: const Text('Connect nearby, without wifi'),
            ),
            const Note(
              'For when there is no wifi: the prompter phone needs the app too, with Let a nearby phone connect turned on in its remote panel.',
            ),
          ],
          if (r.connectNote != null) Note(r.connectNote!),
          const SizedBox(height: 12),
          StatusLine(
            light: switch (r.status) {
              'connected' => 'ok',
              'dropped' || 'waiting' => 'warn',
              'unreachable' || 'error' => 'error',
              _ => '',
            },
            text: r.statusText,
          ),
        ],
      ),
    );
  }

  Widget _controls(BuildContext context, UwuColors c, RemoteSession r) {
    final s = r.lastState ?? const {};
    final font = s['fontSize'] is num ? s['fontSize'] as num : 60;
    final speed = s['speed'] is num ? s['speed'] as num : 12;
    final progress = s['progress'] is num
        ? (s['progress'] as num).toDouble().clamp(0, 100).toDouble()
        : 0.0;
    if (!_scrubbing) _scrub = progress;
    Widget nudge(
      String setting,
      int dir, {
      bool coarse = false,
      required String label,
      required String icon,
      String? text,
    }) => Expanded(
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: Tooltip(
          excludeFromSemantics: true,
          message: label,
          child: Semantics(
            button: true,
            label: label,
            excludeSemantics: true,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: () => r.command(
                'nudge',
                setting: setting,
                value: dir,
                coarse: coarse,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  AppIcon(icon, size: 16, color: c.ink),
                  if (text != null) ...[const SizedBox(width: 4), Text(text)],
                ],
              ),
            ),
          ),
        ),
      ),
    );
    return GlassPanel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StatusLine(light: 'ok', text: r.scriptName),
          const SizedBox(height: 10),
          Center(
            child: Semantics(
              label: 'Elapsed time ${r.clock}',
              excludeSemantics: true,
              child: Text(
                r.clock,
                style: TextStyle(
                  fontSize: 28,
                  color: c.ink,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            key: TourTargets.key('remote-play'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
            onPressed: () => r.command('toggle'),
            icon: AppIcon(
              r.playing ? 'pause' : 'play',
              size: 18,
              color: c.onBrand,
            ),
            label: Text(r.playing ? 'Pause' : 'Play'),
          ),
          const SizedBox(height: 6),
          // The outer pair is the big step, what Shift adds to the arrow keys on the prompter.
          Row(
            key: TourTargets.key('remote-font'),
            children: [
              nudge(
                'fontSize',
                -1,
                coarse: true,
                label: 'Font smaller by 4',
                icon: 'chevronsLeft',
              ),
              nudge(
                'fontSize',
                -1,
                label: 'Font smaller',
                icon: 'minus',
                text: 'Font',
              ),
              nudge(
                'fontSize',
                1,
                label: 'Font larger',
                icon: 'plus',
                text: 'Font',
              ),
              nudge(
                'fontSize',
                1,
                coarse: true,
                label: 'Font larger by 4',
                icon: 'chevronsRight',
              ),
            ],
          ),
          Row(
            key: TourTargets.key('remote-speed'),
            children: [
              nudge(
                'speed',
                -1,
                coarse: true,
                label: 'Speed down by 1',
                icon: 'chevronsLeft',
              ),
              nudge('speed', -1, label: 'Slower', icon: 'minus', text: 'Speed'),
              nudge('speed', 1, label: 'Faster', icon: 'plus', text: 'Speed'),
              nudge(
                'speed',
                1,
                coarse: true,
                label: 'Speed up by 1',
                icon: 'chevronsRight',
              ),
            ],
          ),
          const SizedBox(height: 6),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: () => r.command('reset'),
            icon: AppIcon('reset', size: 16, color: c.ink),
            label: const Text('Reset to the top'),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Font ${font.round()}', style: TextStyle(color: c.ink)),
              Text(
                'Speed ${speed.toDouble().toStringAsFixed(1)}',
                style: TextStyle(color: c.ink),
              ),
            ],
          ),
          const FieldLabel('Position'),
          Slider(
            key: TourTargets.key('remote-scrub'),
            value: _scrub,
            min: 0,
            max: 100,
            semanticFormatterCallback: (v) => 'Position ${v.round()}%',
            onChangeStart: (_) => _scrubbing = true,
            onChangeEnd: (_) => _scrubbing = false,
            onChanged: (v) {
              setState(() => _scrub = v);
              r.command('seek', value: double.parse(v.toStringAsFixed(1)));
            },
          ),
          if (!r.editing || r.refused != null) ...[
            Row(
              children: [
                const Expanded(child: FieldLabel('On the prompter now')),
                OutlinedButton.icon(
                  key: TourTargets.key('remote-edit'),
                  onPressed: r.editing ? null : r.openEditor,
                  icon: AppIcon('edit', size: 16, color: c.ink),
                  label: const Text('Edit'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            KeyedSubtree(
              key: TourTargets.key('remote-mirror'),
              child: const Mirror(),
            ),
          ],
          if (r.editing) ...[
            const SizedBox(height: 12),
            if (r.refused != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: NoteBanner(r.refused!, error: true),
              ),
            if (r.stale)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: NoteBanner(
                  'The script changed on the prompter while you were typing. Sending will replace what it says now.',
                ),
              ),
            Named(
              'Script name',
              child: TextField(
                controller: r.nameField,
                decoration: const InputDecoration(
                  hintText: 'Script name',
                  labelText: 'Script name',
                  floatingLabelBehavior: FloatingLabelBehavior.never,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Named(
              'Script text',
              child: TextField(
                controller: r.bodyField,
                minLines: 6,
                maxLines: 14,
                keyboardType: TextInputType.multiline,
                decoration: const InputDecoration(
                  hintText: 'Type the script here.',
                  labelText: 'Script text',
                  floatingLabelBehavior: FloatingLabelBehavior.never,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: r.cancelEdit,
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: r.sendEdit,
                    icon: AppIcon('check', size: 16, color: c.onBrand),
                    label: const Text('Send'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              onPressed: r.reloadEdit,
              icon: AppIcon('reset', size: 16, color: c.ink),
              label: const Text('Reload from the prompter'),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            key: TourTargets.key('remote-disconnect'),
            style: FilledButton.styleFrom(
              backgroundColor: c.errorFill,
              foregroundColor: c.error,
            ),
            onPressed: r.disconnect,
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
  }
}

/// A scaled copy of the prompter's screen: its text, colours, focus arrows and clock, scrolled to
/// where it is. Laid out at the prompter's own size and settings and then scaled down whole, so it
/// wraps on the same words; scaling only the font would break every line somewhere else.
class Mirror extends StatelessWidget {
  const Mirror({super.key});

  // Const where it's placed, so a rebuild above passes it by: it listens for each state itself.
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: RemoteSession.I,
    builder: (context, _) => _build(context),
  );

  Widget _build(BuildContext context) {
    final r = RemoteSession.I;
    final s = r.lastState;
    final view = s?['view'];
    return LayoutBuilder(
      builder: (context, box) {
        if (s == null ||
            view is! Map ||
            (view['width'] as num? ?? 0) <= 0 ||
            (view['height'] as num? ?? 0) <= 0) {
          return const SizedBox(height: 120);
        }
        final w = (view['width'] as num).toDouble();
        final h = (view['height'] as num).toDouble();
        // At most this much of the page's height, so a portrait prompter doesn't push the
        // controls off a phone.
        final scale = [
          box.maxWidth / w,
          MediaQuery.sizeOf(context).height * 0.45 / h,
        ].reduce((a, b) => a < b ? a : b);
        final look = s['look'] is Map ? s['look'] as Map : const {};
        final brandHex =
            int.tryParse(
              '${look['brand'] ?? '#ccffcc'}'.replaceFirst('#', ''),
              radix: 16,
            ) ??
            0xccffcc;
        final colours = stageColours(
          context,
          mode: look['mode'] == 'dark' ? 'dark' : 'light',
          brand: Color(0xFF000000 | brandHex),
        );
        final fontSize = (s['fontSize'] as num? ?? 60).toDouble();
        final lineHeight = (s['lineHeight'] as num? ?? 1.4).toDouble();
        final margin = (s['margin'] as num? ?? 8).toDouble();
        final focus = (s['focusPosition'] as num? ?? 40).toDouble();
        final flipX = s['flipX'] == true, flipY = s['flipY'] == true;
        Widget text = Padding(
          padding: EdgeInsets.fromLTRB(
            w * margin / 100,
            (view['padTop'] as num? ?? 0).toDouble(),
            w * margin / 100,
            (view['padBottom'] as num? ?? 0).toDouble(),
          ),
          child: Text(
            r.scriptBody,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: fontSize,
              height: lineHeight,
              color: colours.ink,
              fontFamily: Theme.of(context).textTheme.bodyLarge?.fontFamily,
            ),
          ),
        );
        if (flipX || flipY)
          text = Transform.flip(flipX: flipX, flipY: flipY, child: text);
        final arrowW = (16 * scale).clamp(6, 16).toDouble();
        final arrowH = (24 * scale).clamp(10, 24).toDouble();
        return Semantics(
          label: 'A copy of the prompter’s screen',
          excludeSemantics: true,
          child: Center(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                width: w * scale,
                height: h * scale,
                child: Stack(
                  children: [
                    Positioned.fill(child: ColoredBox(color: colours.bg)),
                    Positioned(
                      left: 0,
                      top: 0,
                      child: Transform.scale(
                        scale: scale,
                        alignment: Alignment.topLeft,
                        child: SizedBox(
                          width: w,
                          height: h,
                          child: ClipRect(
                            child: OverflowBox(
                              alignment: Alignment.topLeft,
                              minHeight: 0,
                              maxHeight: double.infinity,
                              child: Transform.translate(
                                offset: Offset(0, -r.mirrorScrollTop),
                                child: SizedBox(width: w, child: text),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (s['focusLine'] == true) ...[
                      Positioned(
                        left: 0,
                        top: h * scale * focus / 100 - arrowH / 2,
                        child: _MiniArrow(
                          w: arrowW,
                          h: arrowH,
                          colour: colours.ink,
                          right: true,
                        ),
                      ),
                      Positioned(
                        right: 0,
                        top: h * scale * focus / 100 - arrowH / 2,
                        child: _MiniArrow(
                          w: arrowW,
                          h: arrowH,
                          colour: colours.ink,
                          right: false,
                        ),
                      ),
                    ],
                    if (s['timer'] == true)
                      Positioned(
                        right: 8,
                        bottom: 6,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.25),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            formatElapsed(r.elapsed),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _MiniArrow extends StatelessWidget {
  const _MiniArrow({
    required this.w,
    required this.h,
    required this.colour,
    required this.right,
  });
  final double w;
  final double h;
  final Color colour;
  final bool right;

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: 0.55,
    child: CustomPaint(size: Size(w, h), painter: _Tri(colour, right)),
  );
}

class _Tri extends CustomPainter {
  _Tri(this.colour, this.right);
  final Color colour;
  final bool right;

  @override
  void paint(Canvas canvas, Size size) {
    final p = right
        ? (Path()
            ..moveTo(0, 0)
            ..lineTo(size.width, size.height / 2)
            ..lineTo(0, size.height))
        : (Path()
            ..moveTo(size.width, 0)
            ..lineTo(0, size.height / 2)
            ..lineTo(size.width, size.height));
    canvas.drawPath(p..close(), Paint()..color = colour);
  }

  @override
  bool shouldRepaint(_Tri old) => old.colour != colour || old.right != right;
}

/// Covers the page while the script is open in the prompter's editor. Not dismissible: the
/// condition it describes isn't one this end can clear.
class _EditingLock extends StatelessWidget {
  const _EditingLock();

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    return Container(
      color: c.scrim,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: Semantics(
        liveRegion: true,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: GlassPanel(
            strong: true,
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AppIcon('edit', size: 28, color: c.ink),
                const SizedBox(height: 10),
                Text(
                  'Being edited on the prompter',
                  style: TextStyle(color: c.ink, fontSize: 18),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 6),
                Text(
                  'The script is open in the editor over there. This will unlock by itself when they are done.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: c.muted, fontSize: 13.5),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
