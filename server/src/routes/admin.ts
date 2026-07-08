import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { cancelReservationByPublicId, serializeReservation } from "../lib/orders.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use(requireAuth);
router.use(requireRole("ADMIN"));

router.get("/reservations", asyncRoute(async (_req, res) => {
  const reservations = await prisma.reservation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      notifications: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  return res.json(reservations.map((reservation) => ({
    ...serializeReservation(reservation),
    user: reservation.user,
    notifications: reservation.notifications,
  })));
}));

router.patch("/reservations/:id", asyncRoute(async (req, res) => {
  const parsed = z
    .object({
      status: z
        .enum(["DRAFT", "PENDING_PAYMENT", "PAYMENT_RECEIVED", "AWAITING_SIGNATURE", "AWAITING_ADMIN_REVIEW", "CONFIRMED", "COMPLETED", "CANCELLED"])
        .optional(),
      machineId: z.string().optional(),
      adminNotes: z.string().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const reservation = await prisma.reservation.update({
    where: { id: String(req.params.id) },
    data: parsed.data,
  });

  return res.json(reservation);
}));

router.post("/reservations/:publicId/cancel", asyncRoute(async (req, res) => {
  const result = await cancelReservationByPublicId({
    publicId: String(req.params.publicId),
    initiatedBy: "admin",
    actorUserId: res.locals.user.id as string,
  });

  return res.json(result);
}));

router.get("/notifications", asyncRoute(async (_req, res) => {
  const notifications = await prisma.notificationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return res.json(notifications);
}));

router.post("/block-date", asyncRoute(async (req, res) => {
  const parsed = z
    .object({
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().min(1),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const block = await prisma.adminDateBlock.create({
    data: {
      startDate: new Date(`${parsed.data.startDate}T00:00:00.000Z`),
      endDate: new Date(`${parsed.data.endDate}T00:00:00.000Z`),
      reason: parsed.data.reason,
    },
  });

  return res.status(201).json(block);
}));

router.post("/machines/:id/service-block", asyncRoute(async (req, res) => {
  const parsed = z
    .object({
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().min(1),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const block = await prisma.maintenanceBlock.create({
    data: {
      machineId: String(req.params.id),
      startDate: new Date(`${parsed.data.startDate}T00:00:00.000Z`),
      endDate: new Date(`${parsed.data.endDate}T00:00:00.000Z`),
      reason: parsed.data.reason,
    },
  });

  return res.status(201).json(block);
}));

router.post("/uploads/video", asyncRoute(async (_req, res) => {
  return res.status(501).json({ error: "Connect S3-compatible storage or UploadThing before enabling video uploads." });
}));

router.post("/uploads/site-photo", asyncRoute(async (_req, res) => {
  return res.status(501).json({ error: "Site photo uploads are scaffolded but not wired to storage yet." });
}));

export default router;
