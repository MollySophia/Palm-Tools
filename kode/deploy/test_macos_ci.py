"""Check retry boundaries without compiling, mounting disks, or using keys."""
from pathlib import Path
import subprocess
import tempfile
import unittest


class MacosCiTests(unittest.TestCase):
    def run_build(self, failures, message):
        with tempfile.TemporaryDirectory(prefix="kode-ci-test-") as directory:
            root = Path(directory)
            (root / "deploy").mkdir()
            source = Path(__file__).with_name("build-macos-ci.sh").read_text()
            # Replace only external diagnostics/delay; exercise the real loop.
            source = source.replace("  df -h .", "  :").replace("  hdiutil info || true", "  :").replace("  sleep 5", "  :")
            script = root / "deploy/build-macos-ci.sh"
            script.write_text(source)
            runner = root / "run.sh"
            runner.write_text(f'''#!/bin/bash
[[ "$*" == "app --verbose" ]] || exit 99
count=$(cat count 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > count
if [[ $count -le {failures} ]]; then
  echo '{message}'
  exit 17
fi
''')
            runner.chmod(0o700)
            result = subprocess.run(["bash", str(script)], capture_output=True)
            return result.returncode, int((root / "count").read_text())

    def test_success_runs_once(self):
        self.assertEqual(self.run_build(0, ""), (0, 1))

    def test_dmg_failure_retries_once(self):
        self.assertEqual(self.run_build(1, "error running bundle_dmg.sh"), (0, 2))

    def test_persistent_dmg_failure_blocks_release(self):
        self.assertEqual(self.run_build(2, "error running bundle_dmg.sh"), (17, 2))

    def test_other_failures_do_not_retry(self):
        for error in ("compilation failed", "updater signature failed"):
            with self.subTest(error=error):
                self.assertEqual(self.run_build(1, error), (17, 1))


if __name__ == "__main__":
    unittest.main()
