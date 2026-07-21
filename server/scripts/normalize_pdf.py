#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: normalize_pdf.py <input.pdf> <output.pdf>")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    reader = PdfReader(str(input_path))
    writer = PdfWriter()

    for page in reader.pages:
        writer.add_page(page)

    if reader.metadata:
        writer.add_metadata({
            key: str(value)
            for key, value in reader.metadata.items()
            if value is not None
        })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as handle:
        writer.write(handle)


if __name__ == "__main__":
    main()
