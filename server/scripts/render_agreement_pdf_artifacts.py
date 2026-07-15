from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: render_agreement_pdf_artifacts.py <payload.json>")

    payload_path = Path(sys.argv[1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))

    source_pdf_path = Path(payload["sourcePdfPath"])
    masked_pdf_path = Path(payload["maskedPdfPath"])
    debug_pdf_path = Path(payload["debugPdfPath"])

    anchor_locations = payload.get("anchorLocations", {})
    widget_rects = payload.get("widgetRects", [])
    page_anchor_locations = group_by_page(anchor_locations.values())
    page_widget_rects = group_by_page(widget_rects)

    build_masked_pdf(source_pdf_path, masked_pdf_path, page_anchor_locations)
    build_debug_pdf(
        source_pdf_path,
        debug_pdf_path,
        page_anchor_locations,
        page_widget_rects,
        payload,
    )
    return 0


def build_masked_pdf(source_pdf_path: Path, output_path: Path, page_anchor_locations: dict[int, list[dict]]) -> None:
    reader = PdfReader(str(source_pdf_path))
    writer = PdfWriter()

    for page_index, page in enumerate(reader.pages, start=1):
        overlay = build_mask_overlay(page, page_anchor_locations.get(page_index, []))
        if overlay is not None:
            page.merge_page(overlay)
        writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as handle:
        writer.write(handle)


def build_debug_pdf(
    source_pdf_path: Path,
    output_path: Path,
    page_anchor_locations: dict[int, list[dict]],
    page_widget_rects: dict[int, list[dict]],
    payload: dict,
) -> None:
    reader = PdfReader(str(source_pdf_path))
    writer = PdfWriter()

    for page_index, page in enumerate(reader.pages, start=1):
        overlay = build_debug_overlay(
            page,
            page_anchor_locations.get(page_index, []),
            page_widget_rects.get(page_index, []),
            payload,
            page_index,
        )
        if overlay is not None:
            page.merge_page(overlay)
        writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as handle:
        writer.write(handle)


def build_mask_overlay(page, anchor_locations: list[dict]):
    if not anchor_locations:
        return None

    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    packet = io.BytesIO()
    canvas_obj = canvas.Canvas(packet, pagesize=(page_width, page_height))

    for location in anchor_locations:
        rect = expand_rect(location, pad_x=2.5, pad_y=2.5, min_w=18, min_h=8)
        canvas_obj.setFillColorRGB(1, 1, 1)
        canvas_obj.setStrokeColorRGB(1, 1, 1)
        canvas_obj.rect(rect["x"], rect["y"], rect["width"], rect["height"], fill=1, stroke=0)

    canvas_obj.save()
    packet.seek(0)
    return PdfReader(packet).pages[0]


def build_debug_overlay(page, anchor_locations: list[dict], widget_rects: list[dict], payload: dict, page_index: int):
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    packet = io.BytesIO()
    canvas_obj = canvas.Canvas(packet, pagesize=(page_width, page_height))

    for location in anchor_locations:
        rect = expand_rect(location, pad_x=2.5, pad_y=2.5, min_w=18, min_h=8)
        canvas_obj.setFillColor(Color(1, 1, 1, alpha=0.85))
        canvas_obj.rect(rect["x"], rect["y"], rect["width"], rect["height"], fill=1, stroke=0)
        canvas_obj.setStrokeColorRGB(0.8, 0.1, 0.1)
        canvas_obj.setLineWidth(1)
        canvas_obj.rect(rect["x"], rect["y"], rect["width"], rect["height"], fill=0, stroke=1)
        draw_label(
            canvas_obj,
            rect["x"],
            min(page_height - 14, rect["y"] + rect["height"] + 4),
            f'anchor {location.get("anchor")}',
            Color(0.8, 0.1, 0.1, alpha=0.95),
        )

    for rect in widget_rects:
        canvas_obj.setStrokeColorRGB(0.1, 0.45, 0.15)
        canvas_obj.setLineWidth(1.25)
        canvas_obj.rect(rect["x"], rect["y"], rect["width"], rect["height"], fill=0, stroke=1)
        draw_label(
            canvas_obj,
            rect["x"],
            max(8, rect["y"] - 12),
            f'{rect.get("type")} {rect.get("name")}',
            Color(0.1, 0.45, 0.15, alpha=0.95),
        )

    draw_page_header(canvas_obj, payload, page_index, page_width, page_height)
    canvas_obj.save()
    packet.seek(0)
    return PdfReader(packet).pages[0]


def draw_page_header(canvas_obj, payload: dict, page_index: int, page_width: float, page_height: float) -> None:
    canvas_obj.setFillColor(Color(0.12, 0.12, 0.12, alpha=0.92))
    canvas_obj.rect(18, page_height - 44, min(page_width - 36, 520), 24, fill=1, stroke=0)
    canvas_obj.setFillColorRGB(1, 1, 1)
    canvas_obj.setFont("Helvetica", 8)
    text = (
        f'Debug PDF | reservation {payload.get("reservationPublicId")} | '
        f'layout {payload.get("layoutVersion")} | page {page_index}'
    )
    canvas_obj.drawString(24, page_height - 35, text[:120])


def draw_label(canvas_obj, x: float, y: float, text: str, fill_color: Color) -> None:
    safe_text = text[:64]
    canvas_obj.setFont("Helvetica", 7)
    width = max(42, min(220, len(safe_text) * 4.2 + 8))
    canvas_obj.setFillColor(fill_color)
    canvas_obj.rect(x, y, width, 10, fill=1, stroke=0)
    canvas_obj.setFillColorRGB(1, 1, 1)
    canvas_obj.drawString(x + 3, y + 2.2, safe_text)


def expand_rect(location: dict, pad_x: float, pad_y: float, min_w: float, min_h: float) -> dict:
    width = max(min_w, float(location.get("width", 0)) + pad_x * 2)
    height = max(min_h, float(location.get("height", 0)) + pad_y * 2)
    x = float(location.get("x", 0)) - pad_x
    y = float(location.get("y", 0)) - pad_y
    return {"x": x, "y": y, "width": width, "height": height}


def group_by_page(items) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    for item in items:
        page = int(item.get("page", 0))
        if page <= 0:
            continue
        grouped.setdefault(page, []).append(item)
    return grouped


if __name__ == "__main__":
    raise SystemExit(main())
