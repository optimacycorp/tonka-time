#!/usr/bin/env python3

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: render_signed_agreement.py <payload.json>")

    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    source_pdf = Path(payload["sourcePdfPath"])
    output_pdf = Path(payload["outputPdfPath"])
    signature_rect = payload["signatureRect"]
    date_rect = payload["dateRect"]
    signed_date = payload["signedDateText"]
    signature_data_url = payload["signatureDataUrl"]

    image_bytes = decode_data_url(signature_data_url)
    image = ImageReader(io.BytesIO(image_bytes))

    reader = PdfReader(str(source_pdf))
    writer = PdfWriter()

    for index, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        overlay_stream = io.BytesIO()
        overlay = canvas.Canvas(overlay_stream, pagesize=(width, height))

        if index == int(signature_rect["page"]):
            draw_signature(overlay, image, signature_rect, page_height=height)

        if index == int(date_rect["page"]):
            draw_date(overlay, signed_date, date_rect, page_height=height)

        overlay.save()
        overlay_stream.seek(0)
        overlay_pdf = PdfReader(overlay_stream)
        if overlay_pdf.pages:
            page.merge_page(overlay_pdf.pages[0])
        writer.add_page(page)

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with output_pdf.open("wb") as handle:
        writer.write(handle)


def decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Invalid signature data URL.")
    return base64.b64decode(data_url.split(",", 1)[1])


def draw_signature(pdf_canvas: canvas.Canvas, image: ImageReader, rect: dict, page_height: float) -> None:
    x = float(rect["x"])
    width = float(rect["width"])
    height = float(rect["height"])
    bottom = float(rect["y"])

    image_width, image_height = image.getSize()
    scale = min(width / image_width, height / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    offset_x = x + (width - draw_width) / 2
    offset_y = bottom + (height - draw_height) / 2

    pdf_canvas.drawImage(
        image,
        offset_x,
        offset_y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=True,
        mask="auto",
    )


def draw_date(pdf_canvas: canvas.Canvas, signed_date: str, rect: dict, page_height: float) -> None:
    x = float(rect["x"])
    height = float(rect["height"])
    bottom = float(rect["y"])
    pdf_canvas.setFont("Helvetica", 11)
    pdf_canvas.drawString(x, bottom + max(2, height * 0.2), signed_date)


if __name__ == "__main__":
    main()
