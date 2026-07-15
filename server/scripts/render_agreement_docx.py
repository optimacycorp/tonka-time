import html
import json
import re
import sys
import zipfile
from pathlib import Path


PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
XML_TARGET_PREFIXES = (
    "word/document.xml",
    "word/header",
    "word/footer",
    "word/footnotes.xml",
    "word/endnotes.xml",
)


def should_process(name: str) -> bool:
    return any(name == prefix or name.startswith(prefix) for prefix in XML_TARGET_PREFIXES)


def main() -> int:
    if len(sys.argv) != 4:
      raise SystemExit("Usage: render_agreement_docx.py <template.docx> <output.docx> <data.json>")

    template_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    data_path = Path(sys.argv[3])

    data = json.loads(data_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(template_path, "r") as source_zip:
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as target_zip:
            for entry in source_zip.infolist():
                payload = source_zip.read(entry.filename)
                if should_process(entry.filename):
                    xml_text = payload.decode("utf-8")
                    xml_text = PLACEHOLDER_PATTERN.sub(lambda match: xml_escape(data.get(match.group(1), "")), xml_text)
                    payload = xml_text.encode("utf-8")

                target_zip.writestr(entry, payload)

    return 0


def xml_escape(value: str) -> str:
    return html.escape(str(value), quote=False)


if __name__ == "__main__":
    raise SystemExit(main())
