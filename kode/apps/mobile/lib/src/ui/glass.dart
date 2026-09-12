/// Shared iOS-inspired materials. Blur is clipped and reserved for fixed chrome;
/// scrolling cards use the same translucent material without a backdrop filter.
library;

import 'dart:ui';
import 'package:flutter/material.dart';

class GlassSurface extends StatelessWidget {
  const GlassSurface({
    super.key,
    required this.child,
    this.radius = 22,
    this.blur = false,
    this.padding = EdgeInsets.zero,
  });

  final Widget child;
  final double radius;
  final bool blur;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = colors.brightness == Brightness.dark;
    final solid =
        MediaQuery.highContrastOf(context) ||
        MediaQuery.disableAnimationsOf(context);
    final content = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: solid
              ? [colors.surface, colors.surface]
              : [
                  colors.surface.withValues(alpha: dark ? .88 : .82),
                  colors.surface.withValues(alpha: dark ? .68 : .58),
                ],
        ),
        border: Border.all(
          color: solid
              ? colors.outline
              : Colors.white.withValues(alpha: dark ? .14 : .78),
          width: .7,
        ),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: Padding(padding: padding, child: child),
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: blur && !solid
          ? BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
              child: content,
            )
          : content,
    );
  }
}

/// Owns one static backdrop per route; keyboard/safe-area behavior stays with Scaffold.
class GlassScaffold extends StatelessWidget {
  const GlassScaffold({
    super.key,
    required this.body,
    this.appBar,
    this.resizeToAvoidBottomInset,
  });
  final Widget body;
  final PreferredSizeWidget? appBar;
  final bool? resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final highContrast = MediaQuery.highContrastOf(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        gradient: highContrast
            ? null
            : LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                stops: const [0, .48, 1],
                colors: [
                  Color.alphaBlend(
                    colors.primary.withValues(alpha: .12),
                    theme.scaffoldBackgroundColor,
                  ),
                  theme.scaffoldBackgroundColor,
                  Color.alphaBlend(
                    colors.tertiary.withValues(alpha: .13),
                    theme.scaffoldBackgroundColor,
                  ),
                ],
              ),
      ),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        resizeToAvoidBottomInset: resizeToAvoidBottomInset,
        appBar: appBar,
        body: body,
      ),
    );
  }
}

class GlassNavigationBackground extends StatelessWidget {
  const GlassNavigationBackground({super.key});
  @override
  Widget build(BuildContext context) =>
      const GlassSurface(radius: 0, blur: true, child: SizedBox.expand());
}
