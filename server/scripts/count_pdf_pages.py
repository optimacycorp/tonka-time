import re
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: count_pdf_pages.py <input.pdf>")

    pdf_path = Path(sys.argv[1])
    content = pdf_path.read_bytes()
    count = len(re.findall(rb"/Type\s*/Page\b", content))
    print(count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
