#!/usr/bin/env python3
"""Build the self-contained, long-lived TeraTTSv2 runtime for Vellium."""

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


RUNTIME_VERSION = "2"
DEPENDENCIES = ("numpy", "onnxruntime", "transformers", "tokenizers", "num2words", "pyinstaller", "backports.tarfile")
UTF8_PROBE = "Привет, Vellium — UTF-8 работает: ёжик ✓"


def verify_utf8_protocol(executable: Path, cwd: Path) -> None:
    request = (json.dumps({"text": UTF8_PROBE}, ensure_ascii=False) + "\n").encode("utf-8")
    result = subprocess.run(
        [str(executable), "--protocol-self-test"],
        cwd=cwd,
        input=request,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
        timeout=30,
    )
    try:
        response = json.loads(result.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        diagnostic = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"TeraTTS runtime returned invalid UTF-8 JSON: {diagnostic}") from error
    if response.get("text") != UTF8_PROBE:
        raise RuntimeError("TeraTTS runtime failed the Cyrillic UTF-8 protocol round trip")


def copy_licenses(stage: Path) -> None:
    target_root = stage / "licenses"
    for name in DEPENDENCIES:
        try:
            distribution = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            continue
        for entry in distribution.files or ():
            if "license" not in entry.name.lower() and "copying" not in entry.name.lower():
                continue
            source = Path(distribution.locate_file(entry))
            if not source.is_file():
                continue
            destination = target_root / name / Path(*entry.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)


def build(output_dir: Path, platform_name: str, arch: str) -> Path:
    for dependency in DEPENDENCIES:
        importlib.metadata.version(dependency)
    suffix = ".zip" if platform_name == "windows" else ".tar.gz"
    filename = f"vellium-teratts-v2-runtime-v{RUNTIME_VERSION}-{platform_name}-{arch}{suffix}"
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / filename
    entrypoint = Path(__file__).with_name("teratts_runtime.py").resolve()
    with tempfile.TemporaryDirectory(prefix="vellium-teratts-build-") as temporary:
        root = Path(temporary)
        dist = root / "dist"
        subprocess.run([
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
            "--name", "teratts-runtime",
            "--collect-binaries", "onnxruntime",
            "--collect-data", "transformers",
            "--hidden-import", "transformers.models.bert.tokenization_bert_fast",
            "--hidden-import", "transformers.models.deberta.tokenization_deberta_fast",
            "--hidden-import", "transformers.models.distilbert.tokenization_distilbert_fast",
            "--distpath", str(dist), "--workpath", str(root / "work"),
            "--specpath", str(root / "spec"), str(entrypoint),
        ], check=True)
        stage = dist / "teratts-runtime"
        executable = stage / ("teratts-runtime.exe" if platform_name == "windows" else "teratts-runtime")
        if not executable.is_file():
            raise RuntimeError(f"PyInstaller output does not contain {executable.name}")
        subprocess.run([str(executable), "--version"], cwd=stage, check=True, timeout=30)
        verify_utf8_protocol(executable, stage)
        copy_licenses(stage)
        (stage / "SOURCE.json").write_text(json.dumps({
            "name": "Vellium TeraTTSv2 runtime",
            "runtimeVersion": RUNTIME_VERSION,
            "model": "TeraSpace/TeraTTSv2",
            "modelDownloadedSeparately": True,
            "buildPython": sys.version,
            "dependencies": {name: importlib.metadata.version(name) for name in DEPENDENCIES},
        }, indent=2) + "\n", encoding="utf-8")
        if platform_name == "windows":
            with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for source in sorted(stage.rglob("*")):
                    if source.is_file():
                        archive.write(source, Path("teratts-runtime") / source.relative_to(stage))
        else:
            with tarfile.open(archive_path, "w:gz", compresslevel=9) as archive:
                archive.add(stage, arcname="teratts-runtime")
    print(f"{archive_path} ({archive_path.stat().st_size} bytes)")
    return archive_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--platform", required=True, choices=("macos", "windows", "linux"))
    parser.add_argument("--arch", required=True, choices=("arm64", "x64"))
    args = parser.parse_args()
    build(args.output_dir.resolve(), args.platform, args.arch)


if __name__ == "__main__":
    main()
