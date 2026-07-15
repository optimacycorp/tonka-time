from __future__ import annotations

import sys
from pathlib import Path

from docx import Document


REPLACEMENTS = {
    "Customer initials - 811/private utilities responsibility: __________":
        "Customer initials - 811/private utilities responsibility: [[OS_INITIAL_811]]",
    "Customer initials - tutorial is not professional training: __________":
        "Customer initials - tutorial is not professional training: [[OS_INITIAL_TUTORIAL]]",
    "Customer initials - damage waiver limits: __________":
        "Customer initials - damage waiver limits: [[OS_INITIAL_DAMAGE_WAIVER]]",
    "Customer signature: [OpenSign signature field]     Date signed: [OpenSign date field]":
        "Customer signature: [[OS_SIGNATURE_CUSTOMER]]     Date signed: [[OS_DATE_SIGNED]]",
}


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: update_agreement_anchor_template.py <template.docx>")

    target = Path(sys.argv[1])
    doc = Document(str(target))
    replaced = set()

    for para in doc.paragraphs:
      text = para.text.strip()
      replacement = REPLACEMENTS.get(text)
      if replacement is None:
          continue

      para.text = replacement
      replaced.add(text)

    missing = set(REPLACEMENTS) - replaced
    if missing:
        raise SystemExit(f"Missing expected template lines: {sorted(missing)}")

    doc.save(str(target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
