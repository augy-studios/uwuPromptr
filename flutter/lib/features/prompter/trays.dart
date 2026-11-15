// The prompter's three Edge Trays (docs/edge-tray-spec.md, main-site/js/edge-tray.js): the top
// bar, the transport at the bottom, and the side column at the left or right edge. Each slides
// off its edge leaving a tab, and each is remembered under the site's keys. While a tray is open
// the script keeps clear of it; put away, the script takes the room.
import 'package:flutter/foundation.dart';

import '../../data/store.dart';

class Trays extends ChangeNotifier {
  Trays._();
  static final Trays I = Trays._();

  static const _top = 'uwupromptr.topTrayOpen';
  static const _bottom = 'uwupromptr.bottomTrayOpen';
  static const _side = 'uwupromptr.trayOpen';
  static const _sideEdge = 'uwupromptr.traySide';

  bool get top => Store.I.get(_top) != '0';
  bool get bottom => Store.I.get(_bottom) != '0';
  bool get side => Store.I.get(_side) != '0';

  /// 'left' or 'right' (the default).
  String get edge => Store.I.get(_sideEdge) == 'left' ? 'left' : 'right';
  bool get left => edge == 'left';

  void toggle(String which) {
    final key = switch (which) {
      'top' => _top,
      'bottom' => _bottom,
      _ => _side,
    };
    final open = Store.I.get(key) != '0';
    Store.I.put(key, open ? '0' : '1');
    notifyListeners();
  }

  void setEdge(String side) {
    Store.I.put(_sideEdge, side == 'left' ? 'left' : 'right');
    notifyListeners();
  }
}
