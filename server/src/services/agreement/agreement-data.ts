import { env } from "../../lib/config.js";
import { agreementTokens, type AgreementToken } from "./agreement-tokens.js";

export type AgreementData = Record<AgreementToken, string>;

export type ReservationAgreementSource = {
  id: string;
  publicId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  weekendStartDate: Date;
  weekendEndDate: Date;
  jobsiteStreet: string;
  jobsiteCity: string;
  jobsiteState: string;
  jobsiteZip: string;
  workDescription: string | null;
  colorado811Ticket: string | null;
  isPropertyOwner: boolean | null;
  ownerPermission: boolean | null;
  damageWaiverChoice: string;
  deliveryFeeCents: number;
  extendedFeeCents: number;
  damageWaiverFeeCents: number;
  rentalSubtotalCents: number;
  taxCents: number;
  depositCents: number;
  totalDueCents: number;
  stripeCheckoutSessionId: string | null;
  checklistJson: unknown;
  internalFlags: unknown;
};

type AgreementChecklistState = {
  checklist: Record<string, boolean>;
  tutorialAcknowledgement: Record<string, boolean>;
  waiverAcknowledged: boolean;
};

export function buildAgreementData(reservation: ReservationAgreementSource): AgreementData {
  const checklistState = getChecklistState(reservation.checklistJson);
  const snapshots = getAgreementSnapshots(reservation.internalFlags);
  const [workCategory, ...workNotes] = (reservation.workDescription ?? "").split(":");
  const normalizedCategory = workNotes.length > 0 ? workCategory.trim() : "";
  const normalizedWorkDescription = workNotes.length > 0 ? workNotes.join(":").trim() : reservation.workDescription ?? "";
  const signerName = `${reservation.firstName} ${reservation.lastName}`.trim();
  const acceptedWaiver = reservation.damageWaiverChoice === "ACCEPTED";

  const result = {
    attachments_included: normalizePlainText(snapshots.attachmentsIncludedSnapshot),
    authorized_operator_1: normalizePlainText(snapshots.authorizedOperator1Name),
    authorized_operator_1_phone: normalizePlainText(snapshots.authorizedOperator1Phone),
    authorized_operator_2: normalizePlainText(snapshots.authorizedOperator2Name),
    authorized_operator_2_phone: normalizePlainText(snapshots.authorizedOperator2Phone),
    consents_to_location_monitoring: printableCheck(checklistState.checklist.consentsToLocationMonitoring),
    damage_waiver_accept: printableCheck(acceptedWaiver),
    damage_waiver_acknowledged: printableCheck(checklistState.waiverAcknowledged),
    damage_waiver_choice: normalizePlainText(reservation.damageWaiverChoice),
    damage_waiver_decline: printableCheck(!acceptedWaiver),
    damage_waiver_deductible: normalizePlainText(snapshots.damageWaiverDeductible ?? ""),
    damage_waiver_fee: formatMoney(reservation.damageWaiverFeeCents),
    delivery_fee: formatMoney(reservation.deliveryFeeCents),
    email: normalizePlainText(reservation.email, 200),
    extended_delivery_fee: formatMoney(reservation.extendedFeeCents),
    fuel_level_in: normalizePlainText(snapshots.fuelLevelIn),
    fuel_level_out: normalizePlainText(snapshots.fuelLevelOut),
    has_owner_permission: printableCheck(checklistState.checklist.hasOwnerPermission),
    hour_meter_in: normalizePlainText(snapshots.hourMeterIn),
    hour_meter_out: normalizePlainText(snapshots.hourMeterOut),
    is_property_owner_no: printableCheck(reservation.isPropertyOwner === false),
    is_property_owner_yes: printableCheck(reservation.isPropertyOwner === true),
    jobsite_address: normalizePlainText(
      `${reservation.jobsiteStreet}, ${reservation.jobsiteCity}, ${reservation.jobsiteState} ${reservation.jobsiteZip}`,
      300,
    ),
    knows_boundaries: printableCheck(checklistState.checklist.knowsBoundaries),
    knows_emergency_shutdown: printableCheck(checklistState.tutorialAcknowledgement.knowsEmergencyShutdown),
    machine_serial: normalizePlainText(snapshots.machineSerialSnapshot),
    machine_unit: normalizePlainText(snapshots.machineUnitSnapshot),
    name: normalizePlainText(signerName, 200),
    not_digging_neighbor_property: printableCheck(checklistState.checklist.notDiggingNeighborProperty),
    not_digging_public_row_without_permit: printableCheck(checklistState.checklist.notDiggingPublicROWWithoutPermit),
    owner_permission_no: printableCheck(reservation.ownerPermission === false),
    owner_permission_yes: printableCheck(reservation.ownerPermission === true),
    payment_reference: normalizePlainText(reservation.stripeCheckoutSessionId || reservation.publicId, 200),
    phone: normalizePlainText(reservation.phone, 50),
    received_quick_start_guide: printableCheck(checklistState.tutorialAcknowledgement.receivedQuickStartGuide),
    reservation_id: normalizePlainText(reservation.publicId, 100),
    security_deposit: formatMoney(reservation.depositCents),
    submitted_811_or_will_before_digging: printableCheck(checklistState.checklist.submitted811OrWillBeforeDigging),
    taxes: formatMoney(reservation.taxCents),
    ticket_811: normalizePlainText(reservation.colorado811Ticket, 100),
    total_due: formatMoney(reservation.totalDueCents),
    tutorial_completion_status: normalizePlainText(
      snapshots.tutorialCompletedAt
        ? `Completed ${formatDate(new Date(snapshots.tutorialCompletedAt))}`
        : allTruthy(checklistState.tutorialAcknowledgement)
          ? "Completed"
          : "Pending",
      200,
    ),
    tutorial_video_version: normalizePlainText(snapshots.tutorialVideoVersion || "quick-start-v1", 100),
    understands_basic_controls: printableCheck(checklistState.tutorialAcknowledgement.understandsBasicControls),
    understands_equipment_may_be_tracked: printableCheck(checklistState.checklist.understandsEquipmentMayBeTracked),
    understands_fence_not_boundary: printableCheck(checklistState.checklist.understandsFenceNotBoundary),
    understands_geofence_breach_consequences: printableCheck(checklistState.checklist.understandsGeofenceBreachConsequences),
    understands_private_utilities: printableCheck(checklistState.checklist.understandsPrivateUtilities),
    understands_tip_risk: printableCheck(checklistState.tutorialAcknowledgement.understandsTipRisk),
    weekend_end: formatDate(reservation.weekendEndDate),
    weekend_rental_charge: formatMoney(reservation.rentalSubtotalCents),
    weekend_start: formatDate(reservation.weekendStartDate),
    will_avoid_utility_tolerance_zone: printableCheck(checklistState.checklist.willAvoidUtilityToleranceZone),
    will_call_if_unsure: printableCheck(checklistState.tutorialAcknowledgement.willCallIfUnsure),
    will_keep_people_pets_away: printableCheck(checklistState.checklist.willKeepPeoplePetsAway),
    will_not_move_without_approval: printableCheck(checklistState.checklist.willNotMoveWithoutApproval),
    will_not_tamper_with_tracking_device: printableCheck(checklistState.checklist.willNotTamperWithTrackingDevice),
    will_not_transport_without_approval: printableCheck(checklistState.checklist.willNotTransportWithoutApproval),
    will_not_undermine_structures: printableCheck(checklistState.checklist.willNotUndermineStructures),
    will_stop_if_unsafe: printableCheck(checklistState.checklist.willStopIfUnsafe),
    will_use_only_at_approved_jobsite: printableCheck(checklistState.checklist.willUseOnlyAtApprovedJobsite),
    will_wait_for_locate_window: printableCheck(checklistState.checklist.willWaitForLocateWindow),
    will_watch_tutorial_videos: printableCheck(checklistState.tutorialAcknowledgement.willWatchTutorialVideos),
    work_category: normalizePlainText(normalizedCategory, 100),
    work_description: normalizePlainText(normalizedWorkDescription, 1000),
  } satisfies AgreementData;

  for (const token of agreementTokens) {
    if (result[token] == null) {
      throw new Error(`Agreement token ${token} did not resolve to a printable string.`);
    }
  }

  return result;
}

function getChecklistState(value: unknown): AgreementChecklistState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      checklist: {},
      tutorialAcknowledgement: {},
      waiverAcknowledged: false,
    };
  }

  const root = value as Record<string, unknown>;
  return {
    checklist: isBooleanMap(root.checklist) ? root.checklist : {},
    tutorialAcknowledgement: isBooleanMap(root.tutorialAcknowledgement) ? root.tutorialAcknowledgement : {},
    waiverAcknowledged: root.waiverAcknowledged === true,
  };
}

function getAgreementSnapshots(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const root = value as Record<string, unknown>;
  const agreement = root.agreement;
  if (!agreement || typeof agreement !== "object" || Array.isArray(agreement)) {
    return {};
  }

  return agreement as Record<string, string | null | undefined>;
}

function isBooleanMap(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "boolean");
}

function printableCheck(value: boolean | undefined) {
  return value ? "X" : "";
}

function formatMoney(cents: number | null | undefined) {
  if (cents == null) {
    return "";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: env.STRIPE_CURRENCY.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function normalizePlainText(value: unknown, maxLength = 500) {
  if (value == null) {
    return "";
  }

  const stringValue = String(value);
  if (/<[a-z!/][^>]*>/i.test(stringValue)) {
    throw new Error("Agreement data cannot contain HTML.");
  }

  const withoutControls = stringValue.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const normalizedWhitespace = withoutControls
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalizedWhitespace.slice(0, maxLength);
}

function allTruthy(values: Record<string, boolean>) {
  const entries = Object.values(values);
  return entries.length > 0 && entries.every(Boolean);
}
