#!/usr/bin/env python3
"""
Analyze a directory tree and recommend which paths to keep, archive, review, or
clean up based on size, age, and common generated-file patterns.

Examples:
  python scripts/analyze_filesystem_cleanup.py .
  python scripts/analyze_filesystem_cleanup.py /var/www --top 40 --stale-days 45
  python scripts/analyze_filesystem_cleanup.py . --json --exclude .git node_modules
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_EXCLUDES = {
    ".git",
    ".agents",
    ".codex",
    "__pycache__",
}

ARCHIVE_HINT_NAMES = {
    "backup",
    "backups",
    "archive",
    "archives",
    "export",
    "exports",
    "dump",
    "dumps",
}

GENERATED_HINT_NAMES = {
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    "tmp",
    "temp",
    "logs",
    "coverage",
}

GENERATED_SUFFIXES = {
    ".log",
    ".tmp",
    ".temp",
    ".bak",
    ".old",
}

ARCHIVE_SUFFIXES = {
    ".zip",
    ".tar",
    ".gz",
    ".tgz",
    ".bz2",
    ".7z",
    ".rar",
}

DOCUMENT_SUFFIXES = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".csv",
}


@dataclass
class Finding:
    path: str
    kind: str
    size_bytes: int
    modified_at: str
    age_days: int
    recommendation: str
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze filesystem usage and recommend cleanup or archive candidates.")
    parser.add_argument("target", nargs="?", default=".", help="Directory to analyze. Defaults to current directory.")
    parser.add_argument("--top", type=int, default=25, help="Maximum number of findings to print. Default: 25.")
    parser.add_argument("--stale-days", type=int, default=30, help="Age threshold used for stale recommendations. Default: 30.")
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Directory or file names to exclude anywhere in the tree.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON instead of text.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = Path(args.target).resolve()
    if not target.exists():
        print(f"Target does not exist: {target}", file=sys.stderr)
        return 1
    if not target.is_dir():
        print(f"Target is not a directory: {target}", file=sys.stderr)
        return 1

    excludes = DEFAULT_EXCLUDES | set(args.exclude)
    now = datetime.now(timezone.utc)
    findings = analyze_tree(target, now=now, stale_days=args.stale_days, excludes=excludes)
    findings.sort(key=lambda item: (recommendation_rank(item.recommendation), -item.size_bytes, -item.age_days))
    findings = collapse_nested_findings(findings)

    if args.json:
        payload = {
            "target": str(target),
            "generated_at": now.isoformat(),
            "top": args.top,
            "summary": build_summary(findings),
            "findings": [asdict(item) for item in findings[: args.top]],
        }
        print(json.dumps(payload, indent=2))
        return 0

    print_text_report(target, findings[: args.top], build_summary(findings), args.stale_days)
    return 0


def analyze_tree(target: Path, *, now: datetime, stale_days: int, excludes: set[str]) -> list[Finding]:
    findings: list[Finding] = []

    for root, dirnames, filenames in os.walk(target):
        dirnames[:] = [name for name in dirnames if name not in excludes]
        current = Path(root)

        # Include directory-level candidates.
        if current != target:
            size_bytes = safe_dir_size(current)
            if size_bytes > 0:
                finding = classify_path(current, "directory", size_bytes, now=now, stale_days=stale_days)
                if finding is not None:
                    findings.append(finding)

        for filename in filenames:
            if filename in excludes:
                continue
            path = current / filename
            try:
                size_bytes = path.stat().st_size
            except OSError:
                continue

            finding = classify_path(path, "file", size_bytes, now=now, stale_days=stale_days)
            if finding is not None:
                findings.append(finding)

    return findings


def classify_path(path: Path, kind: str, size_bytes: int, *, now: datetime, stale_days: int) -> Finding | None:
    try:
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None

    age_days = max(0, int((now - modified).total_seconds() // 86400))
    name = path.name.lower()
    parts = {part.lower() for part in path.parts}
    is_generated = name in GENERATED_HINT_NAMES or bool(parts & GENERATED_HINT_NAMES) or path.suffix.lower() in GENERATED_SUFFIXES
    is_archive = path.suffix.lower() in ARCHIVE_SUFFIXES or name in ARCHIVE_HINT_NAMES or bool(parts & ARCHIVE_HINT_NAMES)
    is_document = path.suffix.lower() in DOCUMENT_SUFFIXES

    recommendation = "keep"
    reason = "No cleanup signal detected."

    if kind == "directory" and name in GENERATED_HINT_NAMES and size_bytes > 10 * 1024 * 1024:
        recommendation = "review"
        reason = "Large generated directory; safe cleanup depends on whether the build cache is still needed."
    elif is_generated and age_days >= stale_days and size_bytes > 1 * 1024 * 1024:
        recommendation = "cleanup"
        reason = f"Generated artifact appears stale ({age_days} days old)."
    elif is_archive and age_days < stale_days:
        recommendation = "archive"
        reason = "Compressed artifact is a strong archive candidate instead of hot storage."
    elif is_archive and age_days >= stale_days:
        recommendation = "review"
        reason = f"Archive artifact is older than {stale_days} days; confirm retention requirements."
    elif is_document and age_days >= stale_days and size_bytes > 5 * 1024 * 1024:
        recommendation = "archive"
        reason = f"Large document is old enough to move to colder storage ({age_days} days old)."
    elif kind == "directory" and age_days >= stale_days and size_bytes > 50 * 1024 * 1024:
        recommendation = "archive"
        reason = f"Large directory has not changed in at least {stale_days} days."
    elif kind == "file" and age_days >= stale_days and size_bytes > 20 * 1024 * 1024:
        recommendation = "archive"
        reason = f"Large file has not changed in at least {stale_days} days."
    elif size_bytes < 512 * 1024 and recommendation == "keep":
        return None

    return Finding(
        path=str(path),
        kind=kind,
        size_bytes=size_bytes,
        modified_at=modified.isoformat(),
        age_days=age_days,
        recommendation=recommendation,
        reason=reason,
    )


def safe_dir_size(directory: Path) -> int:
    total = 0
    for child in directory.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def recommendation_rank(recommendation: str) -> int:
    order = {
        "cleanup": 0,
        "archive": 1,
        "review": 2,
        "keep": 3,
    }
    return order.get(recommendation, 99)


def build_summary(findings: Iterable[Finding]) -> dict[str, object]:
    findings = list(findings)
    by_recommendation: dict[str, int] = {}
    by_bytes: dict[str, int] = {}

    for item in findings:
        by_recommendation[item.recommendation] = by_recommendation.get(item.recommendation, 0) + 1
        by_bytes[item.recommendation] = by_bytes.get(item.recommendation, 0) + item.size_bytes

    return {
        "candidate_count": len(findings),
        "counts_by_recommendation": by_recommendation,
        "bytes_by_recommendation": {key: human_size(value) for key, value in by_bytes.items()},
    }


def collapse_nested_findings(findings: list[Finding]) -> list[Finding]:
    collapsed: list[Finding] = []
    kept_roots: list[Path] = []

    for item in findings:
        current_path = Path(item.path)
        if any(is_relative_to(current_path, root) for root in kept_roots):
            continue
        collapsed.append(item)
        kept_roots.append(current_path)

    return collapsed


def print_text_report(target: Path, findings: list[Finding], summary: dict[str, object], stale_days: int) -> None:
    print(f"Cleanup analysis for: {target}")
    print(f"Stale threshold: {stale_days} days")
    print(f"Candidate count: {summary['candidate_count']}")
    print("Recommendation totals:")
    for key, count in sorted(summary["counts_by_recommendation"].items()):  # type: ignore[index]
        size_text = summary["bytes_by_recommendation"].get(key, "0 B")  # type: ignore[index]
        print(f"  - {key}: {count} item(s), {size_text}")

    print("\nTop candidates:")
    if not findings:
        print("  No large or stale candidates found.")
        return

    for item in findings:
        print(
            f"  - [{item.recommendation.upper():7}] {human_size(item.size_bytes):>8}  "
            f"{item.age_days:>4}d  {item.path}"
        )
        print(f"    {item.reason}")


def human_size(size_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size_bytes)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{size_bytes} B"


def is_relative_to(path: Path, other: Path) -> bool:
    try:
        path.relative_to(other)
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
