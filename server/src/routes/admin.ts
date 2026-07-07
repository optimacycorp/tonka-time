import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { adminEmails } from "../lib/config.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use((req, res, next) => {
  const adminEmail = req.header("x-admin-email")?.toLowerCase();
  if (!adminEmail || !adminEmails.includes(adminEmail)) {
    return res.status(401).json({ error: "Admin access required" });
  }
  next();
});

router.get("/reservations", asyncRoute(async (_req, res) => {
  const reservations = await prisma.reservation.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json(reservations);
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
