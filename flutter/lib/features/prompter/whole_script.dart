// The open script drawn whole, not just what's on screen: every line, top to bottom, at the
// prompter's font, width and colours. Drawn in a pipeline of its own, never on screen, then
// captured: for the desktop's Long screenshot (lib/desktop/screenshot.dart) and a bug report's
// Screenshot a page (lib/features/bug/bug_report.dart).
//
// Its own pipeline rather than off to the side of the window: a widget placed outside the window
// isn't painted on every platform (the browser build draws it blank), while a tree of its own
// paints the same everywhere.
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'prompter.dart';
import 'prompter_screen.dart';
import 'session.dart';

/// `context` is any under the app's theme. At most `maxHeight` pixels tall and `maxSide` along
/// its longer side, its resolution lowered to fit; null if it couldn't be drawn.
Future<ui.Image?> drawWholeScript(
  BuildContext context, {
  double maxHeight = 16384,
  double maxSide = 16384,
}) async {
  final p = Prompter.I;
  final media = MediaQuery.of(context);
  final width = p.viewWidth > 0 ? p.viewWidth : media.size.width;
  final theme = Theme.of(context);
  final colours = stageColours(context);
  final side = width * p.margin.toDouble() / 100;
  final style = TextStyle(
    fontSize: p.fontSize.toDouble(),
    height: p.lineHeight.toDouble(),
    color: colours.ink,
    fontFamily: theme.textTheme.bodyLarge?.fontFamily,
  );
  final body = '${Session.I.script['body']}';
  // How tall the whole script is at this width.
  final painter = TextPainter(
    text: TextSpan(text: body, style: style),
    textAlign: TextAlign.center,
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: math.max(1, width - 2 * side));
  final height = math.min(maxHeight, painter.height + 80);
  painter.dispose();
  Widget text = Text(body, textAlign: TextAlign.center, style: style);
  final flipX = p.flag('flipX'), flipY = p.flag('flipY');
  if (flipX || flipY)
    text = Transform.flip(flipX: flipX, flipY: flipY, child: text);
  final picture = MediaQuery(
    data: media.copyWith(size: Size(width, height)),
    child: Theme(
      data: theme,
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Container(
          width: width,
          height: height,
          color: colours.bg,
          padding: EdgeInsets.fromLTRB(side, 40, side, 40),
          alignment: Alignment.topCenter,
          child: OverflowBox(
            alignment: Alignment.topCenter,
            maxHeight: double.infinity,
            child: text,
          ),
        ),
      ),
    ),
  );
  final longest = math.max(width, height);
  final ratio = math.min(
    media.devicePixelRatio,
    math.min(maxHeight / math.max(height, 1), maxSide / math.max(longest, 1)),
  );
  // A picture too big for the device's graphics fails to be read back: drawn again at half the
  // resolution, till it fits.
  for (var r = ratio; r >= 0.25 && context.mounted; r /= 2) {
    final shot = await captureWidget(context, picture, Size(width, height), r);
    if (shot != null) return shot;
  }
  return null;
}

/// A widget drawn at `size` in a pipeline of its own, as a picture.
Future<ui.Image?> captureWidget(
  BuildContext context,
  Widget widget,
  Size size,
  double pixelRatio,
) async {
  final view = View.of(context);
  final boundary = RenderRepaintBoundary();
  final renderView = RenderView(
    view: view,
    child: RenderPositionedBox(alignment: Alignment.topLeft, child: boundary),
    configuration: ViewConfiguration(
      logicalConstraints: BoxConstraints.tight(size),
      physicalConstraints: BoxConstraints.tight(size * pixelRatio),
      devicePixelRatio: pixelRatio,
    ),
  );
  final pipeline = PipelineOwner()..rootNode = renderView;
  renderView.prepareInitialFrame();
  final build = BuildOwner(focusManager: FocusManager());
  try {
    final root = RenderObjectToWidgetAdapter<RenderBox>(
      container: boundary,
      child: widget,
    ).attachToRenderTree(build);
    build.buildScope(root);
    build.finalizeTree();
    pipeline.flushLayout();
    pipeline.flushCompositingBits();
    pipeline.flushPaint();
    return await boundary.toImage(pixelRatio: pixelRatio);
  } catch (_) {
    return null;
  } finally {
    build.finalizeTree();
  }
}
