from __future__ import annotations

import sys
import zipfile
from pathlib import Path


CHECKBOX_TOKEN_LINES = [
    ("knows_boundaries", "I know my property boundaries."),
    ("understands_fence_not_boundary", "I understand fences, landscaping, and driveways may not be property lines."),
    ("has_owner_permission", "I have permission to dig at the approved jobsite."),
    ("not_digging_neighbor_property", "I will not dig on neighboring property."),
    ("not_digging_public_row_without_permit", "I will not dig in a public right-of-way without required permit or permission."),
    ("submitted_811_or_will_before_digging", "I submitted, or will submit before digging, a Colorado 811 request."),
    ("will_wait_for_locate_window", "I will wait for the locate window and review utility responses before digging."),
    ("understands_private_utilities", "I understand private utilities may not be marked by 811."),
    ("will_avoid_utility_tolerance_zone", "I will avoid utility tolerance zones unless hand digging and extra care are used as required."),
    ("will_not_undermine_structures", "I will not undermine structures, slabs, retaining walls, driveways, sidewalks, trees, slopes, roads, fences, or utilities without a safe plan."),
    ("will_keep_people_pets_away", "I will keep children, pets, vehicles, and bystanders away from the work area."),
    ("will_stop_if_unsafe", "I will stop and call Tonka Time Rentals if the machine leaks, overheats, throws a track, becomes stuck, or seems unsafe."),
    ("understands_equipment_may_be_tracked", "I understand the excavator may contain GPS, geofence, telematics, or anti-theft tracking technology."),
    ("consents_to_location_monitoring", "I consent to Tonka Time Rentals monitoring equipment location during the rental period and until the equipment is returned or recovered."),
    ("will_use_only_at_approved_jobsite", "I understand the excavator may be used only at the approved jobsite address."),
    ("will_not_move_without_approval", "I will not move the excavator to another property or jobsite without prior written approval."),
    ("will_not_transport_without_approval", "I will not load, haul, tow, or transport the excavator on my own trailer, truck, rollback, or other vehicle without prior written approval."),
    ("will_not_tamper_with_tracking_device", "I will not remove, disable, cover, block, or tamper with any GPS, tracker, lock, key, or security device."),
    ("understands_geofence_breach_consequences", "I understand that unauthorized movement, geofence breach, tracker tampering, or unapproved transport may result in rental termination, recovery fees, deposit retention, and additional claims."),
    ("received_quick_start_guide", "I received or had access to the quick start guide."),
    ("understands_basic_controls", "I understand the basic controls well enough to operate safely or will not operate."),
    ("knows_emergency_shutdown", "I know how to perform an emergency shutdown and lower the boom/bucket safely."),
    ("understands_tip_risk", "I understand rollover, tip-over, slope, overhead, and blind-spot risks."),
    ("will_watch_tutorial_videos", "I will watch the required tutorial videos before operating."),
    ("will_call_if_unsure", "I will call Tonka Time Rentals if I am unsure about safe operation or troubleshooting."),
    ("damage_waiver_acknowledged", "I understand the Limited Damage Waiver is not insurance and does not cover theft, rollover, submerged equipment, utility strikes, misuse, unauthorized operators, prohibited uses, transport damage, or third-party property damage."),
]


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: normalize_agreement_checkbox_template.py <template.docx> [more.docx...]")

    for raw_path in sys.argv[1:]:
        normalize_template(Path(raw_path))

    return 0


def normalize_template(path: Path) -> None:
    with zipfile.ZipFile(path, "r") as source_zip:
        files = {entry.filename: source_zip.read(entry.filename) for entry in source_zip.infolist()}

    document_xml = files["word/document.xml"].decode("utf-8")

    replacements = [
        (
            '<w:t xml:space="preserve"> [ ] Yes </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{is_property_owner_yes}}</w:t></w:r><w:r><w:t xml:space="preserve"> [ ] No </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{is_property_owner_no}}</w:t>',
            '<w:t xml:space="preserve"> [</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{is_property_owner_yes}}</w:t></w:r><w:r><w:t xml:space="preserve">] Yes [</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{is_property_owner_no}}</w:t></w:r><w:r><w:t xml:space="preserve">] No</w:t>',
        ),
        (
            '<w:t xml:space="preserve"> [ ] Yes </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{owner_permission_yes}}</w:t></w:r><w:r><w:t xml:space="preserve"> [ ] No </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{owner_permission_no}}</w:t>',
            '<w:t xml:space="preserve"> [</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{owner_permission_yes}}</w:t></w:r><w:r><w:t xml:space="preserve">] Yes [</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{owner_permission_no}}</w:t></w:r><w:r><w:t xml:space="preserve">] No</w:t>',
        ),
        (
            '<w:t xml:space="preserve"> [ ] Accept </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{damage_waiver_accept}}</w:t></w:r><w:r><w:t xml:space="preserve"> [ ] Decline </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{damage_waiver_decline}}</w:t>',
            '<w:t xml:space="preserve"> [</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{damage_waiver_accept}}</w:t></w:r><w:r><w:t xml:space="preserve">] Accept [</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{damage_waiver_decline}}</w:t></w:r><w:r><w:t xml:space="preserve">] Decline</w:t>',
        ),
    ]

    for original, replacement in replacements:
        document_xml = document_xml.replace(original, replacement)

    for token, label in CHECKBOX_TOKEN_LINES:
        original = (
            f'<w:t>[ ] {label} (</w:t></w:r>'
            f'<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{{{{token}}}}}</w:t></w:r>'
            f'<w:r><w:t>)</w:t>'
        )
        replacement = (
            f'<w:t>[</w:t></w:r>'
            f'<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>{{{{{token}}}}}</w:t></w:r>'
            f'<w:r><w:t>] {label}</w:t>'
        )
        document_xml = document_xml.replace(original, replacement)

    files["word/document.xml"] = document_xml.encode("utf-8")

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as target_zip:
        for name, payload in files.items():
            target_zip.writestr(name, payload)


if __name__ == "__main__":
    raise SystemExit(main())
