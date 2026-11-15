// The remote end (main-site/js/remote-page.js): connects to a prompter by its code and drives it,
// and mirrors back what the prompter shows, so somebody holding the phone can see the script and
// the clock without looking at the screen. It drives the site's prompter as readily as the app's.
import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/prompter_logic.dart';
import '../../data/scripts.dart';
import '../../data/store.dart';
import '../../remote/codes.dart';
import '../../remote/link.dart';
import '../../remote/nearby.dart';

class RemoteSession extends ChangeNotifier {
  RemoteSession._();
  static final RemoteSession I = RemoteSession._();

  RemoteLink? client;

  /// idle, connecting, connected, dropped, unreachable, waiting or error.
  String status = 'idle';
  String message = '';
  bool get live => status == 'connected';

  /// The note under the form: "You were last connected to this ID.", until anything's tried.
  String? connectNote;
  String connectLabel = 'Connect';
  final codeField = TextEditingController();

  // ---- what the prompter last said ----

  Json? lastState;
  final Stopwatch _since = Stopwatch();
  String scriptName = 'Connected';
  String scriptBody = '';
  int scriptRev = 0;

  /// The prompter's editor is open: this page is covered and takes no input.
  bool locked = false;

  // ---- editing from here ----

  bool editing = false;
  int _editingRev = 0;
  bool reopenOnNextScript = false;
  bool stale = false;
  String? refused;
  Map<String, String>? _sent;
  final nameField = TextEditingController();
  final bodyField = TextEditingController();

  /// The page opened: a code in the link connects straight away; a remembered one is offered.
  void boot({String? fromLink}) {
    // A link that opened the app has already put its code in and connected.
    if (fromLink == null && (status != 'idle' || codeField.text.isNotEmpty))
      return;
    final link = normaliseCode(fromLink);
    final remembered = normaliseCode(Store.I.get(keyLastRemoteId));
    final code = link.isNotEmpty ? link : remembered;
    if (code.isNotEmpty) codeField.text = code;
    if (link.isNotEmpty) {
      connect(link);
    } else if (isValidCode(remembered) && !live) {
      // One tap rather than automatic, so opening the remote days later doesn't greet somebody
      // with an error about a prompter that isn't running.
      connectLabel = 'Reconnect';
      connectNote = 'You were last connected to this ID.';
    }
    notifyListeners();
  }

  String get statusText => switch (status) {
    'connected' => 'Connected.',
    'connecting' => 'Connecting.',
    'dropped' => 'Disconnected from the prompter. Connect again to carry on.',
    'unreachable' =>
      'Could not reach the prompter. Both devices have to be on the same network, '
          'so share a mobile hotspot from one to the other if there is no shared wifi. '
          'Check too that the code is still the one on screen.',
    'waiting' => 'Waiting for the prompter.',
    'error' => message.isEmpty ? 'The connection failed.' : message,
    _ => 'Not connected.',
  };

  void _setStatus(String s, [String? m]) {
    final wasLive = live;
    status = s;
    message = m ?? '';
    if (s != 'idle') connectNote = null;
    if (s != 'connected') {
      // A connection that's gone can't say the prompter's editor closed.
      locked = false;
    }
    if (live && !wasLive) connectLabel = 'Connect';
    notifyListeners();
  }

  Future<void> connect(String code, {bool nearby = false}) async {
    if (!isValidCode(code)) {
      _setStatus('error', 'A remote ID is $codeLength characters.');
      return;
    }
    client?.close();
    final RemoteLink link = nearby ? NearbyClient() : WebClient();
    client = link;
    link.onStatus = (s, {message, taken = false}) {
      if (client != link) return;
      _setStatus(s, message);
    };
    link.onMessage = (m) {
      if (client != link) return;
      switch (m['type']) {
        case 'state':
          if (m['payload'] is Map) _applyState(Json.from(m['payload'] as Map));
        case 'script':
          _applyScript(m);
        case 'editing':
          _applyLock(m['open'] == true);
        case 'edit-refused':
          _applyRefused('${m['reason']}');
      }
    };
    _setStatus('connecting');
    try {
      if (link is NearbyClient) {
        await link.connect(code);
      } else if (link is WebClient) {
        await link.connect(code);
      }
      // Somebody who connected once shouldn't have to retype the code next time.
      Store.I.put(keyLastRemoteId, code);
    } catch (_) {
      _setStatus(
        'error',
        'Could not reach the pairing service. Check your connection.',
      );
    }
  }

  void send(Map<String, Object?> message) {
    if (live) client?.send(message);
  }

  void command(
    String name, {
    String? setting,
    num? value,
    bool coarse = false,
  }) => send({
    'type': 'command',
    'name': name,
    'setting': ?setting,
    'value': ?value,
    if (name == 'nudge') 'coarse': coarse,
  });

  /// Disconnect: says bye first, which tells the prompter to retire the code.
  void disconnect() {
    send({'type': 'bye'});
    Store.I.remove(keyLastRemoteId);
    client?.close();
    client = null;
    closeEditor();
    locked = false;
    reopenOnNextScript = false;
    lastState = null;
    _setStatus('idle');
  }

  // ---- the mirror ----

  void _applyState(Json state) {
    lastState = state;
    _since
      ..reset()
      ..start();
    notifyListeners();
  }

  /// Carried forward between updates at the prompter's own rate, and stopped where it stops.
  double get mirrorScrollTop {
    final s = lastState;
    final view = s?['view'];
    if (s == null || view is! Map) return 0;
    final since = s['playing'] == true ? _since.elapsedMilliseconds : 0;
    final height = (view['height'] as num? ?? 0).toDouble();
    final max = ((view['scrollHeight'] as num? ?? 0) - height)
        .toDouble()
        .clamp(0, double.infinity)
        .toDouble();
    final top =
        (view['scrollTop'] as num? ?? 0).toDouble() +
        pixelsPerSecond(s['speed'] as num? ?? 0, s['fontSize'] as num? ?? 60) *
            since /
            1000;
    return top.clamp(0, max).toDouble();
  }

  int get elapsed {
    final s = lastState;
    if (s == null) return 0;
    final since = s['playing'] == true ? _since.elapsedMilliseconds : 0;
    return (s['elapsed'] as num? ?? 0).toInt() + since;
  }

  bool get playing => lastState?['playing'] == true;

  // ---- the script, and editing it from here ----

  void _applyScript(Map<String, dynamic> m) {
    scriptRev = m['rev'] is num ? (m['rev'] as num).toInt() : 0;
    scriptName = '${m['name'] ?? ''}';
    scriptBody = '${m['body'] ?? ''}';
    // Somebody's typing here: their sentence isn't overwritten. The banner says the prompter moved
    // on, and they choose.
    if (editing) {
      stale = true;
      notifyListeners();
      return;
    }
    nameField.text = scriptName;
    bodyField.text = scriptBody;
    stale = false;
    if (reopenOnNextScript) {
      reopenOnNextScript = false;
      openEditor();
    }
    notifyListeners();
  }

  void _applyLock(bool open) {
    locked = open;
    // Held rather than sent: sending on their behalf would decide whose edit survives.
    if (open && editing) stale = true;
    notifyListeners();
  }

  void openEditor({bool keepNotice = false}) {
    editing = true;
    _editingRev = scriptRev;
    stale = false;
    if (!keepNotice) refused = null;
    notifyListeners();
  }

  void closeEditor() {
    editing = false;
    stale = false;
    refused = null;
    notifyListeners();
  }

  void cancelEdit() {
    closeEditor();
    // Back to whatever the prompter last sent, including anything held back meanwhile.
    send({'type': 'hello'});
  }

  void sendEdit() {
    final name = nameField.text.trim().isEmpty
        ? 'Untitled script'
        : nameField.text.trim();
    _sent = {'name': name, 'body': bodyField.text};
    send({
      'type': 'edit',
      'name': name,
      'body': bodyField.text,
      'rev': _editingRev,
    });
    closeEditor();
  }

  /// Reload what the prompter says now, abandoning what's in the field.
  void reloadEdit() {
    closeEditor();
    reopenOnNextScript = true;
    send({'type': 'hello'});
  }

  void _applyRefused(String reason) {
    final sent = _sent;
    if (sent == null) return;
    nameField.text = sent['name']!;
    bodyField.text = sent['body']!;
    _sent = null;
    refused = reason == 'editing'
        ? 'Not sent: the script is open in the editor on the prompter. Your text is still here.'
        : 'Not sent: the script changed on the prompter first. Your text is still here, and the preview above shows what it says now.';
    openEditor(keepNotice: true);
  }

  /// A frame tick while the copy of the screen scrolls between updates.
  Timer? _ticker;
  void watchMirror(bool on) {
    _ticker?.cancel();
    _ticker = on
        ? Timer.periodic(
            const Duration(milliseconds: 33),
            (_) => playing && live ? notifyListeners() : null,
          )
        : null;
  }

  String get clock => formatElapsed(elapsed);
}
