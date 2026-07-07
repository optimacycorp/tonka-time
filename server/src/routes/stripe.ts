import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.post("/create-checkout-session", async (req, res) => {
  const parsed = z.object({ reservationPublicId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId: parsed.data.reservationPublicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      paymentStatus: "CHECKOUT_CREATED",
      status: "PENDING_PAYMENT",
      stripeCheckoutSessionId: `cs_test_${reservation.publicId}`,
    },
  });

  return res.json({
    checkoutUrl: `/reserve/payment?reservation=${reservation.publicId}`,
    mode: "placeholder",
    message: "Replace this placeholder with a live Stripe Checkout Session before launch.",
  });
});

router.post("/webhook", async (req, res) => {
  const eventType = req.body?.type;
  const publicId = req.body?.data?.object?.metadata?.reservationPublicId;

  await prisma.webhookEvent.create({
    data: {
      provider: "STRIPE",
      providerEventId: req.body?.id,
      reservationId: publicId ?? null,
      eventType: eventType ?? "unknown",
      payload: req.body ?? {},
      processedAt: new Date(),
    },
  });

  if (eventType === "checkout.session.completed" && publicId) {
    await prisma.reservation.update({
      where: { publicId },
      data: {
        paymentStatus: "PAID",
        status: "PAYMENT_RECEIVED",
      },
    });
  }

  return res.json({ received: true });
});

export default router;
