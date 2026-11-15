// Remote ids, as main-site/js/remote.js and nearby.js make and read them, so an id shown by the
// app works typed into the site's remote, and the other way round.
import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';

/// No vowels and no 0/O/1/I, so a code read aloud can't be misheard or spell anything.
const codeAlphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
const codeLength = 6;

/// A namespace on PeerJS's public broker, so six characters can't collide with anybody else's.
const peerPrefix = 'uwupromptr-';

String generateCode() {
  final r = math.Random.secure();
  return List.generate(codeLength, (_) => codeAlphabet[r.nextInt(256) % codeAlphabet.length]).join();
}

String normaliseCode(String? input) {
  final s = (input ?? '').toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
  return s.length > codeLength ? s.substring(0, codeLength) : s;
}

bool isValidCode(String? input) {
  final code = normaliseCode(input);
  return code.length == codeLength && code.split('').every(codeAlphabet.contains);
}

/// The name a prompter advertises under for `code` over Nearby Connections: a hash of it, so the
/// id itself never goes out over the air.
String nearbyName(String code) {
  final hash = sha256.convert(utf8.encode('uwupromptr-nearby:$code')).bytes;
  return 'cue-${hash.take(8).map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
}

/// The address the QR and Copy link hand over: the site's remote page, which opens the app's
/// remote where the app is installed.
String remoteUrl(String code) => 'https://cue.uwuapps.org/remote?id=$code';
