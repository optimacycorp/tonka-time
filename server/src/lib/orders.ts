import Stripe from "stripe";
import type { PaymentStatus, Prisma, Reservation, ReservationStatus } from "@prisma/client";
import { env } from "./config.js";
import { prisma } from "./prisma.js";
import { sendCancellationNotifications } from "./notifications.js";

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export function serializeReservation(reservation: Reservation) {
  return {
    ...reservation,
    signingStatus: reservation.docusealStatus,
  };
}

export async function cancelReservationByPublicId({
  publicId,
  initiatedBy,
  actorUserId,
}: {
  publicId: string;
  initiatedBy: string;
  actorUserId?: string | null;
}) {
  const reservation = await prisma.reservation.findUnique({
    where: { publicId },
    include: { user: true },
  });

  if (!reservation) {
    throw new Error("Reservation not found.");
  }

  if (reservation.status === "CANCELLED") {
    return {
      reservation: serializeReservation(reservation),
      refundIssued: reservation.paymentStatus === "REFUNDED",
      refundAmountCents: reservation.paymentStatus === "REFUNDED" ? reservation.totalDueCents : 0,
      refundReference: null,
      alreadyCancelled: true,
    };
  }

  let refundIssued = false;
  let refundReference: string | null = null;

  if (reservation.paymentStatus === "PAID" && reservation.stripePaymentIntentId && stripe) {
    const refund = await stripe.refunds.create({
      payment_intent: reservation.stripePaymentIntentId,
      reason: "requested_by_customer",
      metadata: {
        reservationPublicId: reservation.publicId,
        initiatedBy,
      },
    });

    refundIssued = true;
    refundReference = refund.id;
  } else if (reservation.paymentStatus === "PAID") {
    refundIssued = true;
    refundReference = "manual-refund-required";
  }

  const nextPaymentStatus: PaymentStatus =
    reservation.paymentStatus === "PAID"
      ? "REFUNDED"
      : reservation.paymentStatus === "CHECKOUT_CREATED"
        ? "FAILED"
        : reservation.paymentStatus;

  const updated = await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      status: "CANCELLED" satisfies ReservationStatus,
      cancelledAt: new Date(),
      holdExpiresAt: new Date(),
      paymentStatus: nextPaymentStatus,
      internalFlags: {
        ...getFlagsObject(reservation.internalFlags),
        cancellation: {
          initiatedBy,
          actorUserId: actorUserId ?? null,
          refundIssued,
          refundReference,
          refundAmountCents: refundIssued ? reservation.totalDueCents : 0,
          cancelledAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  });

  await sendCancellationNotifications({
    reservation: updated,
    user: reservation.user,
    refundIssued,
    refundAmountCents: refundIssued ? reservation.totalDueCents : 0,
    initiatedBy,
  });

  return {
    reservation: serializeReservation(updated),
    refundIssued,
    refundAmountCents: refundIssued ? reservation.totalDueCents : 0,
    refundReference,
    alreadyCancelled: false,
  };
}

export async function deleteFakeReservationByPublicId(publicId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { publicId },
  });

  if (!reservation) {
    throw new Error("Reservation not found.");
  }

  const flags = getFlagsObject(reservation.internalFlags);
  const fakePay = flags.fakePay;
  const isFakeReservation =
    Boolean(fakePay && typeof fakePay === "object" && !Array.isArray(fakePay));

  if (!isFakeReservation) {
    throw new Error("Only fake-pay reservations can be deleted from the admin dashboard.");
  }

  await prisma.reservation.delete({
    where: { publicId },
  });

  return { deleted: true, publicId };
}

function getFlagsObject(flags: unknown) {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return {};
  }

  return flags as Record<string, unknown>;
}
