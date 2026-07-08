import { NotificationChannel, NotificationStatus, type Reservation, type User } from "@prisma/client";
import { env } from "./config.js";
import { prisma } from "./prisma.js";

type NotificationInput = {
  userId?: string | null;
  reservationId?: string | null;
  channel: NotificationChannel;
  destination: string;
  subject?: string;
  message: string;
  provider?: string;
  providerRef?: string;
  status?: NotificationStatus;
};

async function logNotification(input: NotificationInput) {
  return prisma.notificationLog.create({
    data: {
      userId: input.userId ?? null,
      reservationId: input.reservationId ?? null,
      channel: input.channel,
      destination: input.destination,
      subject: input.subject,
      message: input.message,
      provider: input.provider,
      providerRef: input.providerRef,
      status: input.status ?? "PENDING",
    },
  });
}

export async function sendCancellationNotifications({
  reservation,
  user,
  refundIssued,
  refundAmountCents,
  initiatedBy,
}: {
  reservation: Reservation;
  user?: Pick<User, "id" | "email" | "phone"> | null;
  refundIssued: boolean;
  refundAmountCents: number;
  initiatedBy: string;
}) {
  const baseMessage = refundIssued
    ? `Your reservation ${reservation.publicId} was cancelled by ${initiatedBy}. A refund of $${(refundAmountCents / 100).toFixed(2)} has been initiated.`
    : `Your reservation ${reservation.publicId} was cancelled by ${initiatedBy}. No payment refund was required.`;

  if (reservation.email) {
    await logNotification({
      userId: user?.id ?? reservation.userId,
      reservationId: reservation.id,
      channel: "EMAIL",
      destination: reservation.email,
      subject: `Tonka Time reservation ${reservation.publicId} cancelled`,
      message: baseMessage,
      provider: env.NOTIFICATION_EMAIL_FROM ? "email-placeholder" : "system",
      status: env.NOTIFICATION_EMAIL_FROM ? "PENDING" : "SKIPPED",
    });
  }

  if (reservation.phone) {
    await logNotification({
      userId: user?.id ?? reservation.userId,
      reservationId: reservation.id,
      channel: "SMS",
      destination: reservation.phone,
      message: baseMessage,
      provider: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_PHONE ? "twilio-placeholder" : "system",
      status: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_PHONE ? "PENDING" : "SKIPPED",
    });
  }

  await logNotification({
    userId: user?.id ?? reservation.userId,
    reservationId: reservation.id,
    channel: "SYSTEM",
    destination: reservation.publicId,
    message: baseMessage,
    status: "SENT",
    provider: "dashboard",
  });
}
