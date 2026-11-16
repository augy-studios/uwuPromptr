// The looks: which one the app is in on each platform, and the desktop's glass look keeping its
// words readable whatever the window behind it gives.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uwupromptr/data/store.dart';
import 'package:uwupromptr/theme/theme.dart';

double contrast(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  return ((la > lb ? la : lb) + 0.05) / ((la > lb ? lb : la) + 0.05);
}

void main() {
  final t = ThemeController.I;

  setUp(() {
    ThemeController.isAndroid = () => false;
    ThemeController.isDesktop = () => false;
    t.hasDynamic = false;
  });

  group('the look', () {
    test('the desktop: the UwU Apps look by default, glass in place of Material You', () {
      ThemeController.isDesktop = () => true;
      Store.memory();
      expect(t.look, lookUwuApps);
      t.setLook(lookGlass);
      expect(Store.I.get(keyLook), lookGlass);
      expect(t.isGlass, isTrue);
      expect(t.isMaterial, isFalse);
      // Material You picked before glass existed means the system's look here too.
      Store.memory({keyLook: lookMaterial});
      expect(t.look, lookGlass);
      expect(t.systemLook, lookGlass);
    });

    test('Android: Material You by default with a palette, and glass read as Material You', () {
      ThemeController.isAndroid = () => true;
      t.hasDynamic = true;
      Store.memory();
      expect(t.look, lookMaterial);
      Store.memory({keyLook: lookGlass});
      expect(t.look, lookMaterial);
      Store.memory({keyLook: lookUwuApps});
      expect(t.look, lookUwuApps);
      expect(t.systemLook, lookMaterial);
    });
  });

  group('the glass look', () {
    const accents = [Color(0xFF0078D4), Color(0xFF007AFF), Color(0xFFFFCC00), Color(0xFF34C759), Color(0xFFE62D42), Color(0xFF8E8E93)];

    test('each system its own name', () {
      expect(GlassFlavor.fluent.label, 'Fluent 2');
      expect(GlassFlavor.tahoe.label, 'macOS Tahoe');
      expect(GlassFlavor.frosted.label, 'Deepin & COSMIC');
    });

    test('the page as see-through as the window allows, and solid when it allows nothing', () {
      for (final f in GlassFlavor.values) {
        for (final b in Brightness.values) {
          expect(glassColors(accents.first, b, flavor: f).bg.a, 1.0);
          expect(glassColors(accents.first, b, flavor: f, backdrop: Backdrop.clear).bg.a, lessThan(1.0));
          expect(glassColors(accents.first, b, flavor: f, backdrop: Backdrop.blurred).bg.a, lessThan(0.6));
          expect(glassColors(accents.first, b, flavor: f, backdrop: Backdrop.blurred).paper.a, 1.0);
        }
      }
      // Mica is tinted by Windows itself: nothing over it.
      expect(glassColors(accents.first, Brightness.light, flavor: GlassFlavor.fluent, backdrop: Backdrop.blurred).bg.a, 0.0);
    });

    test('words on the accent at 4.5:1 or more, for every accent and mode', () {
      for (final a in accents) {
        for (final b in Brightness.values) {
          final c = glassColors(a, b, flavor: GlassFlavor.tahoe);
          expect(contrast(c.onBrand, c.brandFill), greaterThanOrEqualTo(4.5), reason: '$a $b');
          expect(contrast(c.ink, c.paper), greaterThanOrEqualTo(7.0), reason: '$a $b');
          expect(contrast(c.muted, c.paper), greaterThanOrEqualTo(4.5), reason: '$a $b');
        }
      }
    });

    test('the theme builds for every system, mode and window', () {
      for (final f in GlassFlavor.values) {
        for (final b in Brightness.values) {
          for (final w in Backdrop.values) {
            final theme = buildTheme(look: lookGlass, brightness: b, brand: colorThemes.first.color, glassFlavor: f, backdrop: w, desktop: true);
            final c = theme.extension<UwuColors>()!;
            expect(c.flavor, f);
            expect(c.liquid, isTrue);
            // What Material paints itself is solid.
            expect(theme.colorScheme.surface.a, 1.0);
            expect(theme.colorScheme.surfaceContainerHigh.a, 1.0);
          }
        }
      }
      final uwu = buildTheme(look: lookUwuApps, brightness: Brightness.light, brand: colorThemes.first.color);
      expect(uwu.extension<UwuColors>()!.liquid, isFalse);
    });
  });
}
