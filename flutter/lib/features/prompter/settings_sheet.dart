// Prompter settings (the site's #settingsModal): the text's size, speed, line height, margin and
// focus line, each with its reset; the display toggles; which edge the side menu is on; the apps'
// own settings; Show me around; and the keyboard shortcuts.
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/env.dart';
import '../../data/scripts.dart';
import '../../native/bridge.dart';
import '../../theme/icons.dart';
import '../../theme/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/sheet.dart';
import '../tour/tour.dart';
import '../update/update_bar.dart';
import 'app_extras.dart';
import 'prompter.dart';
import 'trays.dart';

/// Set by the desktop layer: its own section (Shortcuts in other apps, New version alerts).
Widget Function(BuildContext context)? desktopSettingsSection;

Future<void> openSettingsSheet(BuildContext context) => AppSheet.show(
  context,
  id: 'settings',
  width: 500,
  kind: SheetKind.drawer,
  builder: (context) => const SettingsSheet(),
);

const _labels = {
  'fontSize': 'Font size',
  'speed': 'Speed',
  'lineHeight': 'Line height',
  'margin': 'Side margin',
  'focusPosition': 'Focus line position',
};

class SettingsSheet extends StatelessWidget {
  const SettingsSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        Prompter.I,
        Trays.I,
        AppExtras.I,
        AndroidUpdates.I,
      ]),
      builder: (context, _) {
        final p = Prompter.I;
        final x = AppExtras.I;
        final u = AndroidUpdates.I;
        final keys = Env.android && Native.has('keys');
        final alerts = Env.android && Native.has('push');
        return SheetFrame(
          title: 'Prompter',
          children: [
            const FieldLabel('Text', top: 0),
            for (final name in _labels.keys) _Slider(name: name),
            const FieldLabel('Display'),
            ToggleGrid(
              children: [
                ToggleChip(
                  icon: 'flipX',
                  label: 'Mirror across',
                  on: p.flag('flipX'),
                  onTap: () => p.toggle('flipX'),
                ),
                ToggleChip(
                  icon: 'flipY',
                  label: 'Mirror down',
                  on: p.flag('flipY'),
                  onTap: () => p.toggle('flipY'),
                ),
                ToggleChip(
                  icon: 'focus',
                  label: 'Focus line',
                  on: p.flag('focusLine'),
                  onTap: () => p.toggle('focusLine'),
                ),
                ToggleChip(
                  icon: 'clock',
                  label: 'Timer',
                  on: p.flag('timer'),
                  onTap: () => p.toggle('timer'),
                ),
              ],
            ),
            const FieldLabel('Layout'),
            _Segmented(
              label: 'Side menu',
              value: Trays.I.edge,
              options: const [('left', 'Left edge'), ('right', 'Right edge')],
              onPick: Trays.I.setEdge,
            ),
            if (keys || alerts) ...[
              const FieldLabel('Android app'),
              ToggleGrid(
                children: [
                  if (keys)
                    ToggleChip(
                      icon: 'remote',
                      label: 'Volume keys start and stop',
                      on: x.volumeKeys,
                      onTap: x.toggleVolumeKeys,
                    ),
                  if (alerts)
                    ToggleChip(
                      icon: 'bell',
                      label: 'New version alerts',
                      on: u.notices ?? false,
                      onTap: u.notices == null
                          ? null
                          : () => u.setNotices(!(u.notices ?? false)),
                    ),
                ],
              ),
              if (keys)
                const Note(
                  'Either volume key, a Bluetooth selfie shutter or a headset’s button starts and stops the script while the prompter is open.',
                ),
            ],
            if (desktopSettingsSection != null)
              desktopSettingsSection!(context),
            const FieldLabel('Show me around'),
            const TourPicks(),
            const Note(
              'Each page shows you around the first time you open it. Pick one to see its tour again.',
            ),
            const FieldLabel('Keyboard'),
            const ShortcutRow('Start and stop', ['Space']),
            const ShortcutRow('Font size', ['Up', 'Down']),
            const ShortcutRow('Speed', ['Left', 'Right']),
            const ShortcutRow('Bigger steps', ['Shift']),
            const ShortcutRow('Fullscreen', ['F']),
            const ShortcutRow('Reset to the top', ['Esc']),
            const FieldLabel('Panels'),
            const ShortcutRow('Edit script', ['Ctrl', 'E']),
            const ShortcutRow('Prompter settings', ['Ctrl', 'P']),
            const ShortcutRow('Remote control', ['Alt', 'R']),
            const ShortcutRow('Theme', ['Alt', 'T']),
            const ShortcutRow('Close the panel', ['Esc']),
            const FieldLabel('While editing'),
            const ShortcutRow('Save and close', ['Ctrl', 'S']),
            const ShortcutRow('Discard changes', ['Esc']),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => launchUrl(
                  Uri.parse('https://cue.uwuapps.org/privacy'),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('Privacy: your scripts stay on this device'),
              ),
            ),
            if (Env.version.isNotEmpty) Note('uwuPromptr ${Env.version}'),
          ],
        );
      },
    );
  }
}

/// One setting: its name and value, a slider, and a reset that names what it puts back.
class _Slider extends StatelessWidget {
  const _Slider({required this.name});
  final String name;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final p = Prompter.I;
    final r = settingRanges[name]!;
    final label = _labels[name]!;
    final value = p.get(name);
    final def = formatSetting(name, r.defaultValue);
    final divisions = ((r.max - r.min) / r.step).round();
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(text: '$label '),
                TextSpan(
                  text: formatSetting(name, value),
                  style: TextStyle(color: c.muted),
                ),
              ],
            ),
            style: TextStyle(color: c.ink, fontSize: 13.5),
          ),
          Row(
            children: [
              Expanded(
                child: Slider(
                  value: value.toDouble().clamp(r.min, r.max),
                  min: r.min,
                  max: r.max,
                  divisions: divisions,
                  label: formatSetting(name, value),
                  semanticFormatterCallback: (v) =>
                      '$label ${formatSetting(name, v)}',
                  onChanged: (v) => p.set(name, v),
                ),
              ),
              IconButton(
                tooltip: 'Reset ${label.toLowerCase()} to $def',
                onPressed: p.isDefault(name)
                    ? null
                    : () => p.resetSetting(name),
                icon: AppIcon(
                  'reset',
                  size: 16,
                  color: p.isDefault(name)
                      ? c.muted.withValues(alpha: 0.5)
                      : c.ink,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A row of choices, one pressed (the site's .mode-toggle).
class _Segmented extends StatelessWidget {
  const _Segmented({
    required this.label,
    required this.value,
    required this.options,
    required this.onPick,
  });
  final String label;
  final String value;
  final List<(String, String)> options;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    return Semantics(
      label: label,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: c.border),
        ),
        child: Row(
          children: [
            for (final o in options)
              Expanded(
                child: Semantics(
                  button: true,
                  selected: o.$1 == value,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(9),
                    onTap: () => onPick(o.$1),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: o.$1 == value ? c.brandFill : null,
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Text(
                        o.$2,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          color: o.$1 == value ? c.onBrand : c.ink,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
