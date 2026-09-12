#!/usr/bin/env python3
"""Verify Tauri's Base64-wrapped minisign signature using the shipped public key.

Requires minisign on PATH. Reads public material only, never a private key.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import tempfile


def verify(archive: Path, config: Path) -> None:
    public_key = json.loads(config.read_text())["plugins"]["updater"]["pubkey"]
    signature = Path(str(archive) + ".sig").read_text().strip()
    if not archive.is_file() or archive.stat().st_size == 0:
        raise ValueError("Updater archive is missing or empty")
    with tempfile.TemporaryDirectory(prefix="kode-updater-verify-") as directory:
        public_path = Path(directory) / "public.key"
        signature_path = Path(directory) / "archive.sig"
        public_path.write_bytes(base64.b64decode(public_key.strip(), validate=True))
        signature_path.write_bytes(base64.b64decode(signature, validate=True))
        subprocess.run([
            "minisign", "-Vm", str(archive), "-p", str(public_path),
            "-x", str(signature_path),
        ], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parents[1] / "apps/gui/src-tauri/tauri.conf.json")
    args = parser.parse_args()
    verify(args.archive, args.config)
