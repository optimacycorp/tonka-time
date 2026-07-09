# OpenSign Field Map for Tonka Time Weekend Rental Agreement

Use this alongside the agreement template when you build the OpenSign template.

## Required signer role

Create one signer role named exactly:

- `Customer`

The current Tonka backend expects that signer role name when it creates the document session.

## Recommended document fields

Add these text fields to the template:

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

## Recommended checkbox groups

Add one checkbox for each checklist item:

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

Add one checkbox for each tutorial acknowledgement:

- `received_quick_start_guide`
- `understands_basic_controls`
- `knows_emergency_shutdown`
- `understands_tip_risk`
- `will_watch_tutorial_videos`
- `will_call_if_unsure`

Add damage waiver selection fields:

- `damage_waiver_accept`
- `damage_waiver_decline`
- `damage_waiver_acknowledged`

Add property representation fields:

- `is_property_owner_yes`
- `is_property_owner_no`
- `owner_permission_yes`
- `owner_permission_no`

## Signature fields

Add:

- One signature field for signer role `Customer`
- One date field next to the customer signature

If you want Tonka to countersign later, add:

- One signature field for an internal signer or approver
- One date field for countersignature

## Notes about current backend prefill support

The current Tonka backend is already wired to send these values automatically when available:

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
- `is_property_owner`
- `owner_permission`

Additional checkbox fields in this guide are recommended for the OpenSign template and can be wired for deeper automatic prefill in a follow-up patch.

## Practical OpenSign build steps

1. Upload the agreement template text into a document you can import into OpenSign.
2. Create a signer role named `Customer`.
3. Place the signature and date fields at the signature section.
4. Add text fields using the exact names above.
5. Add checkbox fields for the checklist, tutorial acknowledgements, waiver choice, and property representations.
6. Publish the template and copy its template ID into:

   `OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL`

7. Confirm the API key is set in:

   `OPENSIGN_API_KEY`
