// The space above the navigation bar (Prompter settings > Android app): what it does to the
// screen's measures the whole app reads.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uwupromptr/app/env.dart';
import 'package:uwupromptr/data/store.dart';
import 'package:uwupromptr/features/prompter/app_extras.dart';

void main() {
  const bar = MediaQueryData(padding: EdgeInsets.only(bottom: 24), viewPadding: EdgeInsets.only(bottom: 24));
  final x = AppExtras.I;

  setUp(() {
    Store.memory();
    Env.androidOverride = true;
  });
  tearDown(() => Env.androidOverride = null);

  test('automatic leaves the phone’s own measure', () {
    expect(x.bottomGap, 0);
    expect(x.withBottomGap(bar).padding.bottom, 24);
  });

  test('adds to the bar, and takes off it, never below nothing', () {
    x.setBottomGap(16);
    expect(x.withBottomGap(bar).padding.bottom, 40);
    expect(x.withBottomGap(bar).viewPadding.bottom, 40);
    x.setBottomGap(-24);
    expect(x.withBottomGap(bar).padding.bottom, 0);
  });

  test('snaps to its steps and stays in range, and 0 is stored as unset', () {
    x.setBottomGap(7);
    expect(x.bottomGap, 8);
    x.setBottomGap(500);
    expect(x.bottomGap, bottomGapMax);
    x.setBottomGap(0);
    expect(Store.I.get(keyBottomGap), isNull);
  });

  test('nothing while the keyboard is up', () {
    x.setBottomGap(16);
    final typing = bar.copyWith(padding: EdgeInsets.zero, viewInsets: const EdgeInsets.only(bottom: 300));
    expect(x.withBottomGap(typing).padding.bottom, 0);
  });

  test('only on Android', () {
    x.setBottomGap(16);
    Env.androidOverride = false;
    expect(x.bottomGap, 0);
    expect(x.withBottomGap(bar).padding.bottom, 24);
  });
}
