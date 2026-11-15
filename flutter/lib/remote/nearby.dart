// The offline remote (main-site/js/nearby.js): phone to phone over Bluetooth and Wi-Fi through
// Google's Nearby Connections (android/app/.../NearbyLink.java), with no router and no mobile
// data. Android only, and only where the app lists the "nearby" feature (Google Play services).
//
// NearbyHost and NearbyClient behave as the web links do (link.dart): the same statuses, send()
// and close(), and the same messages on the wire, so the prompter and the remote treat either
// link the same way. The prompter advertises under a hash of its id (codes.dart's nearbyName);
// the id itself is only sent inside the encrypted connection, as the first message, and a remote
// that gets it wrong is dropped.
import 'dart:async';
import 'dart:convert';

import '../native/bridge.dart';
import 'codes.dart';
import 'link.dart';

const _findTimeout = Duration(seconds: 30);
const _authTimeout = Duration(seconds: 8);

bool nearbyAvailable() => Native.has('nearby');

/// A refusal from the app, as a sentence saying what to do.
String describeNearbyRefusal(String? state) => switch (state) {
  'denied' => 'Connecting without wifi needs the Nearby devices permission. Allow it in Android’s settings for uwuPromptr.',
  'location-off' => 'Turn on location to connect without wifi. This version of Android needs it for Bluetooth.',
  'unavailable' => 'Connecting without wifi needs Google Play services, which this phone does not have.',
  _ => 'Could not start connecting without wifi.',
};

abstract class _NearbyLink extends RemoteLink {
  NativeListener? _listener;
  bool ready = false;

  void _listen() {
    _listener?.cancel();
    _listener = Native.on('Cue', 'nearby', _onNative);
  }

  void _onNative(Map<String, dynamic> event);

  @override
  void send(Map<String, Object?> message) {
    if (!ready) return;
    Native.tryCall('Cue', 'nearbySend', {'data': jsonEncode(message)});
  }

  Map<String, dynamic>? _parse(Object? data) {
    try {
      final v = jsonDecode('$data');
      return v is Map ? Map<String, dynamic>.from(v) : null;
    } catch (_) {
      return null;
    }
  }

  @override
  void close() {
    ready = false;
    _listener?.cancel();
    _listener = null;
    Native.tryCall('Cue', 'nearbyStop');
    setStatus('idle');
  }
}

/// The prompter end: findable under its code, one remote at a time.
class NearbyHost extends _NearbyLink {
  String _code = '';
  Timer? _auth;

  Future<String?> start(String code) async {
    _code = code;
    ready = false;
    _listen();
    setStatus('connecting');
    Map<String, dynamic>? answer;
    try {
      answer = await Native.call('Cue', 'nearbyAdvertise', {'name': nearbyName(code)});
    } catch (_) {
      answer = {'state': 'failed'};
    }
    final state = answer?['state'] as String?;
    if (state != 'granted') {
      close();
      setStatus('error', message: describeNearbyRefusal(state));
    }
    return state;
  }

  @override
  void _onNative(Map<String, dynamic> event) {
    if (event['event'] == 'message') {
      final message = _parse(event['data']);
      if (message == null) return;
      if (!ready) {
        // The first thing a remote says is the code. Anything else, or the wrong code, and it goes.
        _auth?.cancel();
        if (message['type'] == 'auth' && message['code'] == _code) {
          ready = true;
          setStatus('connected');
        } else {
          Native.tryCall('Cue', 'nearbyDisconnect');
        }
        return;
      }
      onMessage?.call(message);
      return;
    }
    if (event['event'] != 'status') return;
    switch (event['status']) {
      case 'waiting':
        ready = false;
        setStatus('waiting');
      case 'connected':
        // Linked, but not trusted till the code arrives.
        _auth?.cancel();
        _auth = Timer(_authTimeout, () {
          if (!ready) Native.tryCall('Cue', 'nearbyDisconnect');
        });
      case 'dropped':
        // The code outlives the drop, as on the web remote: the phone may be coming back.
        ready = false;
        setStatus('waiting');
      case 'error':
        if (!ready) setStatus('error', message: 'Connecting without wifi failed. Check Bluetooth is on.');
    }
  }

  @override
  void close() {
    _auth?.cancel();
    super.close();
  }
}

/// The remote end: finds the prompter showing `code` and connects to it.
class NearbyClient extends _NearbyLink {
  String _code = '';
  Timer? _find;

  Future<void> connect(String code) async {
    _code = code;
    ready = false;
    _listen();
    setStatus('connecting');
    Map<String, dynamic>? answer;
    try {
      answer = await Native.call('Cue', 'nearbyDiscover', {'name': nearbyName(code)});
    } catch (_) {
      answer = {'state': 'failed'};
    }
    final state = answer?['state'] as String?;
    if (state != 'granted') {
      close();
      setStatus('error', message: describeNearbyRefusal(state));
      return;
    }
    _find = Timer(_findTimeout, () {
      if (ready) return;
      close();
      setStatus(
        'error',
        message:
            'Could not find that prompter nearby. Check its remote panel says it is waiting for a nearby phone, '
            'that the code is the one on screen, and that Bluetooth is on on both phones.',
      );
    });
  }

  @override
  void _onNative(Map<String, dynamic> event) {
    if (event['event'] == 'message') {
      final message = _parse(event['data']);
      if (message != null && ready) onMessage?.call(message);
      return;
    }
    if (event['event'] != 'status') return;
    switch (event['status']) {
      case 'connected':
        _find?.cancel();
        ready = true;
        // The code first, then the same hello the web remote opens with.
        send({'type': 'auth', 'code': _code});
        send({'type': 'hello'});
        setStatus('connected');
      case 'dropped':
        ready = false;
        setStatus('dropped');
      case 'error':
        if (ready) setStatus('error', message: 'The nearby connection failed.');
    }
  }

  @override
  void close() {
    _find?.cancel();
    super.close();
  }
}
