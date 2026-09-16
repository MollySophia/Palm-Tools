import assert from 'node:assert/strict'
import test from 'node:test'

import { ConsecutiveCtrlCGuard } from '../src/lib/consecutive_ctrl_c_guard.ts'

test('forwards the first Ctrl+C and confirms the consecutive one', () => {
  const guard = new ConsecutiveCtrlCGuard(2_000)

  assert.equal(guard.inspect('\x03', 1_000), 'forward')
  assert.equal(guard.inspect('\x03', 2_500), 'confirm')
})

test('does not confirm Ctrl+C after the guard window expires', () => {
  const guard = new ConsecutiveCtrlCGuard(2_000)

  assert.equal(guard.inspect('\x03', 1_000), 'forward')
  assert.equal(guard.inspect('\x03', 3_001), 'forward')
})

test('other terminal input breaks the Ctrl+C sequence', () => {
  const guard = new ConsecutiveCtrlCGuard(2_000)

  assert.equal(guard.inspect('\x03', 1_000), 'forward')
  assert.equal(guard.inspect('a', 1_100), 'forward')
  assert.equal(guard.inspect('\x03', 1_200), 'forward')
})

test('a confirmed sequence resets before the next Ctrl+C', () => {
  const guard = new ConsecutiveCtrlCGuard(2_000)

  assert.equal(guard.inspect('\x03', 1_000), 'forward')
  assert.equal(guard.inspect('\x03', 1_100), 'confirm')
  assert.equal(guard.inspect('\x03', 1_200), 'forward')
})
