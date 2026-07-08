import { Router, type RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { cancelReservationByPublicId, serializeReservation } from "../lib/orders.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use(requireAuth);

router.get("/reservations", asyncRoute(async (_req, res) => {
  const userId = res.locals.user.id as string;
  const reservations = await prisma.reservation.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return res.json(reservations.map(serializeReservation));
}));

router.get("/notifications", asyncRoute(async (_req, res) => {
  const userId = res.locals.user.id as string;
  const notifications = await prisma.notificationLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return res.json(notifications);
}));

router.post("/reservations/:publicId/cancel", asyncRoute(async (req, res) => {
  const publicId = String(req.params.publicId);
  const userId = res.locals.user.id as string;
  const reservation = await prisma.reservation.findUnique({
    where: { publicId },
  });

  if (!reservation || reservation.userId !== userId) {
    return res.status(404).json({ error: "Reservation not found." });
  }

  const result = await cancelReservationByPublicId({
    publicId,
    initiatedBy: reservation.email || reservation.phone || "customer",
    actorUserId: userId,
  });

  return res.json(result);
}));

export default router;
