// Remote control (the site's #remoteModal): the six-character id to type on the other device,
// its QR and link, what the remote is doing, and its controls. On Android with Google Play
// services, a second phone with the app can connect straight to this one with no network.
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../app/nav.dart';
import '../../app/pages.dart';
import '../../remote/codes.dart';
import '../../remote/nearby.dart';
import '../../theme/icons.dart';
import '../../theme/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/sheet.dart';
import '../tour/tour.dart';
import 'prompter_screen.dart';
import 'session.dart';

Future<void> openRemotePanel(BuildContext context) {
  final shown = AppSheet.show(
    context,
    id: 'remote-panel',
    width: 460,
    builder: (context) => const RemotePanel(),
  );
  Session.I.openedPanel();
  return shown;
}

class RemotePanel extends StatelessWidget {
  const RemotePanel({super.key});

  Future<void> _copy(String text, String said, String failed) async {
    try {
      await copyText(text);
      AppNav.toast(said);
    } catch (_) {
      AppNav.toast(failed);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Session.I,
      builder: (context, _) {
        final c = UwuColors.of(context);
        final s = Session.I;
        final code = s.hostCode;
        final running = s.running;
        return SheetFrame(
          title: 'Remote control',
          children: [
            const FieldLabel(
              'Enter this remote ID on the other device',
              top: 0,
            ),
            KeyedSubtree(
              key: TourTargets.key('remote-code'),
              child: Semantics(
                button: true,
                label: code == null
                    ? 'Remote ID, not running'
                    : 'Remote ID $code, tap to copy',
                excludeSemantics: true,
                child: Material(
                  color: c.brandFill,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: BorderSide(color: c.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: code == null
                        ? null
                        : () => _copy(
                            code,
                            'Remote ID copied',
                            'Could not copy. The ID is on screen to type.',
                          ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Text(
                        code ?? '------',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: c.onBrand,
                          fontSize: 38,
                          letterSpacing: 8,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (code != null) ...[
              const SizedBox(height: 14),
              Center(
                child: Container(
                  key: TourTargets.key('remote-qr'),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: QrImageView(
                    data: remoteUrl(code),
                    size: 168,
                    padding: EdgeInsets.zero,
                    semanticsLabel: 'QR code for the remote link',
                    eyeStyle: const QrEyeStyle(
                      eyeShape: QrEyeShape.square,
                      color: Color(0xFF121815),
                    ),
                    dataModuleStyle: const QrDataModuleStyle(
                      dataModuleShape: QrDataModuleShape.square,
                      color: Color(0xFF121815),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              SelectableText(
                remoteUrl(code),
                textAlign: TextAlign.center,
                style: TextStyle(color: c.muted, fontSize: 12.5),
              ),
            ],
            const SizedBox(height: 12),
            StatusLine(light: remoteLight(s.remoteStatus), text: s.statusText),
            const SizedBox(height: 12),
            ToggleGrid(
              children: [
                OutlinedButton.icon(
                  onPressed: running && code != null
                      ? () => _copy(
                          remoteUrl(code),
                          'Link copied',
                          'Could not copy. The link is on screen to type.',
                        )
                      : null,
                  icon: AppIcon(
                    'copy',
                    size: 16,
                    color: running ? c.ink : c.muted,
                  ),
                  label: const Text('Copy link'),
                ),
                OutlinedButton.icon(
                  onPressed: running ? s.regenerateCode : null,
                  icon: AppIcon(
                    'reset',
                    size: 16,
                    color: running ? c.ink : c.muted,
                  ),
                  label: const Text('New ID'),
                ),
                if (running)
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: c.errorFill,
                      foregroundColor: c.error,
                    ),
                    onPressed: () {
                      s.stoppedByHand = true;
                      s.stopRemote();
                    },
                    child: const Text('Stop'),
                  )
                else
                  FilledButton.icon(
                    onPressed: () {
                      s.stoppedByHand = false;
                      s.startRemote();
                    },
                    icon: AppIcon('remote', size: 16, color: c.onBrand),
                    label: const Text('Start'),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            const NoteBanner(
              'Both devices must be on the same network. Share a mobile hotspot from one to the other if there is no shared wifi.',
            ),
            const Note(
              'Pairing needs a connection. The prompter itself keeps working offline.',
            ),
            if (nearbyAvailable()) ...[
              const FieldLabel('No wifi? Connect phone to phone'),
              const Note(
                'With the uwuPromptr app on both phones, the remote can connect over Bluetooth and Wi-Fi Direct, with no router and no mobile data. '
                'On the other phone, open the remote, enter this ID and tap Connect nearby.',
                top: 0,
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: TourTargets.key('nearby-host'),
                onPressed: s.toggleNearby,
                icon: AppIcon('nearby', size: 16, color: c.ink),
                label: Text(s.nearbyLabel),
              ),
              if (s.nearbyText.isNotEmpty) Note(s.nearbyText),
            ],
            const FieldLabel('Using this device as the remote?'),
            OutlinedButton.icon(
              key: TourTargets.key('remote-open'),
              onPressed: () {
                AppSheet.close(context);
                AppPages.open(AppPages.remote);
              },
              icon: AppIcon('remote', size: 16, color: c.ink),
              label: const Text('Enter a remote ID instead'),
            ),
          ],
        );
      },
    );
  }
}
