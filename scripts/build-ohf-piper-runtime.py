#!/usr/bin/env python3
"""Build a self-contained OHF Voice Piper runtime for Vellium releases."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


PIPER_VERSION = "1.6.0"
PIPER_SOURCE = f"https://github.com/OHF-Voice/piper1-gpl/tree/v{PIPER_VERSION}"


def copy_distribution_licenses(stage: Path) -> None:
    license_root = stage / "licenses"
    for distribution_name in ("piper-tts", "onnxruntime", "numpy", "pathvalidate", "protobuf", "pyinstaller"):
        try:
            distribution = importlib.metadata.distribution(distribution_name)
        except importlib.metadata.PackageNotFoundError:
            continue
        copied = False
        for entry in distribution.files or ():
            filename = entry.name.lower()
            if "license" not in filename and "copying" not in filename:
                continue
            source = Path(distribution.locate_file(entry))
            if not source.is_file():
                continue
            destination = license_root / distribution_name / Path(*entry.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            copied = True
        if not copied:
            print(f"warning: no license file found for {distribution_name}", file=sys.stderr)

    for parent in Path(sys.base_prefix).parents:
        python_license = parent / "LICENSE"
        if python_license.is_file():
            destination = license_root / "python" / "LICENSE"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(python_license, destination)
            break


def build_runtime(output_dir: Path, platform_name: str, arch: str) -> Path:
    entrypoint = shutil.which("piper")
    if not entrypoint:
        raise RuntimeError("piper executable is unavailable; install the pinned piper-tts package first")

    archive_suffix = ".zip" if platform_name == "windows" else ".tar.gz"
    archive_name = f"vellium-piper-ohf-v{PIPER_VERSION}-{platform_name}-{arch}{archive_suffix}"
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / archive_name

    with tempfile.TemporaryDirectory(prefix="vellium-piper-build-") as temporary:
        temporary_root = Path(temporary)
        dist_root = temporary_root / "dist"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--clean",
                "--onedir",
                "--name",
                "piper",
                "--collect-data",
                "piper",
                "--collect-binaries",
                "piper",
                "--distpath",
                str(dist_root),
                "--workpath",
                str(temporary_root / "work"),
                "--specpath",
                str(temporary_root / "spec"),
                entrypoint,
            ],
            check=True,
        )

        stage = dist_root / "piper"
        executable = stage / ("piper.exe" if platform_name == "windows" else "piper")
        if not executable.is_file():
            raise RuntimeError(f"PyInstaller output does not contain {executable.name}")
        subprocess.run(
            [str(executable), "--help"],
            cwd=stage,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )

        copy_distribution_licenses(stage)
        (stage / "SOURCE.json").write_text(
            json.dumps(
                {
                    "name": "OHF Voice Piper",
                    "version": PIPER_VERSION,
                    "license": "GPL-3.0-or-later",
                    "source": PIPER_SOURCE,
                    "correspondingSourceAsset": f"piper1-gpl-v{PIPER_VERSION}-source.tar.gz",
                    "buildPython": sys.version,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        if platform_name == "windows":
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for source in sorted(stage.rglob("*")):
                    if source.is_file():
                        archive.write(source, Path("piper") / source.relative_to(stage))
        else:
            with tarfile.open(archive_path, "w:gz", compresslevel=9) as archive:
                archive.add(stage, arcname="piper")

    print(f"{archive_path} ({archive_path.stat().st_size} bytes)")
    return archive_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--platform", required=True, choices=("macos", "windows", "linux"))
    parser.add_argument("--arch", required=True, choices=("arm64", "x64"))
    args = parser.parse_args()
    build_runtime(args.output_dir.resolve(), args.platform, args.arch)


if __name__ == "__main__":
    main()
