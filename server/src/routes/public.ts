import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { availabilityQuerySchema, reservationCreateSchema, reservationUpdateSchema } from "../lib/schemas.js";
import { calculatePricing, classifyDeliveryZone, isFriday, weekendEndDate } from "../lib/reservations.js";

const router = Router();

router.get("/availability", async (req, res) => {
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

  const [machines, reservations, blocks] = await Promise.all([
    prisma.machine.count({ where: { status: "ACTIVE" } }),
    prisma.reservation.count({
      where: {
        weekendStartDate: start,
        status: { in: ["PENDING_PAYMENT", "PAYMENT_RECEIVED", "AWAITING_SIGNATURE", "CONFIRMED"] },
      },
    }),
    prisma.adminDateBlock.count({
      where: {
        startDate: { lte: end },
        endDate: { gte: start },
      },
    }),
  ]);

  const availableMachineCount = Math.max(machines - reservations, 0);
  const available = blocks === 0 && availableMachineCount > 0;

  return res.json({
    weekendStartDate: startDate,
    weekendEndDate: weekendEndDate(startDate),
    available,
    availableMachineCount,
    reason: available ? null : blocks > 0 ? "Admin blocked weekend" : "No active machines available",
  });
});

router.post("/reservations", async (req, res) => {
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
      holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  return res.status(201).json(reservation);
});

router.get("/reservations/:publicId", async (req, res) => {
  const reservation = await prisma.reservation.findUnique({ where: { publicId: req.params.publicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }
  return res.json(reservation);
});

router.patch("/reservations/:publicId", async (req, res) => {
  const parsed = reservationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const existing = await prisma.reservation.findUnique({ where: { publicId: req.params.publicId } });
  if (!existing) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const delivery = parsed.data.jobsiteCity ? classifyDeliveryZone(parsed.data.jobsiteCity) : null;
  const waiverChoice = parsed.data.damageWaiverChoice ?? existing.damageWaiverChoice;
  const pricing = calculatePricing({
    deliveryFeeCents: delivery?.deliveryFeeCents ?? existing.deliveryFeeCents,
    damageWaiverChoice: waiverChoice,
  });

  const updated = await prisma.reservation.update({
    where: { publicId: req.params.publicId },
    data: {
      ...parsed.data,
      weekendStartDate: parsed.data.weekendStartDate ? new Date(`${parsed.data.weekendStartDate}T00:00:00.000Z`) : undefined,
      weekendEndDate: parsed.data.weekendStartDate ? new Date(`${weekendEndDate(parsed.data.weekendStartDate)}T00:00:00.000Z`) : undefined,
      deliveryZone: (delivery?.zone ?? existing.deliveryZone) as "CORE" | "EXTENDED" | "MANUAL_REVIEW",
      deliveryFeeCents: pricing.deliveryFeeCents,
      damageWaiverFeeCents: pricing.damageWaiverFeeCents,
      rentalSubtotalCents: pricing.rentalSubtotalCents,
      depositCents: pricing.depositCents,
      totalDueCents: pricing.totalDueCents,
    },
  });

  return res.json(updated);
});

function nextFriday() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (date.getUTCDay() !== 5) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export default router;
