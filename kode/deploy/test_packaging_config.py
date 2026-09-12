"""Exercise run.sh packaging defaults without building or reading real keys."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class PackagingConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="kode-packaging-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / ".tauri").mkdir()
        self.key = self.root / ".tauri/kode-updater.key"
        self.key.write_text("fixture-only-key")
        source = (Path(__file__).resolve().parents[1] / "run.sh").read_text()
        functions = source[source.index("set_signing_args() {"):source.index("\nCMD=")]
        self.script = "security() { return 1; }; warn() { :; }; info() { :; }; error() { exit 17; };\n" + functions + "\n"

    def run_shell(self, check, expected=0):
        result = subprocess.run(["bash", "-c", self.script + check], env=dict(os.environ, ROOT_DIR=str(self.root)), capture_output=True)
        self.assertEqual(result.returncode, expected)

    def test_default_adhoc_includes_dmg(self):
        self.run_shell('unset KODE_FORCE_DMG; set_signing_args; [[ "${BUNDLE_TARGETS[1]}" == app,dmg ]]')

    def test_explicit_app_only(self):
        self.run_shell('KODE_FORCE_DMG=0; set_signing_args; [[ "${BUNDLE_TARGETS[1]}" == app ]]')

    def test_local_key_loaded(self):
        self.run_shell('unset TAURI_SIGNING_PRIVATE_KEY; set_updater_signing_key; [[ "$TAURI_SIGNING_PRIVATE_KEY" == fixture-only-key ]]')

    def test_environment_key_takes_precedence(self):
        self.run_shell('TAURI_SIGNING_PRIVATE_KEY=ci-fixture; set_updater_signing_key; [[ "$TAURI_SIGNING_PRIVATE_KEY" == ci-fixture ]]')

    def test_missing_key_fails_early(self):
        self.key.unlink()
        self.run_shell('unset TAURI_SIGNING_PRIVATE_KEY; set_updater_signing_key', expected=17)


if __name__ == "__main__":
    unittest.main()
