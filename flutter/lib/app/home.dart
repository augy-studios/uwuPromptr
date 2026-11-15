// The app's one screen: the prompter and the remote, each kept (an IndexedStack), with the update
// bar above them on Android. On the desktop a navigation rail sits at the left, and from 1024 px
// wide the scripts beside the prompter, picked from there rather than from a window.
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
      // The same pages wherever the shell puts them (the rail, the scripts pane, full screen), so
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

/// The desktop's navigation rail, and from 1024 px wide the scripts beside the prompter.
class _DesktopShell extends StatelessWidget {
  const _DesktopShell({required this.page, required this.child});
  final String page;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = UwuColors.of(context);
    final w = MediaQuery.sizeOf(context).width;
    if (w < Env.phoneWidth) return child;
    return ListenableBuilder(
      listenable: Listenable.merge([Scripts.I, ThemeController.I]),
      builder: (context, _) {
        final paneOn = Scripts.I.pane;
        final showPane = w > Env.splitWidth && page == AppPages.prompter && paneOn;
        return Row(
          children: [
            NavigationRail(
              key: TourTargets.key('rail'),
              selectedIndex: page == AppPages.remote ? 1 : 0,
              labelType: NavigationRailLabelType.all,
              onDestinationSelected: (i) => AppPages.open(i == 1 ? AppPages.remote : AppPages.prompter),
              destinations: const [
                NavigationRailDestination(icon: AppIcon('scripts', size: 20), label: Text('Prompter')),
                NavigationRailDestination(icon: AppIcon('remote', size: 20), label: Text('Remote')),
              ],
              trailing: w > Env.splitWidth && page == AppPages.prompter
                  ? Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: IconButton(
                        tooltip: paneOn ? 'Hide the scripts' : 'Show the scripts',
                        onPressed: () => Scripts.I.pane = !paneOn,
                        icon: AppIcon(paneOn ? 'chevron-left' : 'chevron-right', size: 18, color: c.ink),
                      ),
                    )
                  : null,
            ),
            VerticalDivider(width: 1, color: c.border),
            if (showPane) ...[
              SizedBox(width: 360, child: const _ScriptsPane()),
              VerticalDivider(width: 1, color: c.border),
            ],
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
