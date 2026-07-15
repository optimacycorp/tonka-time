# Tonka Time DOCX Anchor to OpenSign Widget Sprints

## Purpose

This sprint track converts the Tonka weekend rental agreement into an anchor-driven PDF-to-OpenSign workflow built from a DOCX source of truth.

The editable source remains DOCX. Reservation data still fills ordinary `{{variable}}` placeholders before PDF conversion. The additional work in this document is focused on locating signing anchors after PDF generation so OpenSign widgets can be created from the generated PDF instead of relying on a static OpenSign template layout.

This document is a focused subproject under the broader agreement-generation and OpenSign modernization effort.

## Current Baseline

The existing implementation direction already covers these ideas at a partial level:

- DOCX remains the editable agreement source.
- Backend data replaces `{{variables}}` before the signing handoff.
- DOCX is converted to PDF for customer-facing signing.
- OpenSign should be restricted to initials, signatures, and dates.
- Page count and geometry should be validated.
- The uploaded artifact should be the generated PDF, not the DOCX.

The missing detail is the anchor-based widget system:

- `[[OS_INITIAL_811]]`
- `[[OS_SIGNATURE_CUSTOMER]]`
- `[[OS_DATE_SIGNED]]`

The earlier approach assumes either fixed coordinates or copying widgets from a static OpenSign template. It does not fully define how to:

- locate anchors in the generated PDF
- reconstruct anchors that are split across PDF text runs
- hide anchor text in the customer-facing PDF
- translate located anchors into the self-hosted OpenSign widget payload
- generate a visual diagnostic PDF for admin review

## Target Architecture

1. A versioned DOCX template contains both ordinary `{{variable}}` placeholders and fixed signing anchors like `[[OS_SIGNATURE_CUSTOMER]]`.
2. The backend resolves `{{variable}}` placeholders before PDF conversion.
3. The DOCX is converted to PDF.
4. A PDF anchor locator finds each `[[OS_*]]` token and computes page-relative rectangles.
5. The system masks anchor text in the customer-facing PDF.
6. A diagnostic PDF is generated for admin review with boxes, labels, and widget metadata.
7. The production flow uploads the generated PDF to self-hosted OpenSign and creates signature widgets programmatically from the located anchors.

## Anchor Contract

All signable fields must be represented by explicit anchors in the DOCX:

- `[[OS_INITIAL_811]]`
- `[[OS_INITIAL_TUTORIAL]]`
- `[[OS_INITIAL_DAMAGE_WAIVER]]`
- `[[OS_SIGNATURE_CUSTOMER]]`
- `[[OS_DATE_SIGNED]]`

Rules:

- Every required anchor must appear exactly once unless explicitly marked repeatable.
- Anchors must live in fixed-size table cells or similarly stable layout containers.
- Anchors must not share a line with normal editable text.
- Anchor naming must be immutable once a template layout version ships.
- Layout changes require a new template version and anchor-layout version.

## Sprint A1 - Anchor Contract and DOCX Update

### Goal

Prepare the DOCX source and backend metadata for anchor-based widget generation.

### Deliverables

- Canonical anchor registry committed in code and docs.
- Updated DOCX template with anchors inserted at each required signing location.
- Fixed-size DOCX containers for anchors so conversion remains stable.
- Template version metadata and anchor-layout version metadata.
- Validation that every required anchor appears exactly once in the source DOCX.

### Implementation Notes

- Keep `{{variable}}` replacement separate from `[[OS_*]]` anchor handling.
- Add a validation script that scans DOCX XML for the anchor registry before conversion.
- Store anchor metadata in a machine-readable module, not just prose docs.

### Exit Criteria

- The DOCX template includes every required anchor.
- Validation fails if an anchor is missing, duplicated, or renamed unexpectedly.
- A template version identifier is available to later signing/debug pipelines.

## Sprint A2 - PDF Anchor Locator

### Goal

Find all anchors in the generated PDF reliably after DOCX conversion.

### Deliverables

- Anchor locator implemented with `pdfjs-dist`.
- Reconstruction logic for anchors split across multiple PDF text runs.
- Page-level anchor lookup results with normalized rectangles.
- Fail-fast behavior when a required anchor cannot be located.

### Implementation Notes

- Read text items in render order per page.
- Build a searchable token stream while preserving page geometry.
- Merge adjacent runs when the combined text could form an anchor token.
- Record page number, bounding box, text content, and confidence/debug data.

### Exit Criteria

- Every required anchor is found in the generated PDF.
- Split-run anchors are resolved correctly.
- Locator output is deterministic for the same PDF bytes.

## Sprint A3 - Anchor Masking and Diagnostics

### Goal

Hide anchors from the customer-facing PDF and prove visually that widget placement is correct before API submission is enabled.

### Deliverables

- Customer-facing masked PDF with anchor text covered.
- Admin-only diagnostic PDF with:
  - anchor bounding boxes
  - widget labels
  - page numbers
  - final widget rectangles
  - template version and layout version
- Masking pipeline that preserves signing geometry.

### Implementation Notes

- Mask anchor text only after location is finalized.
- Keep debug output separate from the customer-facing artifact.
- Include color-coded widget classes for initials, signature, and date.

### Exit Criteria

- No raw `[[OS_*]]` tokens are visible in the customer PDF.
- Debug PDF makes each widget rectangle visually obvious.
- Team review can confirm the placements without reading raw JSON.

## Sprint A4 - Self-Hosted OpenSign Widget Adapter

### Goal

Build against the actual widget payload accepted by the self-hosted OpenSign installation rather than relying on hosted examples.

### Deliverables

- Captured known-good payloads from the live self-hosted OpenSign environment.
- Adapter module that maps located anchors into that payload schema.
- Widget factories for initials, signature, and date fields.
- Integration notes documenting version-specific OpenSign behavior.

### Implementation Notes

- Capture payloads from the deployed OpenSign instance and save sanitized examples.
- Preserve page indexes, width/height semantics, and role assignment rules exactly as the local OpenSign stack expects.
- Keep adapter logic isolated from the PDF locator.

### Exit Criteria

- Adapter can generate a valid payload for the current self-hosted OpenSign version.
- Payload generation is tested from anchor rectangles, not hand-entered coordinates.

## Sprint A5 - Direct Document Creation

### Goal

Generate OpenSign documents directly from the completed PDF plus programmatic widget definitions.

### Deliverables

- Upload path for the generated PDF artifact.
- Programmatic widget creation from anchor locator output.
- Removal of dependency on manually configured sign widgets in the OpenSign UI.
- Reservation-to-document linkage storing template version, layout version, and uploaded PDF hash.

### Implementation Notes

- No DOCX upload to OpenSign.
- No ordinary text widgets in OpenSign for reservation data mapping.
- Reservation data should already be burned into the PDF before upload.

### Exit Criteria

- A reservation can create an OpenSign document from a generated PDF only.
- Customer sees only initials/signature/date actions.
- Widget placement matches the debug PDF output.

## Sprint A6 - Regression Tests and Deployment

### Goal

Add release safeguards and operational controls for the new signing pipeline.

### Deliverables

- Golden-file tests for template rendering and anchor positions.
- Layout tolerance checks for page count and anchor drift.
- Health checks for DOCX render, PDF locate, mask, and widget creation steps.
- Admin status panel for template version, render result, anchor validation, and debug PDF access.
- Feature flag and staged rollout controls.

### Implementation Notes

- Include at least one golden PDF per active template version.
- Fail deployment if required anchors move beyond tolerance.
- Make the anchor-widget path switchable until production confidence is established.

### Exit Criteria

- Regression suite catches template drift before release.
- Operators can inspect current template version and debug output.
- Feature flag allows rollback to the previous signing path if needed.

## Recommended Delivery Order

1. Finish the ordinary `{{variable}}` DOCX renderer.
2. Complete Sprint A1.
3. Complete Sprint A2.
4. Stop and review Sprint A3 outputs carefully.
5. Only after the debug PDF is trusted, enable Sprint A4 and Sprint A5 API submission work.
6. Finish Sprint A6 before broad production rollout.

## Most Important Checkpoint

The end of Sprint A3 is the gating checkpoint for the entire anchor system.

Before any production widget submission code is enabled, the generated debug PDF must visually prove that every initials, signature, and date rectangle is correct on the final rendered PDF.

## Relationship to the Broader Agreement Project

Broader agreement project

- Reservation data model
- DOCX variable merging
- PDF generation and storage
- Immutable agreement versions
- Signed-document retrieval
- Anchor-generated OpenSign widgets

The anchor-generated OpenSign widgets branch contains:

- Sprint A1
- Sprint A2
- Sprint A3
- Sprint A4
- Sprint A5
- Sprint A6
