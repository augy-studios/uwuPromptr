// The logic ported from the site (main-site/js/storage.js, prompter.js, remote.js, nearby.js,
// watch.js) gives the site's answers, and the old Electron app's storage reads back as it was.
// The expected values were worked out by running the site's own JavaScript.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uwupromptr/app/links.dart';
import 'package:uwupromptr/data/prompter_logic.dart';
import 'package:uwupromptr/data/scripts.dart';
import 'package:uwupromptr/desktop/glance.dart';
import 'package:uwupromptr/theme/icons.dart';
import 'package:uwupromptr/desktop/leveldb.dart';
import 'package:uwupromptr/remote/codes.dart';
import 'package:uwupromptr/remote/watch.dart';

void main() {
  // Every icon the app asks for by name, directly or through a helper that takes one (a welcome row,
  // a title bar tool, a command bar hit, a tray extra): an unknown name draws nothing.
  test('every icon named in lib/ is in lib/theme/icons.dart', () {
    final direct = RegExp(
      r"(?:AppIcon\(|icon: |row\(|tool\(|_Hit\()'([a-z0-9-]+)'",
    );
    final tray = RegExp(r"TrayExtra\('[a-z0-9-]+', '([a-z0-9-]+)'");
    final missing = <String>{};
    for (final f
        in Directory('lib')
            .listSync(recursive: true)
            .whereType<File>()
            .where((f) => f.path.endsWith('.dart'))) {
      final src = f.readAsStringSync();
      for (final m in [...direct.allMatches(src), ...tray.allMatches(src)]) {
        if (!hasIcon(m.group(1)!)) missing.add('${m.group(1)} (${f.path})');
      }
    }
    expect(missing, isEmpty);
  });

  group('settings, as storage.js has them', () {
    test('clamped to their ranges and rounded to their steps', () {
      expect(clampSetting('speed', 12.349999), 12.3);
      expect(clampSetting('lineHeight', 1.4499999), 1.45);
      expect(clampSetting('fontSize', 300), 200);
      expect(clampSetting('speed', 0), 0.1);
      expect(clampSetting('margin', -4), 0);
      expect(clampSetting('focusPosition', 95), 80);
    });

    test('the defaults, whole numbers written as the site writes them', () {
      expect(
        jsonEncode(defaultSettings()),
        '{"fontSize":60,"speed":12,"lineHeight":1.4,"margin":8,"focusPosition":40,"flipX":false,"flipY":false,"focusLine":true,"timer":true}',
      );
    });

    test('shown as the site shows them', () {
      expect(formatSetting('speed', 12), '12.0');
      expect(formatSetting('lineHeight', 1.4), '1.40');
      expect(formatSetting('fontSize', 60), '60');
    });

    test('word counts and previews, as the scripts menu has them', () {
      expect(Scripts.wordCount('  one two\nthree  '), 3);
      expect(Scripts.wordCount('   '), 0);
      expect(Scripts.preview('\nFirst line\nsecond'), 'First line');
      expect(Scripts.preview(''), 'Empty');
    });
  });

  group('the prompter, as prompter.js has it', () {
    test('speed scales with the font', () {
      expect(pixelsPerSecond(12, 60), 60);
      expect(pixelsPerSecond(6, 120), 60);
    });

    test('the clock', () {
      expect(formatElapsed(3723456), '01:02:03');
      expect(formatElapsed(0), '00:00:00');
    });

    test('pasted text cleaned', () {
      expect(
        cleanPastedText('“Hi”\r\n\r\n\r\n‘there’…  ok \t\nend'),
        '"Hi"\n\n\'there\'... ok\nend',
      );
    });
  });

  group('remote ids, as remote.js and nearby.js make them', () {
    test('made of the site\'s letters, six long', () {
      for (var i = 0; i < 200; i++) {
        final c = generateCode();
        expect(isValidCode(c), isTrue, reason: c);
      }
    });

    test('read as typed', () {
      expect(normaliseCode(' bc-df 23x '), 'BCDF23');
      expect(isValidCode('bcdf23'), isTrue);
      // No vowels, no 0, O, 1 or I.
      expect(isValidCode('ABCD23'), isFalse);
      expect(isValidCode('BCDF2'), isFalse);
    });

    test('the nearby name is the site\'s hash, never the id', () {
      expect(nearbyName('BCDF23'), 'cue-524768c57abc9920');
    });
  });

  group('links', () {
    test('the site\'s and the app\'s own', () {
      expect(parseLink('https://cue.uwuapps.org/'), isA<LinkPrompter>());
      expect(
        (parseLink(
          'https://cue.uwuapps.org/remote?id=bcdf23',
        ) as LinkRemote).code,
        'BCDF23',
      );
      expect(
        (parseLink(
          'https://cue.uwuapps.org/remote.html?id=BCDF23',
        ) as LinkRemote).code,
        'BCDF23',
      );
      expect(
        (parseLink('uwu://cue/remote?id=nonsense') as LinkRemote).code,
        isNull,
      );
      expect((parseLink('uwu://cue/s/sabc123') as LinkScript).id, 'sabc123');
      expect(parseLink('uwu://cue/updates'), isA<LinkUpdates>());
      expect(parseLink('uwu://cue/watch'), isA<LinkNothing>());
      expect(parseLink('uwu://cue/new'), isA<LinkNewScript>());
      expect(parseLink('/remote?id=BCDF23'), isA<LinkRemote>());
      // Another app's, and odd characters in a path, aren't this app's.
      expect(parseLink('uwu://board/b/1'), isNull);
      expect(parseLink('uwu://cue/s/<script>'), isNull);
      expect(parseLink('https://example.org/'), isA<LinkOut>());
    });
  });

  group('the watch, as watch.js checks it', () {
    test('only play, pause, reset and the speed', () {
      expect(Watch.checked({'type': 'command', 'name': 'toggle'}), {
        'type': 'command',
        'name': 'toggle',
      });
      expect(
        Watch.checked({
          'type': 'command',
          'name': 'nudge',
          'setting': 'speed',
          'value': 5,
        }),
        {
          'type': 'command',
          'name': 'nudge',
          'setting': 'speed',
          'value': 1,
          'coarse': false,
        },
      );
      expect(
        Watch.checked({
          'type': 'command',
          'name': 'set',
          'setting': 'fontSize',
          'value': 120,
        }),
        isNull,
      );
      expect(Watch.checked({'type': 'command', 'name': 'edit'}), isNull);
    });
  });

  test('the tray countdown, cut to Windows\' 127 characters', () {
    final t = trayText(
      name: 'A' * 200,
      playing: true,
      elapsed: 61000,
      progress: 42.4,
    );
    expect(t.length, 127);
    expect(t.endsWith('…'), isTrue);
    expect(
      trayText(name: 'Talk', playing: false, elapsed: 61000, progress: 42.4),
      'Talk\nPaused · 00:01:01 · 42%',
    );
  });

  group('the Electron app\'s storage (leveldb.dart)', () {
    test('a write-ahead log: the newest put wins, a deletion drops it, other origins ignored', () {
      final dir = Directory.systemTemp.createTempSync('uwupromptr-ldb');
      addTearDown(() => dir.deleteSync(recursive: true));
      Uint8List key(String origin, String k) => Uint8List.fromList([
        ...latin1.encode('_$origin'),
        0,
        1,
        ...latin1.encode(k),
      ]);
      Uint8List latin(String v) => Uint8List.fromList([1, ...latin1.encode(v)]);
      Uint8List utf16(String v) {
        final b = <int>[0];
        for (final u in v.codeUnits) {
          b.addAll([u & 0xff, u >> 8]);
        }
        return Uint8List.fromList(b);
      }

      const site = 'https://cue.uwuapps.org';
      final log = _log([
        _batch(1, [
          (key(site, 'uwupromptr.mode'), latin('light')),
          (key(site, 'uwupromptr.colorTheme'), latin('classic')),
          (key('https://other.example', 'uwupromptr.mode'), latin('nope')),
        ]),
        _batch(4, [
          (key(site, 'uwupromptr.mode'), latin('dark')),
          (key(site, 'uwupromptr.scripts'), utf16('[{"name":"Café ☕"}]')),
          (key(site, 'uwupromptr.colorTheme'), null),
        ]),
      ]);
      File('${dir.path}/000003.log').writeAsBytesSync(log);
      final v = LevelDbReader.readOrigin(dir.path, site);
      expect(v, {
        'uwupromptr.mode': 'dark',
        'uwupromptr.scripts': '[{"name":"Café ☕"}]',
      });
    });

    test('Snappy, with a copy that overlaps what it writes', () {
      // "abcabcabcabc": a literal "abc", then a copy of 9 from 3 back.
      final compressed = Uint8List.fromList([
        12,
        0x08,
        0x61,
        0x62,
        0x63,
        0x15,
        0x03,
      ]);
      expect(latin1.decode(snappyDecode(compressed)), 'abcabcabcabc');
    });
  });
}

/// A LevelDB write batch: its sequence number, its count, then puts (1) and deletions (0).
Uint8List _batch(int seq, List<(Uint8List, Uint8List?)> ops) {
  final b = BytesBuilder();
  final head = ByteData(12)
    ..setUint32(0, seq, Endian.little)
    ..setUint32(4, 0, Endian.little)
    ..setUint32(8, ops.length, Endian.little);
  b.add(head.buffer.asUint8List());
  void varint(int n) {
    while (n >= 0x80) {
      b.addByte((n & 0x7f) | 0x80);
      n >>= 7;
    }
    b.addByte(n);
  }

  for (final (k, v) in ops) {
    b.addByte(v == null ? 0 : 1);
    varint(k.length);
    b.add(k);
    if (v != null) {
      varint(v.length);
      b.add(v);
    }
  }
  return b.toBytes();
}

/// A log file: each batch a whole record (type 1), its checksum left as zeros (not checked).
Uint8List _log(List<Uint8List> batches) {
  final b = BytesBuilder();
  for (final r in batches) {
    b.add([0, 0, 0, 0, r.length & 0xff, r.length >> 8, 1]);
    b.add(r);
  }
  return b.toBytes();
}
