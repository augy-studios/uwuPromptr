// The theme, built in one place for both looks and both modes.
//
//   The UwU Apps look   the site's own (main-site/css/theme.css and js/theme.js): seven brand
//                       swatches, the Jua font, flat tinted pages and glass panels.
//   Material You        the device's palette and fonts, on Android only. On by default on
//                       Android 12+, where the system has a palette to give.
//   Glass               the desktop's own see-through look, after iOS's Liquid Glass, in each
//                       system's own words: Fluent 2 (Mica behind the window, Acrylic panels) on
//                       Windows, macOS Tahoe's translucent window and glass panels on macOS, and
//                       Deepin (DDE) and COSMIC's frosted glass on Linux. The system's accent and
//                       font; the window itself see-through where the system allows it
//                       (lib/desktop/backdrop.dart), drawn frosted by the app where it doesn't.
//                       The desktop apps default to the UwU Apps look, and can borrow the
//                       system's accent colour for it instead.
//
// Mode is the site's: light, dark, or time-based (light from 09:00 to 18:00), kept under the
// site's keys so a theme brought over from the old app means the same here. Colours reach widgets as
// tokens (UwuColors), never as literals.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../data/store.dart';

class ColorTheme {
  const ColorTheme(this.id, this.label, this.hex);
  final String id;
  final String label;
  final int hex;
  Color get color => Color(0xFF000000 | hex);
}

/// The site's swatches, by the site's ids and names.
const colorThemes = [
  ColorTheme('classic', 'Classic', 0xccffcc),
  ColorTheme('not-green-1', 'Not green 1', 0xffcccc),
  ColorTheme('not-green-2', 'Not green 2', 0xccccff),
  ColorTheme('not-green-3', 'Not green 3', 0xffffcc),
  ColorTheme('not-green-4', 'Not green 4', 0xffccff),
  ColorTheme('not-green-5', 'Not green 5', 0xccffff),
  ColorTheme('really-light-green', 'Really really light green', 0xffffff),
];

const modePreferences = ['light', 'dark', 'time'];
const lightFromHour = 9;
const lightUntilHour = 18;

const _keyColor = 'uwupromptr.colorTheme';
const _keyMode = 'uwupromptr.mode';

/// The app's own key: which look, 'material', 'glass' or 'uwuapps'. Unset follows the platform.
/// Material You is the phone's; glass is the desktop's. Each reads the other's as its own, so a
/// look picked on one before the other existed still means "the system's look".
const keyLook = 'app.look';
const lookMaterial = 'material';
const lookGlass = 'glass';
const lookUwuApps = 'uwuapps';

/// Which system's glass the desktop's glass look follows.
enum GlassFlavor {
  /// Windows: Fluent 2, Mica behind the window and Acrylic on what floats over it.
  fluent,

  /// macOS: Tahoe's translucent window and Liquid Glass panels and capsule buttons.
  tahoe,

  /// Linux: Deepin (DDE) and COSMIC's frosted glass.
  frosted;

  /// The look's name in the Theme window.
  String get label => switch (this) {
    GlassFlavor.fluent => 'Fluent 2',
    GlassFlavor.tahoe => 'macOS Tahoe',
    GlassFlavor.frosted => 'Deepin & COSMIC',
  };

  /// What it is, under the Look buttons.
  String get about => switch (this) {
    GlassFlavor.fluent => 'Fluent 2: Mica behind the window, Acrylic panels over it, and your accent colour.',
    GlassFlavor.tahoe => 'macOS Tahoe: a see-through window, Liquid Glass panels and buttons, and your accent colour.',
    GlassFlavor.frosted => 'Deepin (DDE) and COSMIC frosted glass: a see-through, blurred window, and your accent colour.',
  };

  static GlassFlavor get platform => switch (defaultTargetPlatform) {
    TargetPlatform.windows => GlassFlavor.fluent,
    TargetPlatform.macOS || TargetPlatform.iOS => GlassFlavor.tahoe,
    _ => GlassFlavor.frosted,
  };
}

/// What the window behind the app gives the glass look (lib/desktop/backdrop.dart).
enum Backdrop {
  /// Nothing: the window is solid, so the app draws its own frost.
  none,

  /// See-through, but not blurred (a compositor without blur): the app frosts it heavily.
  clear,

  /// See-through and blurred by the system: Mica, macOS's vibrancy, KWin's or COSMIC's blur.
  blurred,
}

bool isDaylightHours([DateTime? now]) {
  final h = (now ?? DateTime.now()).hour;
  return h >= lightFromHour && h < lightUntilHour;
}

String resolveMode(String preference, [DateTime? now]) {
  if (preference == 'time') return isDaylightHours(now) ? 'light' : 'dark';
  return preference == 'dark' ? 'dark' : 'light';
}

/// How long until the next 09:00 or 18:00, whichever comes first, with a second of slack.
Duration untilNextBoundary([DateTime? at]) {
  final now = at ?? DateTime.now();
  DateTime next;
  if (now.hour < lightFromHour) {
    next = DateTime(now.year, now.month, now.day, lightFromHour);
  } else if (now.hour < lightUntilHour) {
    next = DateTime(now.year, now.month, now.day, lightUntilHour);
  } else {
    next = DateTime(now.year, now.month, now.day + 1, lightFromHour);
  }
  final ms = next.difference(now).inMilliseconds + 1000;
  return Duration(milliseconds: ms < 1000 ? 1000 : ms);
}

class ThemeController extends ChangeNotifier with WidgetsBindingObserver {
  ThemeController._();
  static final ThemeController I = ThemeController._();

  Timer? _timer;
  bool _watching = false;

  /// Whether the device has a palette of its own to give (Android 12+). Set by the app's root
  /// once the system has answered.
  bool hasDynamic = false;

  /// The desktop's "Use system accent colour", kept in its settings file.
  bool systemAccent = false;

  /// Whether this is the Android app (Env.android, given here to keep the theme free of the app).
  static bool Function() isAndroid = () => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Whether this is a desktop app (Env.desktop, likewise): its second look is glass, not
  /// Material You.
  static bool Function() isDesktop = () =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.windows || defaultTargetPlatform == TargetPlatform.macOS || defaultTargetPlatform == TargetPlatform.linux);

  /// The desktop's system glass for this platform. Tests and screenshots set it.
  GlassFlavor glassFlavor = GlassFlavor.platform;

  /// What the window gives the glass look right now. Set by the desktop layer.
  Backdrop backdrop = Backdrop.none;

  /// For tests and screenshots: the clock the time-based mode reads.
  DateTime Function() clock = DateTime.now;

  void init() {
    _schedule();
    if (!_watching) {
      _watching = true;
      WidgetsBinding.instance.addObserver(this);
    }
  }

  String get colorThemeId {
    final v = Store.I.get(_keyColor);
    return colorThemes.any((t) => t.id == v) ? v! : 'classic';
  }

  ColorTheme get colorTheme => colorThemes.firstWhere((t) => t.id == colorThemeId);

  /// What the person chose, which can be "time".
  String get modePreference {
    final v = Store.I.get(_keyMode);
    return modePreferences.contains(v) ? v! : 'light';
  }

  /// What the app is in right now: only ever light or dark.
  String get mode => resolveMode(modePreference, clock());
  Brightness get brightness => mode == 'dark' ? Brightness.dark : Brightness.light;

  String get look {
    final v = Store.I.get(keyLook);
    if (isDesktop()) return v == lookGlass || v == lookMaterial ? lookGlass : lookUwuApps;
    if (v == lookMaterial || v == lookGlass) return lookMaterial;
    if (v == lookUwuApps) return v!;
    return isAndroid() && hasDynamic ? lookMaterial : lookUwuApps;
  }

  bool get isMaterial => look == lookMaterial;
  bool get isGlass => look == lookGlass;

  /// The system's look on this platform: Material You on a phone, glass on a computer.
  String get systemLook => isDesktop() ? lookGlass : lookMaterial;

  void setColorTheme(String id) {
    if (!colorThemes.any((t) => t.id == id)) return;
    Store.I.put(_keyColor, id);
    notifyListeners();
  }

  void setMode(String preference) {
    Store.I.put(_keyMode, modePreferences.contains(preference) ? preference : 'light');
    _schedule();
    notifyListeners();
  }

  void setLook(String look) {
    Store.I.put(keyLook, look == lookMaterial || look == lookGlass ? look : lookUwuApps);
    notifyListeners();
  }

  void setBackdrop(Backdrop b) {
    if (backdrop == b) return;
    backdrop = b;
    notifyListeners();
  }

  void setSystemAccent(bool on) {
    systemAccent = on;
    notifyListeners();
  }

  void setHasDynamic(bool has) {
    if (hasDynamic == has) return;
    hasDynamic = has;
    // After this frame: it's learnt while building.
    scheduleMicrotask(notifyListeners);
  }

  /// Something else changed the stored theme (a sync, the welcome window).
  void refresh() {
    _schedule();
    notifyListeners();
  }

  // Keeping the time-based mode honest while the app stays open.
  void _schedule() {
    _timer?.cancel();
    _timer = null;
    if (modePreference != 'time') return;
    _timer = Timer(untilNextBoundary(clock()), () {
      _schedule();
      notifyListeners();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && modePreference == 'time') {
      _schedule();
      notifyListeners();
    }
  }
}

/// The colours widgets draw with, by what they're for.
@immutable
class UwuColors extends ThemeExtension<UwuColors> {
  const UwuColors({
    required this.bg,
    required this.surface,
    required this.surfaceStrong,
    required this.border,
    required this.ink,
    required this.muted,
    required this.brand,
    required this.brandInk,
    required this.brandFill,
    required this.brandFillStrong,
    required this.onBrand,
    required this.ok,
    required this.warn,
    required this.busy,
    required this.error,
    required this.errorFill,
    required this.scrim,
    required this.glass,
    this.flavor,
    this.solidBg,
  });

  final Color bg;
  final Color surface;
  final Color surfaceStrong;
  final Color border;
  final Color ink;
  final Color muted;
  final Color brand;
  final Color brandInk;
  final Color brandFill;
  final Color brandFillStrong;
  final Color onBrand;
  final Color ok;
  final Color warn;
  final Color busy;
  final Color error;
  final Color errorFill;
  final Color scrim;

  /// Whether panels are glass (blurred, see-through) or solid.
  final bool glass;

  /// In the desktop's glass look, which system's glass; null in the other looks.
  final GlassFlavor? flavor;

  /// The desktop's glass look: see-through panels with a lit rim, over the system's own glass.
  bool get liquid => flavor != null;

  /// The page's colour where it's see-through (the glass look), made solid.
  final Color? solidBg;

  /// The page made solid, for what must never show through: menus, the editor, words on ink.
  Color get paper => solidBg ?? bg;

  /// A line between areas, not round a control: in the glass look a faint hairline, as the
  /// systems' own glass has; elsewhere the edge colour.
  Color get separator => !liquid ? border : (ink.computeLuminance() > 0.5 ? Colors.white.withValues(alpha: 0.12) : Colors.black.withValues(alpha: 0.10));

  static UwuColors of(BuildContext context) => Theme.of(context).extension<UwuColors>()!;

  @override
  UwuColors copyWith() => this;

  @override
  UwuColors lerp(ThemeExtension<UwuColors>? other, double t) => t < 0.5 || other is! UwuColors ? this : other;
}

Color _mix(Color a, double amount, Color b) => Color.lerp(b, a, amount)!;

const _ink = Color(0xFF121815);

/// The site's tokens, for one swatch and mode.
UwuColors uwuAppsColors(Color brand, Brightness brightness, {Color? accent}) {
  final dark = brightness == Brightness.dark;
  final base = dark ? const Color(0xFF0C100E) : const Color(0xFFEEF2F0);
  final bg = _mix(brand, 0.10, base);
  // The site's surfaces are white at an opacity over the page. Here they're laid over the page
  // colour once, so words on them keep the contrast the site measured.
  Color over(double a) => Color.alphaBlend(Colors.white.withValues(alpha: a), bg);
  final surface = over(dark ? 0.06 : 0.55);
  final surfaceStrong = over(dark ? 0.11 : 0.78);
  var brandInk = dark ? const Color(0xFFBFF5CF) : const Color(0xFF1F6B3D);
  if (accent != null) {
    final hsl = HSLColor.fromColor(accent);
    brandInk = hsl.withLightness(dark ? 0.82 : 0.28).withSaturation(hsl.saturation.clamp(0.3, 0.75)).toColor();
  }
  final tint = accent == null ? brand : HSLColor.fromColor(accent).withLightness(0.88).toColor();
  final error = dark ? const Color(0xFFFA9696) : const Color(0xFFB91C1C);
  return UwuColors(
    bg: bg,
    surface: surface,
    surfaceStrong: surfaceStrong,
    // Component edges at 3:1 or more against every surface, for all seven brand colours (WCAG
    // 1.4.11): the site's white-on-white glass edges vanish in light mode.
    border: dark ? const Color(0xFF84938A) : const Color(0xFF6F7E75),
    ink: dark ? const Color(0xFFEEF2EF) : _ink,
    muted: dark ? const Color(0xFFB4BEB8) : const Color(0xFF4A554E),
    brand: tint,
    brandInk: brandInk,
    brandFill: _mix(tint, 0.55, surfaceStrong),
    brandFillStrong: _mix(tint, 0.75, surfaceStrong),
    onBrand: _ink,
    ok: dark ? const Color(0xFF4ADE80) : const Color(0xFF0F7234),
    warn: dark ? const Color(0xFFFBBF24) : const Color(0xFFA24B08),
    busy: dark ? const Color(0xFF94A3B8) : const Color(0xFF627288),
    error: error,
    errorFill: _mix(error, 0.14, bg),
    scrim: Colors.black.withValues(alpha: dark ? 0.6 : 0.35),
    glass: true,
  );
}

/// The same tokens from a Material colour scheme.
UwuColors materialColors(ColorScheme s) {
  final dark = s.brightness == Brightness.dark;
  return UwuColors(
    bg: s.surface,
    surface: s.surfaceContainerLow,
    surfaceStrong: s.surfaceContainerHigh,
    // outline, not outlineVariant: Material's outline is the one made for 3:1 edges (WCAG 1.4.11).
    border: s.outline,
    ink: s.onSurface,
    muted: s.onSurfaceVariant,
    brand: s.primaryContainer,
    brandInk: s.primary,
    brandFill: s.primaryContainer,
    brandFillStrong: _mix(s.primary, 0.18, s.primaryContainer),
    onBrand: s.onPrimaryContainer,
    ok: dark ? const Color(0xFF7DDC9A) : const Color(0xFF0F7234),
    warn: dark ? const Color(0xFFFBBF24) : const Color(0xFFA24B08),
    busy: s.onSurfaceVariant,
    error: s.error,
    errorFill: s.errorContainer,
    scrim: s.scrim.withValues(alpha: dark ? 0.6 : 0.4),
    glass: false,
  );
}

/// The desktop's glass look, for one accent, mode, system and window. Surfaces stay see-through
/// here (GlassPanel blurs what's behind them); the page is as see-through as the window behind it
/// allows: clear over Mica and macOS's vibrancy, tinted over a compositor's blur, and solid where
/// the window can't be seen through, so words keep their contrast whatever's behind.
UwuColors glassColors(Color accent, Brightness brightness, {required GlassFlavor flavor, Backdrop backdrop = Backdrop.none}) {
  final dark = brightness == Brightness.dark;
  // Each system's own window colour: Windows 11's Mica fallback, macOS's grouped background,
  // DDE and COSMIC's frosted greys.
  final base = switch (flavor) {
    GlassFlavor.fluent => dark ? const Color(0xFF202020) : const Color(0xFFF3F3F3),
    GlassFlavor.tahoe => dark ? const Color(0xFF1C1C1E) : const Color(0xFFF2F2F7),
    GlassFlavor.frosted => dark ? const Color(0xFF1B1D22) : const Color(0xFFF0F2F5),
  };
  final pageAlpha = switch (backdrop) {
    Backdrop.blurred => switch (flavor) {
      GlassFlavor.fluent => 0.0,
      GlassFlavor.tahoe => dark ? 0.30 : 0.22,
      GlassFlavor.frosted => dark ? 0.55 : 0.45,
    },
    Backdrop.clear => 0.90,
    Backdrop.none => 1.0,
  };
  final bg = base.withValues(alpha: pageAlpha);
  // What a surface ends up over, for the contrast of what's on it.
  final under = Color.alphaBlend(bg, base);
  final surface = Colors.white.withValues(alpha: dark ? 0.07 : 0.55);
  final surfaceStrong = Colors.white.withValues(alpha: dark ? 0.12 : 0.78);
  final hsl = HSLColor.fromColor(accent);
  final sat = hsl.saturation.clamp(0.35, 0.9);
  final brandInk = hsl.withSaturation(sat).withLightness(dark ? 0.76 : 0.36).toColor();
  final brandFill = hsl.withSaturation(sat).withLightness(dark ? 0.62 : 0.46).toColor();
  final brandFillStrong = hsl.withSaturation(sat).withLightness(dark ? 0.68 : 0.40).toColor();
  // Whichever of white and near-black reads better on the accent.
  double contrast(Color a, Color b) {
    final la = a.computeLuminance(), lb = b.computeLuminance();
    return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
  }

  final onBrand = contrast(Colors.white, brandFill) >= contrast(_ink, brandFill) ? Colors.white : _ink;
  final error = dark ? const Color(0xFFFF8A80) : const Color(0xFFC42B1C);
  return UwuColors(
    bg: bg,
    surface: surface,
    surfaceStrong: surfaceStrong,
    // Component edges still at 3:1 or more (WCAG 1.4.11): fields and buttons keep a real edge;
    // the panels' own lit rims are drawn by GlassPanel on top.
    border: dark ? const Color(0xFF8B8E96) : const Color(0xFF767880),
    ink: dark ? const Color(0xFFF5F5F7) : const Color(0xFF1C1C1E),
    muted: dark ? const Color(0xFFB8BAC2) : const Color(0xFF55575E),
    brand: hsl.withLightness(dark ? 0.30 : 0.88).toColor(),
    brandInk: brandInk,
    brandFill: brandFill,
    brandFillStrong: brandFillStrong,
    onBrand: onBrand,
    ok: dark ? const Color(0xFF6CCB5F) : const Color(0xFF0F7B0F),
    warn: dark ? const Color(0xFFFCE100) : const Color(0xFF9D5D00),
    busy: dark ? const Color(0xFFA0A3AB) : const Color(0xFF62656C),
    error: error,
    errorFill: _mix(error, 0.16, under),
    scrim: Colors.black.withValues(alpha: dark ? 0.45 : 0.22),
    glass: true,
    flavor: flavor,
    solidBg: under,
  );
}

/// The whole theme. `dynamicScheme` is the device's palette (Material You), or the desktop's
/// accent as a scheme, when there is one. The glass look takes its accent from `dynamicScheme`
/// too, and `glassFlavor` and `backdrop` say whose glass and what the window gives it.
ThemeData buildTheme({
  required String look,
  required Brightness brightness,
  required Color brand,
  ColorScheme? dynamicScheme,
  bool systemAccent = false,
  bool highContrast = false,
  bool desktop = false,
  GlassFlavor? glassFlavor,
  Backdrop backdrop = Backdrop.none,
}) {
  final material = look == lookMaterial;
  final glass = look == lookGlass;
  final flavor = glass ? (glassFlavor ?? GlassFlavor.platform) : null;
  late final ColorScheme scheme;
  late final UwuColors colors;
  if (material) {
    scheme = (dynamicScheme ?? ColorScheme.fromSeed(seedColor: const Color(0xFF22A85A), brightness: brightness, contrastLevel: highContrast ? 1.0 : 0.0))
        .copyWith(brightness: brightness);
    colors = materialColors(scheme);
  } else if (glass) {
    colors = glassColors(dynamicScheme?.primary ?? const Color(0xFF0A84FF), brightness, flavor: flavor!, backdrop: backdrop);
    // Menus, tooltips and anything else Material paints itself sit on something solid: the
    // see-through page is only for what the app draws.
    final dark = brightness == Brightness.dark;
    final solid = Color.alphaBlend(colors.bg, dark ? const Color(0xFF1C1C1E) : const Color(0xFFF3F3F3)).withValues(alpha: 1);
    Color over(double a) => Color.alphaBlend(Colors.white.withValues(alpha: a), solid);
    scheme = ColorScheme.fromSeed(seedColor: colors.brandFill, brightness: brightness, contrastLevel: highContrast ? 1.0 : 0.0).copyWith(
      primary: colors.brandInk,
      onPrimary: dark ? const Color(0xFF1C1C1E) : Colors.white,
      primaryContainer: colors.brandFill,
      onPrimaryContainer: colors.onBrand,
      secondaryContainer: colors.brandFill,
      onSecondaryContainer: colors.onBrand,
      surface: solid,
      onSurface: colors.ink,
      onSurfaceVariant: colors.muted,
      surfaceContainerLowest: solid,
      surfaceContainerLow: over(dark ? 0.05 : 0.4),
      surfaceContainer: over(dark ? 0.07 : 0.55),
      surfaceContainerHigh: over(dark ? 0.10 : 0.75),
      surfaceContainerHighest: over(dark ? 0.13 : 0.9),
      outline: colors.muted,
      outlineVariant: colors.border,
      error: colors.error,
      onError: Colors.white,
      errorContainer: colors.errorFill,
      onErrorContainer: colors.error,
    );
  } else {
    colors = uwuAppsColors(brand, brightness, accent: systemAccent ? dynamicScheme?.primary : null);
    scheme = ColorScheme.fromSeed(seedColor: colors.brandInk, brightness: brightness).copyWith(
      primary: colors.brandInk,
      onPrimary: colors.bg,
      primaryContainer: colors.brandFill,
      onPrimaryContainer: colors.onBrand,
      secondaryContainer: colors.brandFill,
      onSecondaryContainer: colors.onBrand,
      surface: colors.bg,
      onSurface: colors.ink,
      onSurfaceVariant: colors.muted,
      surfaceContainerLowest: colors.bg,
      surfaceContainerLow: colors.surface,
      surfaceContainer: colors.surface,
      surfaceContainerHigh: colors.surfaceStrong,
      surfaceContainerHighest: colors.surfaceStrong,
      outline: colors.muted,
      outlineVariant: colors.border,
      error: colors.error,
      onError: colors.bg,
      errorContainer: colors.errorFill,
      onErrorContainer: colors.error,
    );
  }

  // Each look's corners: the UwU Apps look's 10, Material's 14; Fluent 2's small, square-ish
  // ones, macOS Tahoe's round ones with capsule buttons, and DDE and COSMIC's in between.
  final controlRadius = switch (flavor) {
    GlassFlavor.fluent => 6.0,
    GlassFlavor.tahoe => 12.0,
    GlassFlavor.frosted => 10.0,
    null => material ? 14.0 : 10.0,
  };
  final windowRadius = switch (flavor) {
    GlassFlavor.fluent => 12.0,
    GlassFlavor.tahoe => 26.0,
    GlassFlavor.frosted => 18.0,
    null => material ? 28.0 : 18.0,
  };
  final radius = BorderRadius.circular(controlRadius);
  final OutlinedBorder buttonShape = flavor == GlassFlavor.tahoe
      ? const StadiumBorder()
      : RoundedRectangleBorder(borderRadius: radius);
  // The font: the site's Jua in the UwU Apps look, else the system's own (Segoe UI Variable on
  // Windows 11, San Francisco on macOS, the desktop's sans on Linux).
  final String? font = material || glass ? null : 'Jua';
  final List<String>? fontFallback = flavor == GlassFlavor.fluent ? const ['Segoe UI Variable Text', 'Segoe UI'] : null;
  final String? glassFont = flavor == GlassFlavor.fluent ? 'Segoe UI Variable Text' : null;
  final family = font ?? glassFont;
  final system = material || glass;
  // The pointing hand over anything that can be pressed, as on the website. Flutter shows it only
  // on the web by itself (WidgetStateMouseCursor.adaptiveClickable); disabled controls keep the arrow.
  const hand = WidgetStateMouseCursor.clickable;
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    brightness: brightness,
    fontFamily: family,
    fontFamilyFallback: fontFallback,
    scaffoldBackgroundColor: colors.bg,
    // A computer's rows and buttons are closer set than a phone's.
    visualDensity: desktop ? VisualDensity.compact : VisualDensity.standard,
    extensions: [colors],
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: colors.ink, displayColor: colors.ink),
    iconTheme: IconThemeData(color: colors.ink, size: 20),
    dividerTheme: DividerThemeData(color: colors.border, space: 1, thickness: 1),
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 400),
      decoration: BoxDecoration(color: colors.ink, borderRadius: BorderRadius.circular(8)),
      textStyle: TextStyle(color: scheme.surface, fontSize: 12, fontFamily: family, fontFamilyFallback: fontFallback),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: colors.surfaceStrong,
      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: desktop ? 10 : 13),
      hintStyle: TextStyle(color: colors.muted),
      border: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: colors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: colors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: colors.brandInk, width: 2),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: material ? null : colors.brandFill,
        foregroundColor: material ? null : colors.onBrand,
        shape: buttonShape.copyWith(
          side: system ? BorderSide.none : BorderSide(color: colors.border),
        ),
        padding: EdgeInsets.symmetric(horizontal: 18, vertical: desktop ? 12 : 14),
        textStyle: TextStyle(fontFamily: family,
    fontFamilyFallback: fontFallback, fontSize: 14, fontWeight: system ? FontWeight.w600 : FontWeight.w400),
      ).copyWith(mouseCursor: hand),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.ink,
        backgroundColor: material ? null : colors.surfaceStrong,
        side: BorderSide(color: colors.border),
        shape: buttonShape,
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: desktop ? 10 : 12),
        textStyle: TextStyle(fontFamily: family,
    fontFamilyFallback: fontFallback, fontSize: 13),
      ).copyWith(mouseCursor: hand),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: colors.brandInk,
        textStyle: TextStyle(fontFamily: family,
    fontFamilyFallback: fontFallback, fontSize: 13),
      ).copyWith(mouseCursor: hand),
    ),
    elevatedButtonTheme: const ElevatedButtonThemeData(style: ButtonStyle(mouseCursor: hand)),
    iconButtonTheme: const IconButtonThemeData(style: ButtonStyle(mouseCursor: hand)),
    segmentedButtonTheme: const SegmentedButtonThemeData(style: ButtonStyle(mouseCursor: hand)),
    menuButtonTheme: const MenuButtonThemeData(style: ButtonStyle(mouseCursor: hand)),
    listTileTheme: const ListTileThemeData(mouseCursor: hand),
    sliderTheme: const SliderThemeData(mouseCursor: hand),
    popupMenuTheme: const PopupMenuThemeData(mouseCursor: hand),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? colors.brandInk : null),
      checkColor: WidgetStatePropertyAll(scheme.surface),
      side: BorderSide(color: colors.muted, width: 1.5),
      mouseCursor: hand,
    ),
    switchTheme: material
        ? const SwitchThemeData(mouseCursor: hand)
        : SwitchThemeData(
            mouseCursor: hand,
            trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? (colors.liquid ? colors.brandFill : colors.brandInk) : colors.surfaceStrong),
            thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? (colors.liquid ? Colors.white : scheme.surface) : colors.muted),
            trackOutlineColor: WidgetStatePropertyAll(colors.border),
          ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: colors.ink,
      contentTextStyle: TextStyle(color: scheme.surface, fontFamily: family,
    fontFamilyFallback: fontFallback, fontSize: 14),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(flavor == GlassFlavor.tahoe ? 22 : 12)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.liquid
          ? _acrylic(brightness, flavor!)
          : colors.glass
          ? Color.alphaBlend(colors.surfaceStrong.withValues(alpha: 0.9), colors.bg)
          : scheme.surfaceContainerHigh,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(windowRadius),
        side: BorderSide(color: colors.liquid ? colors.border.withValues(alpha: 0.35) : colors.border),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.liquid
          ? _acrylic(brightness, flavor!)
          : colors.glass
          ? Color.alphaBlend(colors.surfaceStrong.withValues(alpha: 0.9), colors.bg)
          : scheme.surfaceContainerLow,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(windowRadius))),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStatePropertyAll(colors.muted.withValues(alpha: 0.5)),
      thickness: const WidgetStatePropertyAll(8),
      radius: const Radius.circular(4),
    ),
  );
}

/// What floats over the glass look's page (dialogs, the drawer): Fluent's Acrylic, macOS's
/// thick material, DDE and COSMIC's frosted panels. See-through enough to show the blur that's
/// drawn behind it (showDesktopSheet), solid enough for words.
Color _acrylic(Brightness b, GlassFlavor flavor) {
  final dark = b == Brightness.dark;
  final tint = switch (flavor) {
    GlassFlavor.fluent => dark ? const Color(0xFF2C2C2C) : const Color(0xFFFCFCFC),
    GlassFlavor.tahoe => dark ? const Color(0xFF2C2C2E) : const Color(0xFFFFFFFF),
    GlassFlavor.frosted => dark ? const Color(0xFF26282E) : const Color(0xFFF8F9FB),
  };
  return tint.withValues(alpha: dark ? 0.78 : 0.72);
}
