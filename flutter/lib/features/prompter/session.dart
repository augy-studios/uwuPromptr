// The prompter page's state and its remote (main-site/js/app.js): the open script and its
// revisions, the editor, and the remote host, on the network and (Android) phone to phone. The
// screens draw from here; the remote, the watch, the keyboard and the desktop's tray and widget
// all act through here, so they agree.
import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/nav.dart';
import '../../data/prompter_logic.dart';
import '../../data/scripts.dart';
import '../../remote/codes.dart';
import '../../remote/link.dart';
import '../../remote/nearby.dart';
import '../../remote/watch.dart';
import '../../theme/theme.dart';
import 'prompter.dart';

/// How often the prompter sends its state to the remote while hosting: 20 a second, which is also
/// the heartbeat.
const stateInterval = Duration(milliseconds: 50);

class Session extends ChangeNotifier {
  Session._();
  static final Session I = Session._();

  Prompter get prompter => Prompter.I;

  // ---------- the script ----------

  /// Counts changes made here, so an edit from the remote answering an older script is refused
  /// rather than written over a newer one. Not stored: it only has to differ after a change.
  int scriptRev = 0;

  Json get script => Scripts.I.active;

  /// What's on screen now, from the store.
  void loadActive() {
    prompter.loaded();
    broadcastScript();
    notifyListeners();
  }

  void switchTo(String id) {
    Scripts.I.activeId = id;
    scriptRev++;
    loadActive();
  }

  void newScript() {
    final s = Scripts.I.create();
    switchTo(s['id'] as String);
    openEditor();
  }

  void deleteScript(String id) {
    Scripts.I.delete(id);
    scriptRev++;
    loadActive();
  }

  // ---------- the editor ----------

  bool editorOpen = false;
  final nameField = TextEditingController();
  final bodyField = TextEditingController();
  Json? _snapshot;
  Timer? _autosave;

  /// What the script said when the editor opened, which Cancel puts back: autosave has been
  /// writing since the first keystroke, so the store already holds the edit by then.
  void openEditor() {
    if (editorOpen) return;
    final s = script;
    _snapshot = {'id': s['id'], 'name': s['name'], 'body': s['body']};
    nameField.text = '${s['name']}';
    bodyField.text = '${s['body']}';
    editorOpen = true;
    prompter.pause();
    // The remote covers itself while this is open, so two people never type into one script.
    broadcastEditing(true);
    notifyListeners();
  }

  bool get editorHasChanges {
    final snap = _snapshot;
    if (snap == null) return false;
    final name = nameField.text.trim().isEmpty
        ? 'Untitled script'
        : nameField.text.trim();
    return name != snap['name'] || bodyField.text != snap['body'];
  }

  void _cancelAutosave() {
    _autosave?.cancel();
    _autosave = null;
  }

  /// Saved as they type, so closing the app mid-sentence loses nothing, and the remote watches it
  /// being typed.
  void editorTyped() {
    _cancelAutosave();
    _autosave = Timer(const Duration(milliseconds: 400), () {
      _autosave = null;
      Scripts.I.update(
        Scripts.I.activeId,
        name: _fieldName,
        body: bodyField.text,
      );
      scriptRev++;
      broadcastScript();
    });
  }

  String get _fieldName =>
      nameField.text.trim().isEmpty ? 'Untitled script' : nameField.text.trim();

  void closeEditor({bool save = true}) {
    _cancelAutosave();
    if (save) {
      Scripts.I.update(
        Scripts.I.activeId,
        name: _fieldName,
        body: bodyField.text,
      );
      scriptRev++;
    } else if (_snapshot != null) {
      // Back to what it opened with, against the snapshot's own id.
      Scripts.I.update(
        '${_snapshot!['id']}',
        name: '${_snapshot!['name']}',
        body: '${_snapshot!['body']}',
      );
      scriptRev++;
    }
    _snapshot = null;
    editorOpen = false;
    broadcastEditing(false);
    loadActive();
  }

  /// Close without saving, asking first if there's anything to lose.
  Future<void> cancelEditor() async {
    if (editorHasChanges &&
        !await AppNav.confirm(
          'Discard your changes to this script?',
          yes: 'Discard',
        ))
      return;
    closeEditor(save: false);
  }

  /// Text pasted into the editor, cleaned as the site cleans it.
  void pasteIntoEditor(String raw) {
    final clean = cleanPastedText(raw);
    final sel = bodyField.selection;
    final text = bodyField.text;
    final start = sel.isValid ? sel.start : text.length;
    final end = sel.isValid ? sel.end : text.length;
    bodyField.value = TextEditingValue(
      text: text.replaceRange(start, end, clean),
      selection: TextSelection.collapsed(offset: start + clean.length),
    );
    editorTyped();
  }

  // ---------- the remote host ----------

  WebHost? host;
  NearbyHost? nearbyHost;
  String? hostCode;

  /// Stopped with Stop rather than never started: reopening the panel leaves it stopped.
  bool stoppedByHand = false;

  /// What the panel and the button's light say: idle, connecting, waiting, connected or error.
  String remoteStatus = 'idle';
  String remoteMessage = '';
  String nearbyStatus = 'idle';
  String nearbyMessage = '';
  bool get remoteConnected => remoteStatus == 'connected';
  bool get running => host != null || nearbyHost != null;

  Timer? _stateTimer;
  bool _retiring = false;
  bool _recovering = false;

  String get statusText => switch (remoteStatus) {
    'connected' => 'A remote is connected.',
    'waiting' => 'Waiting for a remote to connect.',
    'connecting' => 'Opening the pairing channel.',
    'error' =>
      remoteMessage.isEmpty ? 'The remote connection failed.' : remoteMessage,
    _ => 'The remote is not running.',
  };

  void _setRemote(String status, [String? message]) {
    remoteStatus = status;
    remoteMessage = message ?? '';
    syncKeepAwake();
    notifyListeners();
  }

  void syncKeepAwake() =>
      prompter.setKeepAwake(remoteConnected || Watch.attached);

  /// The panel opened: the host starts, unless it was stopped by hand.
  void openedPanel() {
    if (!stoppedByHand) startRemote();
  }

  Future<void> startRemote() async {
    if (host != null) return;
    // The code this prompter published last time, so a remote paired before can come back on it.
    final stored = Scripts.I.hostCode;
    hostCode = isValidCode(stored) ? stored : generateCode();
    Scripts.I.hostCode = hostCode!;
    final h = WebHost();
    host = h;
    h.onStatus = (status, {message, taken = false}) {
      if (host != h) return;
      if (taken) {
        _recoverFromTakenCode();
        return;
      }
      // A phone connected nearby stays the news whatever the web side does.
      if (nearbyHost?.status == 'connected' && status != 'connected') return;
      _setRemote(status, message);
      if (status == 'connected') {
        broadcastScript();
        broadcastState();
      }
    };
    h.onMessage = handleRemoteMessage;
    _setRemote('connecting');
    _ensureTimer();
    try {
      await h.start(hostCode!);
    } catch (_) {
      if (host == h) host = null;
      _setRemote(
        'error',
        nearbyAvailable()
            ? 'Could not reach the pairing service. Check your connection, or connect a phone nearby below.'
            : 'Could not reach the pairing service. Check your connection.',
      );
    }
    notifyListeners();
  }

  void stopRemote() {
    host?.close();
    host = null;
    stopNearby();
    hostCode = null;
    _setRemote('idle');
  }

  /// Gives up the code and publishes a new one: anybody holding the old one is cut off.
  Future<void> regenerateCode() async {
    host?.close();
    host = null;
    hostCode = null;
    Scripts.I.hostCode = '';
    await startRemote();
    _restartNearby();
    AppNav.toast('New remote ID');
  }

  Future<void> _recoverFromTakenCode() async {
    if (_recovering) {
      _setRemote('error', 'That code is already in use. Generate a new one.');
      return;
    }
    _recovering = true;
    host?.close();
    host = null;
    hostCode = null;
    Scripts.I.hostCode = '';
    try {
      await startRemote();
      _restartNearby();
    } finally {
      _recovering = false;
    }
  }

  /// A remote said bye, so the code it used is spent: a code shown to a room shouldn't reach this
  /// prompter in the next session.
  Future<void> _retireCode() async {
    if (_retiring || (host == null && nearbyHost == null)) return;
    _retiring = true;
    try {
      host?.close();
      host = null;
      hostCode = null;
      Scripts.I.hostCode = '';
      await startRemote();
      _restartNearby();
      AppNav.toast('Remote disconnected. New ID.');
    } finally {
      _retiring = false;
    }
  }

  // ---------- the offline remote (Android) ----------

  String get nearbyLabel =>
      {'waiting', 'connected', 'connecting'}.contains(nearbyStatus)
      ? 'Stop connecting nearby'
      : 'Let a nearby phone connect';

  String get nearbyText => switch (nearbyStatus) {
    'connecting' => 'Starting.',
    'waiting' => 'Waiting for a nearby phone. Bluetooth has to be on on both.',
    'connected' => 'A nearby phone is connected.',
    'error' =>
      nearbyMessage.isEmpty ? 'Connecting without wifi failed.' : nearbyMessage,
    _ => '',
  };

  Future<void> toggleNearby() async {
    if ({'waiting', 'connected', 'connecting'}.contains(nearbyHost?.status)) {
      stopNearby();
    } else {
      await startNearby();
    }
  }

  Future<void> startNearby() async {
    if (hostCode == null) {
      stoppedByHand = false;
      await startRemote();
    }
    nearbyHost?.close();
    final link = NearbyHost();
    nearbyHost = link;
    link.onStatus = (status, {message, taken = false}) {
      if (nearbyHost != link) return;
      nearbyStatus = status;
      nearbyMessage = message ?? '';
      if (status == 'connected') {
        _setRemote('connected');
        broadcastScript();
        broadcastState();
        return;
      }
      if (host?.status == 'connected') {
        notifyListeners();
        return;
      }
      _setRemote(status == 'waiting' ? 'waiting' : (host?.status ?? 'idle'));
    };
    link.onMessage = handleRemoteMessage;
    _ensureTimer();
    notifyListeners();
    await link.start(hostCode!);
  }

  void stopNearby() {
    final link = nearbyHost;
    nearbyHost = null;
    if (link != null) {
      link.onStatus = null;
      link.close();
    }
    nearbyStatus = 'idle';
    nearbyMessage = '';
    notifyListeners();
  }

  void _restartNearby() {
    if (nearbyHost != null) startNearby();
  }

  // ---------- what the remote says, and what goes back ----------

  void handleRemoteMessage(Map<String, dynamic> message) {
    switch (message['type']) {
      case 'bye':
        _retireCode();
        return;
      case 'hello':
        broadcastScript();
        broadcastState();
        // A remote that connects while the editor is open arrives locked.
        _send({'type': 'editing', 'open': editorOpen});
        return;
      case 'edit':
        _applyRemoteEdit(message);
        return;
      case 'command':
        break;
      default:
        return;
    }
    final p = prompter;
    switch (message['name']) {
      case 'play':
        p.play();
      case 'pause':
        p.pause();
      case 'toggle':
        p.togglePlay();
      case 'reset':
        p.reset();
      case 'seek':
        final v = message['value'];
        if (v is num) p.seek(v);
      case 'set':
        final setting = '${message['setting']}';
        final v = message['value'];
        if (settingRanges.containsKey(setting) && v is num) p.set(setting, v);
        if (settingToggles.containsKey(setting) && v is bool) p.set(setting, v);
      case 'nudge':
        final v = message['value'];
        if (v is num)
          p.nudge(
            '${message['setting']}',
            v,
            coarse: message['coarse'] == true,
          );
    }
  }

  void _applyRemoteEdit(Map<String, dynamic> m) {
    // The script goes first in both refusals, so the remote has the current text before it's told.
    if (editorOpen) {
      broadcastScript();
      _send({'type': 'edit-refused', 'reason': 'editing'});
      _send({'type': 'editing', 'open': true});
      return;
    }
    if ((m['rev'] is num ? (m['rev'] as num).toInt() : -1) != scriptRev) {
      broadcastScript();
      _send({'type': 'edit-refused', 'reason': 'stale'});
      return;
    }
    final name = '${m['name'] ?? ''}'.trim().isEmpty
        ? 'Untitled script'
        : '${m['name']}'.trim();
    final body = '${m['body'] ?? ''}';
    Scripts.I.update(Scripts.I.activeId, name: name, body: body);
    scriptRev++;
    // Rewound: the text under the reader just changed.
    loadActive();
  }

  void _send(Map<String, Object?> message) {
    host?.send(message);
    nearbyHost?.send(message);
  }

  void broadcastScript() {
    if (!running) return;
    final s = script;
    _send({
      'type': 'script',
      'name': s['name'],
      'body': s['body'],
      'rev': scriptRev,
    });
  }

  void broadcastEditing(bool open) => _send({'type': 'editing', 'open': open});

  /// The whole state, with the colours this screen is in, so the remote's copy matches it.
  void broadcastState() {
    if (!running) return;
    final t = ThemeController.I;
    final hex = '#${(t.colorTheme.hex).toRadixString(16).padLeft(6, '0')}';
    _send({
      'type': 'state',
      'payload': {
        ...prompter.state(),
        'look': {'mode': t.mode, 'brand': hex},
      },
    });
  }

  void _ensureTimer() {
    _stateTimer ??= Timer.periodic(stateInterval, (_) {
      if (running) broadcastState();
    });
  }
}
