import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kode_mobile/src/ui/sessions/session_glass_layout.dart';

void main() {
  testWidgets(
    'chrome floats above a full viewport and measures changing drafts',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final height = ValueNotifier<double>(60);
      addTearDown(height.dispose);
      EdgeInsets? insets;
      var taps = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MediaQuery(
              data: const MediaQueryData(
                viewPadding: EdgeInsets.only(top: 44, bottom: 34),
              ),
              child: SessionGlassLayout(
                header: const SizedBox(height: 56),
                composer: ValueListenableBuilder<double>(
                  valueListenable: height,
                  builder: (_, value, _) => SizedBox(height: value),
                ),
                transcriptBuilder: (padding) {
                  insets = padding;
                  return GestureDetector(
                    onTap: () => taps++,
                    behavior: HitTestBehavior.opaque,
                    child: const SizedBox.expand(key: ValueKey('transcript')),
                  );
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.getSize(find.byKey(const ValueKey('transcript'))),
        const Size(390, 844),
      );
      expect(insets!.top, 122);
      expect(insets!.bottom, 132);
      // The decorative gradient never consumes transcript gestures.
      await tester.tapAt(const Offset(200, 160));
      expect(taps, 1);
      height.value = 132;
      await tester.pumpAndSettle();
      expect(insets!.bottom, 204);
      expect(tester.takeException(), isNull);
    },
  );
}
