import type { Prisma } from "@prisma/client";
import type { RequestHandler } from "express";
import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { env } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { calculatePricing, weekendEndDate } from "../lib/reservations.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

router.post("/create-checkout-session", asyncRoute(async (req, res) => {
  const parsed = z.object({ reservationPublicId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId: parsed.data.reservationPublicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const weekendStart = reservation.weekendStartDate.toISOString().slice(0, 10);
  const [machines, reservations, blocks] = await Promise.all([
    prisma.machine.count({ where: { status: "ACTIVE" } }),
    prisma.reservation.count({
      where: {
        weekendStartDate: reservation.weekendStartDate,
        status: { in: ["PENDING_PAYMENT", "PAYMENT_RECEIVED", "AWAITING_SIGNATURE", "CONFIRMED"] },
        NOT: { publicId: reservation.publicId },
      },
    }),
    prisma.adminDateBlock.count({
      where: {
        startDate: { lte: reservation.weekendEndDate },
        endDate: { gte: reservation.weekendStartDate },
      },
    }),
  ]);

  if (blocks > 0 || machines - reservations <= 0) {
    return res.status(409).json({ error: "That weekend is no longer available." });
  }

  const pricing = calculatePricing({
    deliveryFeeCents: reservation.deliveryFeeCents,
    damageWaiverChoice: reservation.damageWaiverChoice,
  });

  const updateData = {
    paymentStatus: "CHECKOUT_CREATED" as const,
    status: "PENDING_PAYMENT" as const,
    rentalSubtotalCents: pricing.rentalSubtotalCents,
    deliveryFeeCents: pricing.deliveryFeeCents,
    damageWaiverFeeCents: pricing.damageWaiverFeeCents,
    depositCents: pricing.depositCents,
    totalDueCents: pricing.totalDueCents,
  };

  if (!stripe) {
    const updated = await prisma.reservation.update({
      where: { publicId: reservation.publicId },
      data: {
        ...updateData,
        stripeCheckoutSessionId: `cs_test_${reservation.publicId}`,
      },
    });

    return res.json({
      checkoutUrl: `/reserve/payment?reservation=${reservation.publicId}`,
      mode: "placeholder",
      message: "Stripe keys are missing, so the app is using the placeholder checkout flow.",
      reservation: updated,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: reservation.email,
    currency: env.STRIPE_CURRENCY,
    success_url: `${env.SITE_URL}/reserve/sign?reservation=${reservation.publicId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_URL}/reserve/review?reservation=${reservation.publicId}`,
    metadata: {
      reservationId: reservation.id,
      reservationPublicId: reservation.publicId,
      customerEmail: reservation.email,
      weekendStartDate: weekendStart,
    },
    line_items: [
      {
        price_data: {
          currency: env.STRIPE_CURRENCY,
          product_data: { name: "Weekend Mini Excavator Rental" },
          unit_amount: pricing.rentalSubtotalCents,
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: env.STRIPE_CURRENCY,
          product_data: { name: `Delivery (${reservation.deliveryZone})` },
          unit_amount: pricing.deliveryFeeCents,
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: env.STRIPE_CURRENCY,
          product_data: { name: "Refundable deposit" },
          unit_amount: pricing.depositCents,
        },
        quantity: 1,
      },
      ...(pricing.damageWaiverFeeCents > 0
        ? [
            {
              price_data: {
                currency: env.STRIPE_CURRENCY,
                product_data: { name: "Limited Damage Waiver" },
                unit_amount: pricing.damageWaiverFeeCents,
              },
              quantity: 1,
            },
          ]
        : []),
    ],
  });

  await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      ...updateData,
      stripeCheckoutSessionId: session.id,
    },
  });

  return res.json({
    checkoutUrl: session.url,
    mode: "live",
    message: "Stripe Checkout session created.",
  });
}));

export const stripeWebhookHandler: RequestHandler = async (req, res, next) => {
  try {
    const signature = req.headers["stripe-signature"];
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET || !signature || Array.isArray(signature)) {
      res.status(400).json({ error: "Stripe webhook is not configured." });
      return;
    }

    const event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    const existing = await prisma.webhookEvent.findFirst({
      where: {
        provider: "STRIPE",
        providerEventId: event.id,
      },
    });

    if (existing) {
      res.json({ received: true, duplicate: true });
      return;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const publicId = session.metadata?.reservationPublicId;

    await prisma.webhookEvent.create({
      data: {
        provider: "STRIPE",
        providerEventId: event.id,
        reservationId: publicId ?? null,
        eventType: event.type,
        payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });

    if (event.type === "checkout.session.completed" && publicId) {
      await prisma.reservation.update({
        where: { publicId },
        data: {
          paymentStatus: "PAID",
          status: "PAYMENT_RECEIVED",
          stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        },
      });
    }

    if (event.type === "checkout.session.expired" && publicId) {
      await prisma.reservation.update({
        where: { publicId },
        data: {
          paymentStatus: "FAILED",
          status: "EXPIRED",
          holdExpiresAt: new Date(),
        },
      });
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};

export default router;
