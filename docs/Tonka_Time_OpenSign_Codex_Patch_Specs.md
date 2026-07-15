# Tonka Time OpenSign Codex Patch Specs

## Scope

This document is the broader modernization plan for Tonka Time agreement generation, PDF storage, and OpenSign signing orchestration.

It should be treated as the parent plan for the focused anchor-widget sprint track documented in [Tonka_Time_DOCX_Anchor_to_OpenSign_Widget_Sprints.md](C:/Users/Costandine_T/Downloads/tonka-time/docs/Tonka_Time_DOCX_Anchor_to_OpenSign_Widget_Sprints.md).

## Broader Workstreams

### 1. Reservation and Agreement Data Model

- Preserve immutable agreement snapshots per reservation.
- Store template version, render hash, and generated artifact paths.
- Link reservation records to OpenSign document/session identifiers.

### 2. DOCX Variable Rendering

- Use DOCX as the editable legal/business source.
- Replace ordinary `{{variable}}` placeholders before PDF conversion.
- Fail rendering if unresolved variables remain.

### 3. PDF Generation and Storage

- Convert DOCX to PDF as the signing artifact.
- Store unsigned and signed artifacts with stable hashes and version metadata.
- Preserve a reproducible render pipeline for support and compliance review.

### 4. OpenSign Signing Experience

- Restrict signer interaction to initials, signature, and date actions.
- Keep reservation data out of editable OpenSign text fields when already rendered into the PDF.
- Maintain a signer-specific embedded signing flow inside the reservation experience.

### 5. Validation and Diagnostics

- Validate page counts and geometry after conversion.
- Provide admin-visible debug and health outputs.
- Prevent release when template drift breaks expected signing layout.

### 6. Anchor-Generated Widget Placement

This workstream is handled by the dedicated sprint sequence:

- Sprint A1
- Sprint A2
- Sprint A3
- Sprint A4
- Sprint A5
- Sprint A6

See [Tonka_Time_DOCX_Anchor_to_OpenSign_Widget_Sprints.md](C:/Users/Costandine_T/Downloads/tonka-time/docs/Tonka_Time_DOCX_Anchor_to_OpenSign_Widget_Sprints.md) for the detailed implementation plan.

## Recommended Execution Order

1. Complete and harden the ordinary DOCX `{{variable}}` renderer.
2. Establish immutable agreement artifact storage and metadata.
3. Execute the anchor-widget sprint sequence.
4. Gate production rollout on debug-PDF review and regression coverage.
