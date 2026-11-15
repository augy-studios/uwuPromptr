// What the old Electron app (1.0.0) kept for the site, read from Chromium's localStorage, which is
// LevelDB (docs/flutter-desktop-app-spec.md §12): `<settings folder>/Local Storage/leveldb/`.
// Plain Dart with no native dependency, and read only, so the old app's data is never touched.
//
//   .log   the write-ahead log: 32 KiB blocks of records (checksum, length, type: whole, first,
//          middle or last), each whole record a write batch: a sequence number, a count, then
//          puts (1, key, value) and deletions (0, key)
//   .ldb   tables: a 48-byte footer naming the index block, whose entries name the data blocks;
//          each block prefix-compresses its keys and may be Snappy-compressed. Keys carry an
//          8-byte trailer: the sequence number and whether it's a put or a deletion
//
// The highest sequence number for each key wins; deletions drop it. Keys are
// `_<origin>\x00` then `\x01` and Latin-1 bytes (or `\x00` and UTF-16LE); values start with `\x01`
// (Latin-1) or `\x00` (UTF-16LE).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

class _Entry {
  _Entry(this.seq, this.value);
  final int seq;
  final Uint8List? value; // null: deleted
}

class LevelDbReader {
  LevelDbReader(this.dir);
  final String dir;
  final Map<String, _Entry> _latest = {};

  /// The site's values in this database for `origin` ("https://cue.uwuapps.org"), by key.
  static Map<String, String> readOrigin(String dir, String origin) {
    final r = LevelDbReader(dir)..read();
    return r.values(origin);
  }

  void read() {
    final d = Directory(dir);
    if (!d.existsSync()) return;
    for (final f in d.listSync().whereType<File>()) {
      final name = f.uri.pathSegments.last;
      try {
        if (name.endsWith('.log')) {
          _readLog(f.readAsBytesSync());
        } else if (name.endsWith('.ldb') || name.endsWith('.sst')) {
          _readTable(f.readAsBytesSync());
        }
      } catch (_) {
        // A damaged file: what the others hold still counts.
      }
    }
  }

  void _put(Uint8List key, int seq, Uint8List? value) {
    final k = latin1.decode(key);
    final had = _latest[k];
    if (had == null || had.seq <= seq) _latest[k] = _Entry(seq, value);
  }

  // ---------- the log ----------

  void _readLog(Uint8List data) {
    const block = 32768;
    final record = BytesBuilder(copy: false);
    var pos = 0;
    while (pos + 7 <= data.length) {
      final left = block - (pos % block);
      if (left < 7) {
        pos += left; // the block's tail, padding
        continue;
      }
      final length = data[pos + 4] | (data[pos + 5] << 8);
      final type = data[pos + 6];
      final start = pos + 7;
      if (type == 0 && length == 0) {
        pos += left;
        continue;
      }
      if (start + length > data.length) break;
      final chunk = Uint8List.sublistView(data, start, start + length);
      switch (type) {
        case 1: // whole
          _batch(chunk);
          record.clear();
        case 2: // first
          record.clear();
          record.add(chunk);
        case 3: // middle
          record.add(chunk);
        case 4: // last
          record.add(chunk);
          _batch(record.takeBytes());
      }
      pos = start + length;
    }
  }

  void _batch(Uint8List b) {
    if (b.length < 12) return;
    final bd = ByteData.sublistView(b);
    var seq = bd.getUint32(0, Endian.little) + bd.getUint32(4, Endian.little) * 4294967296;
    final count = bd.getUint32(8, Endian.little);
    final r = _Cursor(b, 12);
    for (var i = 0; i < count && r.pos < b.length; i++) {
      final tag = b[r.pos++];
      final key = r.bytes(r.varint());
      if (tag == 1) {
        _put(key, seq, r.bytes(r.varint()));
      } else {
        _put(key, seq, null);
      }
      seq++;
    }
  }

  // ---------- tables ----------

  void _readTable(Uint8List data) {
    if (data.length < 48) return;
    final footer = _Cursor(data, data.length - 48);
    footer.varint(); // metaindex offset
    footer.varint(); // metaindex size
    final indexOffset = footer.varint();
    final indexSize = footer.varint();
    final index = _block(data, indexOffset, indexSize);
    for (final (_, handle) in _entries(index)) {
      final h = _Cursor(handle, 0);
      final off = h.varint();
      final size = h.varint();
      for (final (key, value) in _entries(_block(data, off, size))) {
        if (key.length < 8) continue;
        final trailer = ByteData.sublistView(key, key.length - 8);
        final packed = trailer.getUint32(0, Endian.little) + trailer.getUint32(4, Endian.little) * 4294967296;
        final type = packed % 256;
        final seq = packed ~/ 256;
        final user = Uint8List.sublistView(key, 0, key.length - 8);
        _put(user, seq, type == 1 ? value : null);
      }
    }
  }

  Uint8List _block(Uint8List data, int offset, int size) {
    final raw = Uint8List.sublistView(data, offset, offset + size);
    final type = data[offset + size];
    return type == 1 ? snappyDecode(raw) : raw;
  }

  Iterable<(Uint8List, Uint8List)> _entries(Uint8List block) sync* {
    if (block.length < 4) return;
    final bd = ByteData.sublistView(block);
    final restarts = bd.getUint32(block.length - 4, Endian.little);
    final end = block.length - 4 - restarts * 4;
    final r = _Cursor(block, 0);
    var last = Uint8List(0);
    while (r.pos < end) {
      final shared = r.varint();
      final unshared = r.varint();
      final valueLen = r.varint();
      final key = Uint8List(shared + unshared)
        ..setRange(0, shared, last)
        ..setRange(shared, shared + unshared, block, r.pos);
      r.pos += unshared;
      final value = r.bytes(valueLen);
      last = key;
      yield (key, value);
    }
  }

  // ---------- the site's values ----------

  Map<String, String> values(String origin) {
    final prefix = '_$origin\u0000';
    final out = <String, String>{};
    _latest.forEach((k, e) {
      final v = e.value;
      if (v == null || !k.startsWith(prefix) || k.length <= prefix.length) return;
      final keyBytes = Uint8List.fromList(latin1.encode(k.substring(prefix.length)));
      final key = _string(keyBytes);
      final value = _string(v);
      if (key != null && value != null) out[key] = value;
    });
    return out;
  }

  /// Chromium's encoding: a leading 1 for Latin-1, 0 for UTF-16LE.
  static String? _string(Uint8List b) {
    if (b.isEmpty) return null;
    if (b[0] == 1) return latin1.decode(Uint8List.sublistView(b, 1));
    if (b[0] == 0) {
      final units = <int>[];
      for (var i = 1; i + 1 < b.length; i += 2) {
        units.add(b[i] | (b[i + 1] << 8));
      }
      return String.fromCharCodes(units);
    }
    return null;
  }
}

class _Cursor {
  _Cursor(this.data, this.pos);
  final Uint8List data;
  int pos;

  int varint() {
    var result = 0;
    var shift = 0;
    while (pos < data.length) {
      final b = data[pos++];
      result += (b & 0x7f) * (1 << shift);
      if (b < 0x80) return result;
      shift += 7;
    }
    return result;
  }

  Uint8List bytes(int n) {
    final end = (pos + n).clamp(0, data.length);
    final out = Uint8List.sublistView(data, pos, end);
    pos = end;
    return out;
  }
}

/// Snappy's raw format, which LevelDB compresses blocks with.
Uint8List snappyDecode(Uint8List src) {
  final r = _Cursor(src, 0);
  final length = r.varint();
  final out = Uint8List(length);
  var o = 0;
  var p = r.pos;
  while (p < src.length && o < length) {
    final tag = src[p++];
    switch (tag & 3) {
      case 0: // a literal
        var len = tag >> 2;
        if (len >= 60) {
          final bytes = len - 59;
          len = 0;
          for (var i = 0; i < bytes; i++) {
            len |= src[p++] << (8 * i);
          }
        }
        len += 1;
        out.setRange(o, o + len, src, p);
        o += len;
        p += len;
        continue;
      case 1:
        final len = ((tag >> 2) & 7) + 4;
        final off = ((tag >> 5) << 8) | src[p++];
        o = _copy(out, o, off, len);
      case 2:
        final len = (tag >> 2) + 1;
        final off = src[p] | (src[p + 1] << 8);
        p += 2;
        o = _copy(out, o, off, len);
      case 3:
        final len = (tag >> 2) + 1;
        final off = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24);
        p += 4;
        o = _copy(out, o, off, len);
    }
  }
  return out;
}

int _copy(Uint8List out, int o, int off, int len) {
  // Byte by byte: a copy may overlap what it's writing.
  for (var i = 0; i < len; i++) {
    out[o + i] = out[o - off + i];
  }
  return o + len;
}
