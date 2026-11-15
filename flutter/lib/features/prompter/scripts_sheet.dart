// The scripts menu (the site's #scriptsModal): every script with its word count and first line,
// the open one marked, a bin for each, and New script, which opens the editor on it.
import 'package:flutter/material.dart';

import '../../app/nav.dart';
import '../../data/scripts.dart';
import '../../theme/icons.dart';
import '../../theme/theme.dart';
import '../../widgets/sheet.dart';
import 'session.dart';

/// Set by the desktop layer: a script's right-click menu (pin it as a widget, follow it in the
/// tray), shown on a long press or right click.
void Function(BuildContext context, Offset at, Json script)? desktopScriptMenu;

Future<void> openScriptsSheet(BuildContext context) => AppSheet.show(
  context,
  id: 'scripts',
  width: 460,
  kind: SheetKind.drawer,
  builder: (context) => const ScriptsSheet(),
);

class ScriptsSheet extends StatelessWidget {
  const ScriptsSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Scripts.I,
      builder: (context, _) {
        final c = UwuColors.of(context);
        final scripts = Scripts.I.all;
        final active = Scripts.I.activeId;
        return SheetFrame(
          title: 'Scripts',
          footer: [
            const SizedBox.shrink(),
            FilledButton.icon(
              onPressed: () {
                AppSheet.close(context);
                Session.I.newScript();
              },
              icon: AppIcon('plus', size: 16, color: c.onBrand),
              label: const Text('New script'),
            ),
          ],
          children: [
            for (final s in scripts)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: ScriptRow(script: s, active: s['id'] == active),
              ),
          ],
        );
      },
    );
  }
}

class ScriptRow extends StatelessWidget {
  const ScriptRow({
    super.key,
    required this.script,
    required this.active,
    this.closeOnPick = true,
  });
  final Json script;
  final bool active;
  final bool closeOnPick;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final body = '${script['body']}';
    final words = Scripts.wordCount(body);
    final preview = Scripts.preview(body);
    final name = '${script['name']}';
    final meta =
        '$words words, ${preview.length > 40 ? preview.substring(0, 40) : preview}';
    return GestureDetector(
      onSecondaryTapUp: desktopScriptMenu == null
          ? null
          : (d) => desktopScriptMenu!(context, d.globalPosition, script),
      child: Material(
        color: active ? c.brandFill : c.surfaceStrong,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: c.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            Expanded(
              child: Semantics(
                button: true,
                selected: active,
                label: '$name, $meta',
                excludeSemantics: true,
                child: InkWell(
                  mouseCursor: WidgetStateMouseCursor.clickable,
                  onTap: () {
                    if (closeOnPick) AppSheet.close(context);
                    Session.I.switchTo('${script['id']}');
                  },
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: active ? c.onBrand : c.ink,
                            fontSize: 15,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          meta,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: active ? c.onBrand : c.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: 'Delete $name',
              onPressed: () async {
                // Not undoable, so it asks: everything else here is recoverable by retyping.
                if (await AppNav.confirm(
                  'Delete "$name"? This cannot be undone.',
                ))
                  Session.I.deleteScript('${script['id']}');
              },
              icon: AppIcon(
                'trash',
                size: 18,
                color: active ? c.onBrand : c.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
