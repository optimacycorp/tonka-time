import shutil
import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: unzip_docx.py <input.docx> <output_dir>")

    docx_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(docx_path, "r") as archive:
        archive.extractall(output_dir)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
