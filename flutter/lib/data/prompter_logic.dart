// The prompter's arithmetic, as main-site/js/prompter.js has it, so the app scrolls at the speed
// the site does and the remote's copy of the screen keeps pace with either.

/// Speed is lines-per-minute-ish: pixels per second scale with the font size, so raising the font
/// doesn't silently slow the read.
double pixelsPerSecond(num speed, num fontSize) => speed.toDouble() * fontSize.toDouble() / 12;

/// 00:00:00, hours first.
String formatElapsed(num ms) {
  final total = (ms / 1000).floor();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(total ~/ 3600)}:${two((total % 3600) ~/ 60)}:${two(total % 60)}';
}

/// Text pasted out of a word processor arrives full of smart quotes, hard line breaks and
/// non-breaking spaces, all of which read badly at 60px. The same clean-up the site does on paste.
String cleanPastedText(String raw) => raw
    .replaceAll(RegExp(r'\r\n?'), '\n')
    .replaceAll(' ', ' ')
    .replaceAll(RegExp('[‘’‛]'), "'")
    .replaceAll(RegExp('[“”]'), '"')
    .replaceAll('…', '...')
    .replaceAll(RegExp(r'[ \t]+'), ' ')
    .replaceAll(RegExp(r'[ \t]+\n'), '\n')
    .replaceAll(RegExp(r'\n{3,}'), '\n\n')
    .trim();
