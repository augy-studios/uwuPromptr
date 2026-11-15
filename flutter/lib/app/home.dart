// The app's one screen: the prompter and the remote, each kept (an IndexedStack), with the update
// bar above them on Android. On the desktop, from 1024 px wide, the scripts can slide in beside
// the prompter, picked from there rather than from a window.
import 'package:flutter/material.dart';

import '../data/scripts.dart';
import '../features/prompter/app_extras.dart';
import '../features/prompter/prompter.dart';
import '../features/prompter/prompter_screen.dart';
import '../features/prompter/scripts_sheet.dart';
import '../features/prompter/session.dart';
import '../features/remote/remote_screen.dart';
import '../features/remote/remote_session.dart';
import '../features/tour/tour.dart';
import '../features/update/update_bar.dart';
import '../remote/watch.dart';
import '../theme/icons.dart';
import '../theme/theme.dart';
import '../native/bridge.dart';
import 'env.dart';
import 'nav.dart';
import 'fullscreen.dart';
import 'pages.dart';

class Home extends StatefulWidget {
  const Home({super.key});

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  static final _pagesKey = GlobalKey(debugLabel: 'pages');

  @override
  void initState() {
    super.initState();
    AppPages.current.addListener(_pageChanged);
    _pageChanged();
    WidgetsBinding.instance.addPostFrameCallback((_) => Tour.init());
  }

  @override
  void dispose() {
    AppPages.current.removeListener(_pageChanged);
    super.dispose();
  }

  /// The watch, the app's screen settings and the tours follow the page on show.
  void _pageChanged() {
    final prompter = AppPages.active() == AppPages.prompter;
    AppExtras.I.applyForPage(prompter);
    if (prompter) {
      Watch.summary = () {
        final p = Prompter.I;
        return WatchSummary(
          live: true,
          role: 'prompter',
          playing: p.playing,
          speed: p.speed,
          elapsed: p.elapsedMs,
          progress: p.progress,
          name: '${Session.I.script['name']}',
        );
      };
      Watch.onCommand = Session.I.handleRemoteMessage;
    } else {
      Watch.summary = () {
        final r = RemoteSession.I;
        final s = r.lastState;
        return WatchSummary(
          live: r.live && s != null,
          role: 'remote',
          playing: r.live && r.playing,
          speed: s?['speed'] as num? ?? 0,
          elapsed: r.elapsed,
          progress: s?['progress'] as num? ?? 0,
          name: r.scriptName,
        );
      };
      Watch.onCommand = (c) {
        if (RemoteSession.I.live) RemoteSession.I.send(c);
      };
    }
    Watch.update();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final page = AppPages.active();
    final remote = page == AppPages.remote;
    // The page not on show takes no focus: it isn't laid out, so it has nowhere to be.
    final pages = IndexedStack(
      // The same pages wherever the shell puts them (beside the scripts pane or not, full screen), so
      // what's on them stays.
      key: _pagesKey,
      index: remote ? 1 : 0,
      children: [
        ExcludeFocus(excluding: remote, child: const PrompterScreen()),
        ExcludeFocus(excluding: !remote, child: const RemoteScreen()),
      ],
    );
    Widget body = pages;
    if (Env.desktop) {
      body = ValueListenableBuilder<bool>(
        valueListenable: Fullscreen.on,
        builder: (context, full, _) => full ? pages : _DesktopShell(page: page, child: pages),
      );
    }
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        body: Column(
          children: [
            if (Env.android) const UpdateBar(),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }

  DateTime? _backAt;

  /// Back (docs/flutter-android-app-spec.md §5): the editor shuts, then the remote goes back to
  /// the prompter, then "Press back again to exit", and the second press sends the app to the
  /// background rather than closing it, so a remote stays connected and the script stays put.
  void _back() {
    if (Session.I.editorOpen) {
      Session.I.cancelEditor();
      return;
    }
    if (AppPages.active() == AppPages.remote) {
      AppPages.open(AppPages.prompter);
      return;
    }
    final now = DateTime.now();
    if (_backAt != null && now.difference(_backAt!) < const Duration(seconds: 2)) {
      _backAt = null;
      Native.tryCall('App', 'background');
      return;
    }
    _backAt = now;
    AppNav.toast('Press back again to exit');
  }
}

/// From 1024 px wide, the scripts beside the prompter, sliding in and out from the title bar's
/// Scripts button. No navigation rail: the edge trays are what put the controls away, and a fixed
/// column beside them would undo that. The remote page is a button in the title bar too.
class _DesktopShell extends StatelessWidget {
  const _DesktopShell({required this.page, required this.child});
  final String page;
  final Widget child;

  /// The pane's width, and its divider's.
  static const paneWidth = 360.0;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final w = MediaQuery.sizeOf(context).width;
    if (w <= Env.splitWidth) return child;
    // Instant for anybody who's asked their computer for less motion.
    final duration = MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 240);
    return ListenableBuilder(
      listenable: Listenable.merge([Scripts.I, ThemeController.I]),
      builder: (context, _) {
        final show = page == AppPages.prompter && Scripts.I.pane;
        return Row(
          children: [
            // Laid out at its full width throughout, and uncovered from its right edge, so its
            // rows don't rewrap as it moves. Put away, it's out of reach of the mouse, the keys
            // and a screen reader.
            AnimatedContainer(
              duration: duration,
              curve: Curves.easeInOutCubic,
              width: show ? paneWidth + 1 : 0,
              child: ClipRect(
                child: OverflowBox(
                  alignment: Alignment.centerRight,
                  minWidth: paneWidth + 1,
                  maxWidth: paneWidth + 1,
                  child: ExcludeFocus(
                    excluding: !show,
                    child: ExcludeSemantics(
                      excluding: !show,
                      child: IgnorePointer(
                        ignoring: !show,
                        child: Row(
                          children: [
                            SizedBox(
                              key: TourTargets.key('scripts-pane'),
                              width: paneWidth,
                              child: const _ScriptsPane(),
                            ),
                            VerticalDivider(width: 1, color: c.border),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Expanded(child: child),
          ],
        );
      },
    );
  }
}

/// The scripts, beside the prompter: picking one opens it there.
class _ScriptsPane extends StatelessWidget {
  const _ScriptsPane();

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final scripts = Scripts.I.all;
    final active = Scripts.I.activeId;
    return Material(
      color: c.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
            child: Row(
              children: [
                Expanded(child: Semantics(header: true, child: Text('Scripts', style: TextStyle(color: c.ink, fontSize: 17)))),
                IconButton(tooltip: 'New script', onPressed: Session.I.newScript, icon: AppIcon('plus', size: 18, color: c.ink)),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              children: [
                for (final s in scripts)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: ScriptRow(script: s, active: s['id'] == active, closeOnPick: false),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
