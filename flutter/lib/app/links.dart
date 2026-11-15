// Every link that opens the app goes through Links.open() (docs/flutter-android-app-spec.md §5):
// the site's own https links (verified with assetlinks.json), the uwu://cue/ scheme shared with
// the sibling apps, notifications, and on the desktop the command bar and the Jump List.
//
//   https://cue.uwuapps.org/                  the prompter
//   https://cue.uwuapps.org/remote?id=CODE    the remote, connecting to CODE
//   uwu://cue/  and  uwu://cue/remote?id=CODE  the same
//   uwu://cue/s/<scriptId>                    the prompter on that script (the desktop's Jump List)
//   uwu://cue/new                             a new script, in the editor
//   uwu://cue/updates                         the Updates page (Android)
//   uwu://cue/watch                           only brings the app forward (the watch's Open on phone)
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../data/scripts.dart';
import '../features/prompter/session.dart';
import '../features/remote/remote_session.dart';
import '../features/update/update_bar.dart';
import '../remote/codes.dart';
import 'nav.dart';
import 'pages.dart';

const appScheme = 'uwu';
const appHost = 'cue';

sealed class LinkTarget {
  const LinkTarget();
}

class LinkPrompter extends LinkTarget {
  const LinkPrompter();
}

class LinkRemote extends LinkTarget {
  const LinkRemote(this.code);

  /// A valid code, or null for just the remote page.
  final String? code;
}

class LinkScript extends LinkTarget {
  const LinkScript(this.id);
  final String id;
}

class LinkNewScript extends LinkTarget {
  const LinkNewScript();
}

class LinkUpdates extends LinkTarget {
  const LinkUpdates();
}

/// Brings the app forward and changes nothing.
class LinkNothing extends LinkTarget {
  const LinkNothing();
}

/// Somewhere else: opened in the browser.
class LinkOut extends LinkTarget {
  const LinkOut(this.uri);
  final Uri uri;
}

final _plainPath = RegExp(r'^[A-Za-z0-9/_\-.]*$');

String? _code(Uri uri) {
  final id = normaliseCode(uri.queryParameters['id']);
  return isValidCode(id) ? id : null;
}

/// Reads a link, or null if it's nothing the app can open. Only plain path characters are taken
/// from the app's own scheme.
LinkTarget? parseLink(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;
  // A path typed into the desktop's command bar.
  if (text.startsWith('/')) return parseLink('$siteOrigin$text');
  final uri = Uri.tryParse(text);
  if (uri == null || !uri.hasScheme) return null;
  if (uri.scheme == appScheme) {
    if (uri.host.toLowerCase() != appHost) return null;
    final path = uri.path.replaceAll(RegExp(r'^/+|/+$'), '');
    if (!_plainPath.hasMatch(path)) return null;
    final parts = path.isEmpty ? <String>[] : path.split('/');
    if (parts.isEmpty) return const LinkPrompter();
    switch (parts[0]) {
      case 'remote':
        return LinkRemote(_code(uri));
      case 's' when parts.length == 2:
        return LinkScript(parts[1]);
      case 'new':
        return const LinkNewScript();
      case 'updates':
        return const LinkUpdates();
      case 'watch':
        return const LinkNothing();
    }
    return const LinkPrompter();
  }
  if ((uri.scheme == 'https' || uri.scheme == 'http') && uri.host == siteHost) {
    final path = uri.path.replaceAll(RegExp(r'\.html$'), '').replaceAll(RegExp(r'/+$'), '');
    if (path == '/remote') return LinkRemote(_code(uri));
    return const LinkPrompter();
  }
  if (uri.scheme == 'https' || uri.scheme == 'http' || uri.scheme == 'mailto') return LinkOut(uri);
  return null;
}

/// The site's address for what's on show, as the desktop's Copy link gives it.
String linkForPage() {
  if (AppPages.active() == AppPages.remote) {
    final code = normaliseCode(RemoteSession.I.codeField.text);
    return isValidCode(code) ? remoteUrl(code) : '$siteOrigin/remote';
  }
  final host = Session.I.hostCode;
  // The prompter, or with its remote running, the link that pairs a remote with it.
  return host != null ? remoteUrl(host) : '$siteOrigin/';
}

class Links {
  Links._();

  /// A link that came before the app was on screen, kept until it is.
  static String? pending;
  static bool shown = false;

  /// Opens a link. Returns false when it was nothing the app knows.
  static Future<bool> open(String raw) async {
    final target = parseLink(raw);
    if (target == null) return false;
    if (!shown && target is! LinkOut) {
      pending = raw;
      return true;
    }
    switch (target) {
      case LinkPrompter():
        AppNav.closeSheets();
        AppPages.open(AppPages.prompter);
      case LinkNothing():
        break;
      case LinkOut(:final uri):
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      case LinkRemote(:final code):
        AppNav.closeSheets();
        AppPages.open(AppPages.remote);
        if (code != null) {
          RemoteSession.I.codeField.text = code;
          await RemoteSession.I.connect(code);
        }
      case LinkScript(:final id):
        AppNav.closeSheets();
        AppPages.open(AppPages.prompter);
        if (Scripts.I.byId(id) == null) {
          AppNav.toast('Not found', error: true);
        } else {
          Session.I.switchTo(id);
        }
      case LinkNewScript():
        AppNav.closeSheets();
        AppPages.open(AppPages.prompter);
        Session.I.newScript();
      case LinkUpdates():
        await openUpdates();
    }
    return true;
  }

  /// Once the app is on screen: a link that opened it, now usable.
  static void appShown() {
    shown = true;
    final p = pending;
    pending = null;
    if (p != null) open(p);
  }
}
