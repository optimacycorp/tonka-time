import { Router, type RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { availabilityQuerySchema, reservationCreateSchema, reservationUpdateSchema } from "../lib/schemas.js";
import { optionalAuth } from "../lib/auth.js";
import { serializeReservation } from "../lib/orders.js";
import { calculatePricing, classifyDeliveryZone, isFriday, weekendEndDate } from "../lib/reservations.js";

const router = Router();
const minimumMachineInventory = 2;
const shortHoldMinutes = 3;
const reservedStatuses = ["PAYMENT_RECEIVED", "AWAITING_SIGNATURE", "AWAITING_ADMIN_REVIEW", "CONFIRMED"] as const;
const addressLookupUserAgent = "TonkaTimeRentals/0.1 (delivery-address-lookup)";
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use(optionalAuth);

router.get("/address/suggest", asyncRoute(async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 4) {
    return res.json({ suggestions: [] });
  }

  const suggestions = await fetchAddressCandidates(query, 5);
  return res.json({ suggestions });
}));

router.get("/address/geocode", asyncRoute(async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 4) {
    return res.status(400).json({ error: "Missing address query." });
  }

  const [result] = await fetchAddressCandidates(query, 1);
  return res.json({ result: result ?? null });
}));

router.get("/availability", asyncRoute(async (req, res) => {
  const parsed = availabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid startDate" });
  }

  const { startDate } = parsed.data;
  if (!isFriday(startDate)) {
    return res.status(400).json({ error: "Weekend start date must be a Friday." });
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${weekendEndDate(startDate)}T00:00:00.000Z`);
  const now = new Date();

  const [machines, reservations, blocks] = await Promise.all([
    prisma.machine.count({ where: { status: "ACTIVE" } }),
    prisma.reservation.count({
      where: {
        weekendStartDate: start,
        OR: [
          { status: { in: [...reservedStatuses] } },
          {
            status: { in: ["DRAFT", "PENDING_PAYMENT"] },
            holdExpiresAt: { gt: now },
          },
        ],
      },
    }),
    prisma.adminDateBlock.count({
      where: {
        startDate: { lte: end },
        endDate: { gte: start },
      },
    }),
  ]);

  const machineInventory = Math.max(machines, minimumMachineInventory);
  const availableMachineCount = Math.max(machineInventory - reservations, 0);
  const available = blocks === 0 && availableMachineCount > 0;

  return res.json({
    weekendStartDate: startDate,
    weekendEndDate: weekendEndDate(startDate),
    available,
    availableMachineCount,
    reason: available ? null : blocks > 0 ? "Admin blocked weekend" : "All machines are already reserved or on hold for that Friday.",
  });
}));

router.post("/reservations", asyncRoute(async (req, res) => {
  const parsed = reservationCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const weekendStartDate = parsed.data.weekendStartDate ?? nextFriday();
  if (!isFriday(weekendStartDate)) {
    return res.status(400).json({ error: "Weekend start date must be a Friday." });
  }

  const delivery = classifyDeliveryZone(parsed.data.jobsiteCity);
  const pricing = calculatePricing({
    deliveryFeeCents: delivery.deliveryFeeCents,
    damageWaiverChoice: parsed.data.damageWaiverChoice,
  });

  const reservation = await prisma.reservation.create({
    data: {
      publicId: `TTR-${new Date().getUTCFullYear()}-${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`,
      userId: res.locals.user?.id ?? null,
      status: "DRAFT",
      weekendStartDate: new Date(`${weekendStartDate}T00:00:00.000Z`),
      weekendEndDate: new Date(`${weekendEndDate(weekendStartDate)}T00:00:00.000Z`),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      jobsiteStreet: parsed.data.jobsiteStreet,
      jobsiteCity: parsed.data.jobsiteCity,
      jobsiteState: parsed.data.jobsiteState,
      jobsiteZip: parsed.data.jobsiteZip,
      gateAccessNotes: parsed.data.gateAccessNotes,
      surfaceAccessNotes: parsed.data.surfaceAccessNotes,
      workDescription: parsed.data.workDescription,
      isPropertyOwner: parsed.data.isPropertyOwner,
      ownerPermission: parsed.data.ownerPermission,
      deliveryZone: delivery.zone as "CORE" | "EXTENDED" | "MANUAL_REVIEW",
      deliveryFeeCents: pricing.deliveryFeeCents,
      damageWaiverChoice: parsed.data.damageWaiverChoice,
      damageWaiverFeeCents: pricing.damageWaiverFeeCents,
      rentalSubtotalCents: pricing.rentalSubtotalCents,
      depositCents: pricing.depositCents,
      totalDueCents: pricing.totalDueCents,
      colorado811Ticket: parsed.data.colorado811Ticket,
      checklistJson: parsed.data.checklist || parsed.data.tutorialAcknowledgement || parsed.data.waiverAcknowledged != null
        ? {
            checklist: parsed.data.checklist ?? {},
            tutorialAcknowledgement: parsed.data.tutorialAcknowledgement ?? {},
            waiverAcknowledged: parsed.data.waiverAcknowledged ?? false,
          }
        : undefined,
      holdExpiresAt: new Date(Date.now() + shortHoldMinutes * 60 * 1000),
    },
  });

  return res.status(201).json(serializeReservation(reservation));
}));

router.get("/reservations/:publicId", asyncRoute(async (req, res) => {
  const publicId = String(req.params.publicId);
  const reservation = await prisma.reservation.findUnique({ where: { publicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }
  return res.json(serializeReservation(reservation));
}));

router.patch("/reservations/:publicId", asyncRoute(async (req, res) => {
  const parsed = reservationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const publicId = String(req.params.publicId);
  const existing = await prisma.reservation.findUnique({ where: { publicId } });
  if (!existing) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const delivery = parsed.data.jobsiteCity ? classifyDeliveryZone(parsed.data.jobsiteCity) : null;
  const waiverChoice = parsed.data.damageWaiverChoice ?? existing.damageWaiverChoice;
  const {
    packageSlug: _packageSlug,
    checklist: _checklist,
    tutorialAcknowledgement: _tutorialAcknowledgement,
    waiverAcknowledged: _waiverAcknowledged,
    ...reservationFields
  } = parsed.data;
  const pricing = calculatePricing({
    deliveryFeeCents: delivery?.deliveryFeeCents ?? existing.deliveryFeeCents,
    damageWaiverChoice: waiverChoice,
  });

  const updated = await prisma.reservation.update({
    where: { publicId },
    data: {
      ...reservationFields,
      weekendStartDate: parsed.data.weekendStartDate ? new Date(`${parsed.data.weekendStartDate}T00:00:00.000Z`) : undefined,
      weekendEndDate: parsed.data.weekendStartDate ? new Date(`${weekendEndDate(parsed.data.weekendStartDate)}T00:00:00.000Z`) : undefined,
      deliveryZone: (delivery?.zone ?? existing.deliveryZone) as "CORE" | "EXTENDED" | "MANUAL_REVIEW",
      deliveryFeeCents: pricing.deliveryFeeCents,
      damageWaiverFeeCents: pricing.damageWaiverFeeCents,
      rentalSubtotalCents: pricing.rentalSubtotalCents,
      depositCents: pricing.depositCents,
      totalDueCents: pricing.totalDueCents,
      checklistJson: parsed.data.checklist || parsed.data.tutorialAcknowledgement || parsed.data.waiverAcknowledged != null
        ? {
            checklist: parsed.data.checklist ?? {},
            tutorialAcknowledgement: parsed.data.tutorialAcknowledgement ?? {},
            waiverAcknowledged: parsed.data.waiverAcknowledged ?? false,
          }
        : undefined,
    },
  });

  return res.json(serializeReservation(updated));
}));

function nextFriday() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (date.getUTCDay() !== 5) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

type AddressSuggestion = {
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
};

async function fetchAddressCandidates(query: string, limit: number): Promise<AddressSuggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": addressLookupUserAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Address lookup failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as Array<Record<string, unknown>>;
  return payload
    .map(toAddressSuggestion)
    .filter((value): value is AddressSuggestion => value != null);
}

function toAddressSuggestion(entry: Record<string, unknown>): AddressSuggestion | null {
  const address = entry.address;
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return null;
  }

  const parts = address as Record<string, unknown>;
  const streetNumber = firstString(parts.house_number);
  const road = firstString(parts.road);
  const street = [streetNumber, road].filter(Boolean).join(" ").trim();
  const city =
    firstString(parts.city) ??
    firstString(parts.town) ??
    firstString(parts.village) ??
    firstString(parts.hamlet);
  const state = firstString(parts.state_code) ?? firstString(parts.state);
  const zip = firstString(parts.postcode);
  const lat = Number.parseFloat(String(entry.lat ?? ""));
  const lon = Number.parseFloat(String(entry.lon ?? ""));

  if (!street || !city || !state || !zip || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    label: `${street}, ${city}, ${state} ${zip}`,
    street,
    city,
    state,
    zip,
    lat,
    lon,
  };
}

function firstString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default router;
