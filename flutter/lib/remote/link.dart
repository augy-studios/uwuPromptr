// The remote's links (main-site/js/remote.js): the prompter publishes a short code and waits;
// the remote connects with it; the two exchange state over a data channel. PeerJS's broker does
// the introduction only, so nothing about a script passes through a server.
//
// The wire, both ways, the site's own:
//
//   { type: "state",   payload }          prompter to remote, the whole visible state
//   { type: "command", name, value, … }   remote to prompter, one action
//   { type: "script",  name, body, rev }  prompter to remote, what's on screen
//   { type: "edit",    name, body, rev }  remote to prompter, a rewritten script
//   { type: "editing", open }             prompter to remote, its editor open or shut
//   { type: "edit-refused", reason }      prompter to remote, an edit not taken
//   { type: "hello" }                     remote to prompter, asking for state
//   { type: "bye" }                       remote to prompter, leaving on purpose
//
// Every link (these, and Nearby's in nearby.dart) has the same statuses and calls, so the
// prompter and the remote treat any of them alike.
import 'dart:async';

import 'codes.dart';
import 'peer.dart';

/// One link to the other end, of whatever kind.
abstract class RemoteLink {
  String status = 'idle';

  /// A status changed: idle, connecting, waiting, connected, dropped, unreachable or error, with
  /// a message for an error, and `taken` when the code is already someone else's.
  void Function(String status, {String? message, bool taken})? onStatus;
  void Function(Map<String, dynamic> message)? onMessage;

  void setStatus(String s, {String? message, bool taken = false}) {
    status = s;
    onStatus?.call(s, message: message, taken: taken);
  }

  void send(Map<String, Object?> message);
  void close();
}

/// The prompter's end over the network: publishes `code` and takes whoever connects with it, one
/// remote at a time. From this end a remote that dropped and one that never arrived are the same
/// state, waiting: the code outlives the drop, so a remote that reloaded comes back on it.
class WebHost extends RemoteLink {
  PeerListener? _listener;
  ShareLink? _link;

  Future<void> start(String code) async {
    setStatus('connecting');
    final listener = PeerListener(
      code,
      onOpen: () {
        if (_link?.isOpen != true) setStatus('waiting');
      },
      onError: (type) {
        if (type == 'unavailable-id') {
          setStatus('error', message: describePeerError(type), taken: true);
        } else if (brokerErrors.contains(type)) {
          // The broker went; a remote already connected carries on without it.
          if (_link?.isOpen != true) setStatus('error', message: describePeerError(type));
        } else {
          setStatus('error', message: describePeerError(type));
        }
      },
      onLink: (link) {
        // A second remote replaces the first rather than fighting it. Detached before it's
        // closed, so its close isn't taken for the remote dropping away.
        final previous = _link;
        _link = link;
        if (previous != null) {
          previous.onClose = null;
          previous.close();
        }
        link.onOpen = () => setStatus('connected');
        link.onData = (m) => onMessage?.call(m);
        link.onClose = () {
          if (_link != link) return;
          _link = null;
          setStatus('waiting');
        };
      },
    );
    _listener = listener;
    await listener.start();
  }

  @override
  void send(Map<String, Object?> message) {
    final l = _link;
    if (l != null && l.isOpen) l.send(message);
  }

  @override
  void close() {
    final link = _link;
    _link = null;
    if (link != null) {
      link.onClose = null;
      link.close();
    }
    _listener?.close();
    _listener = null;
    setStatus('idle');
  }
}

/// How long a handshake may take before it's called blocked rather than slow.
const connectTimeout = Duration(seconds: 15);

/// The remote's end over the network: connects to the prompter showing `code`.
class WebClient extends RemoteLink {
  PeerDialer? _dialer;
  ShareLink? _link;
  Timer? _timer;

  Future<void> connect(String code) async {
    setStatus('connecting');
    _timer = Timer(connectTimeout, () {
      if (status != 'connected') {
        final l = _link;
        _link = null;
        if (l != null) {
          l.onClose = null;
          l.close();
        }
        setStatus('unreachable');
      }
    });
    final dialer = PeerDialer(
      onLink: (link) {
        _link = link;
        link.onOpen = () {
          _timer?.cancel();
          setStatus('connected');
          link.send({'type': 'hello'});
        };
        link.onData = (m) => onMessage?.call(m);
        link.onClose = () {
          if (_link != link) return;
          _link = null;
          // A link that never opened never reached the other end: unreachable, not dropped.
          setStatus(link.everOpened ? 'dropped' : 'unreachable');
        };
      },
      onError: (type) {
        if (brokerErrors.contains(type) && _link?.isOpen == true) return;
        _timer?.cancel();
        setStatus('error', message: describePeerError(type));
      },
    );
    _dialer = dialer;
    await dialer.connect(code);
  }

  @override
  void send(Map<String, Object?> message) {
    final l = _link;
    if (l != null && l.isOpen) l.send(message);
  }

  @override
  void close() {
    _timer?.cancel();
    final link = _link;
    _link = null;
    if (link != null) {
      link.onClose = null;
      link.close();
    }
    _dialer?.close();
    _dialer = null;
    setStatus('idle');
  }
}

/// The QR and Copy link's address for a code.
String linkFor(String code) => remoteUrl(code);
