// The app's two pages, as the site's two documents (index.html and remote.html): the prompter
// and the remote. Both are kept (an IndexedStack), so switching back keeps each one's place, and a
// remote stays connected while you look at the prompter. Tours and bug reports read which is on
// show; links and the desktop's title bar switch between them.
import 'dart:async';

import 'package:flutter/foundation.dart';

class AppPages {
  AppPages._();

  static const prompter = 'prompter';
  static const remote = 'remote';
  static const all = [prompter, remote];

  static final ValueNotifier<String> current = ValueNotifier(prompter);
  static final StreamController<String> _changes = StreamController.broadcast();

  /// A page switch, after it's happened (the site's `pagechange`).
  static Stream<String> get changes => _changes.stream;

  static String active() => current.value;

  static void open(String id) {
    if (!all.contains(id) || current.value == id) return;
    current.value = id;
    _changes.add(id);
  }

  /// Something on the page changed that a tour might want (a window opened or closed).
  static void poke() => _changes.add(current.value);
}
