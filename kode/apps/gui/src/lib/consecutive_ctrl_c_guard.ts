export const CONSECUTIVE_CTRL_C_WINDOW_MS = 2_000

export type CtrlCDisposition = 'forward' | 'confirm'

/**
 * Only the second bare Ctrl+C inside the guard window is held for confirmation.
 * Any other terminal input breaks the sequence.
 */
export class ConsecutiveCtrlCGuard {
  private lastForwardedAt: number | null = null
  private readonly windowMs: number

  constructor(windowMs = CONSECUTIVE_CTRL_C_WINDOW_MS) {
    this.windowMs = windowMs
  }

  inspect(data: string, now = Date.now()): CtrlCDisposition {
    if (data !== '\x03') {
      this.reset()
      return 'forward'
    }

    const isConsecutive =
      this.lastForwardedAt !== null && now - this.lastForwardedAt <= this.windowMs

    if (isConsecutive) {
      this.reset()
      return 'confirm'
    }

    this.lastForwardedAt = now
    return 'forward'
  }

  reset() {
    this.lastForwardedAt = null
  }
}
