# Enhanced OpenSign Field Map for Tonka Time Weekend Rental Agreement

Use this field map with the Tonka Time OpenSign agreement PDF when creating or revising the reusable OpenSign template.

## Required signer role

Create one signer role named exactly:

- `Customer`

The Tonka backend creates the live document instance and injects the reservation customer into that role automatically. You generally want to save the template, not manually send it from the template editor.

## Core prefill text fields

- `reservation_id`
- `name`
- `email`
- `phone`
- `payment_reference`
- `weekend_start`
- `weekend_end`
- `jobsite_address`
- `ticket_811`
- `work_category`
- `work_description`
- `machine_unit`
- `machine_serial`
- `hour_meter_out`
- `hour_meter_in`
- `fuel_level_out`
- `fuel_level_in`
- `attachments_included`

## Pricing and payment fields

- `weekend_rental_charge`
- `delivery_fee`
- `extended_delivery_fee`
- `damage_waiver_fee`
- `damage_waiver_deductible`
- `taxes`
- `security_deposit`
- `total_due`

## Authorized operator fields

- `authorized_operator_1`
- `authorized_operator_1_phone`
- `authorized_operator_2`
- `authorized_operator_2_phone`

## Property representation fields

- `is_property_owner_yes`
- `is_property_owner_no`
- `owner_permission_yes`
- `owner_permission_no`

## Homeowner dig checklist checkboxes

- `knows_boundaries`
- `understands_fence_not_boundary`
- `has_owner_permission`
- `not_digging_neighbor_property`
- `not_digging_public_row_without_permit`
- `submitted_811_or_will_before_digging`
- `will_wait_for_locate_window`
- `understands_private_utilities`
- `will_avoid_utility_tolerance_zone`
- `will_not_undermine_structures`
- `will_keep_people_pets_away`
- `will_stop_if_unsafe`
- `understands_equipment_may_be_tracked`
- `consents_to_location_monitoring`
- `will_use_only_at_approved_jobsite`
- `will_not_move_without_approval`
- `will_not_transport_without_approval`
- `will_not_tamper_with_tracking_device`
- `understands_geofence_breach_consequences`

## Tutorial acknowledgement fields

- `received_quick_start_guide`
- `understands_basic_controls`
- `knows_emergency_shutdown`
- `understands_tip_risk`
- `will_watch_tutorial_videos`
- `will_call_if_unsure`
- `tutorial_video_version`
- `tutorial_completion_status`

## Damage waiver fields

- `damage_waiver_choice`
- `damage_waiver_accept`
- `damage_waiver_decline`
- `damage_waiver_acknowledged`

## Signature and internal fields

- One signature field for signer role `Customer`
- One date field next to the customer signature
- Optional internal countersignature field
- Optional internal date field
- `date_signed`
- `date_countersigned`
- `internal_approval_note`

## Recommended required initials blocks

The enhanced agreement includes blank initial lines after several high-risk sections. In OpenSign, you can place initials fields there or keep printed blank lines if you prefer a lighter implementation.

Recommended initials fields:

- `initials_authorized_operator`
- `initials_811_private_utilities`
- `initials_tutorial_not_training`
- `initials_damage_waiver_limits`

## What the current app already collects

The current reservation app flow already collects or derives:

- `reservation_id`
- `name`
- `email`
- `phone`
- `weekend_start`
- `weekend_end`
- `jobsite_address`
- `ticket_811`
- `work_category`
- `work_description`
- `damage_waiver_choice`
- `is_property_owner_yes` / `is_property_owner_no`
- `owner_permission_yes` / `owner_permission_no`
- All homeowner dig checklist fields listed above, including the geofence/location acknowledgements
- All tutorial acknowledgement fields except version/status metadata

## Fields not yet collected by the current app/backend

These are valuable in the enhanced agreement, but the current app does not yet gather or prefill them automatically:

- `payment_reference`
- `machine_unit`
- `machine_serial`
- `hour_meter_out`
- `hour_meter_in`
- `fuel_level_out`
- `fuel_level_in`
- `attachments_included`
- `weekend_rental_charge`
- `delivery_fee`
- `extended_delivery_fee`
- `damage_waiver_fee`
- `damage_waiver_deductible`
- `taxes`
- `security_deposit`
- `total_due`
- `authorized_operator_1`
- `authorized_operator_1_phone`
- `authorized_operator_2`
- `authorized_operator_2_phone`
- `tutorial_video_version`
- `tutorial_completion_status`
- `date_signed`
- `date_countersigned`
- `internal_approval_note`
- The recommended initials fields, unless you wire them in later

For now, you can leave those as OpenSign-only fields, internal-use fields, or printed blanks. If you want, we can wire the missing fields into the reservation app and backend in the next sprint.

## Practical OpenSign build steps

1. Upload the latest Tonka Time agreement PDF or DOCX into OpenSign.
2. Create signer role `Customer`.
3. Assign the customer signature, initials, and date fields to `Customer`.
4. Place text fields using the exact field names above.
5. Place checkbox fields for the dig checklist, tutorial acknowledgements, property representations, geofence acknowledgements, and waiver election.
6. Save or publish the template so it remains reusable.
7. Do not manually send the template for the production Tonka flow unless you are separately testing OpenSign by itself.
8. Copy the template ID into:

   `OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL`

9. Confirm the OpenSign auth settings used by the Tonka app are set:

   `OPENSIGN_MASTER_KEY`
   `OPENSIGN_USERNAME`
   `OPENSIGN_PASSWORD`
