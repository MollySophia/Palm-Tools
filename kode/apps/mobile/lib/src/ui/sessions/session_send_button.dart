import 'package:flutter/material.dart';

/// Remote work only occupies the empty composer; a draft always takes priority.
class SessionSendButton extends StatelessWidget {
  final bool working;
  final String text;
  final VoidCallback onSend;
  final bool circular;

  const SessionSendButton({
    super.key,
    required this.working,
    required this.text,
    required this.onSend,
    this.circular = false,
  });

  @override
  Widget build(BuildContext context) {
    final canSend = text.trim().isNotEmpty;
    final showProgress = working && !canSend;
    final label = showProgress ? 'Session running' : 'Send message';
    return Semantics(
      button: true,
      enabled: canSend,
      label: label,
      child: Tooltip(
        message: label,
        child: SizedBox(
          width: 48,
          height: 46,
          child: FilledButton(
            onPressed: canSend ? onSend : null,
            style: FilledButton.styleFrom(
              elevation: 0,
              padding: EdgeInsets.zero,
              shape: circular
                  ? const CircleBorder()
                  : RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(13),
                    ),
            ),
            child: showProgress
                ? SizedBox(
                    width: 21,
                    height: 21,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Theme.of(context).colorScheme.primary,
                      value: MediaQuery.disableAnimationsOf(context)
                          ? 0.75
                          : null,
                    ),
                  )
                : const Icon(Icons.arrow_upward_rounded, size: 23),
          ),
        ),
      ),
    );
  }
}
