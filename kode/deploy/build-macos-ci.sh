#!/usr/bin/env bash
# Keep the first DMG failure visible; retry only the packaging-script failure.
# The second run reuses Cargo's build output. Compilation/signing failures must
# never be retried or converted into successful releases.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
build_log=$(mktemp -t kode-macos-build.XXXXXX)
trap 'rm -f "$build_log"' EXIT

for attempt in 1 2; do
  set +e
  ./run.sh app --verbose 2>&1 | tee "$build_log"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  build_status=${pipeline_status[0]}
  if [[ ${pipeline_status[1]} -ne 0 ]]; then
    exit "${pipeline_status[1]}"
  fi
  if [[ $build_status -eq 0 ]]; then
    exit 0
  fi
  if [[ $attempt -eq 2 ]] || ! grep -q 'error running bundle_dmg.sh' "$build_log"; then
    exit "$build_status"
  fi
  echo '::warning::DMG creation failed; retrying once with cached build output. See the preceding hdiutil/bundler log for the cause.'
  df -h .
  hdiutil info || true
  sleep 5
done
