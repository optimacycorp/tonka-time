import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const createSigningSessionSchema = z.object({ reservationPublicId: z.string().min(1) });

function signNowConfigured() {
  return Boolean(
    env.SIGNNOW_CLIENT_ID &&
      env.SIGNNOW_CLIENT_SECRET &&
      env.SIGNNOW_USERNAME &&
      env.SIGNNOW_PASSWORD &&
      env.SIGNNOW_TEMPLATE_ID_WEEKEND_RENTAL,
  );
}

router.post("/create-signing-session", asyncRoute(async (req, res) => {
  const parsed = createSigningSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId: parsed.data.reservationPublicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  if (!["PAYMENT_RECEIVED", "AWAITING_SIGNATURE", "CONFIRMED"].includes(reservation.status)) {
    return res.status(409).json({ error: "The agreement can only be created after payment is complete." });
  }

  const existingFlags = getLegacySigningFlags(reservation.internalFlags);
  if (reservation.docusealSubmissionId && existingFlags.embedUrl) {
    return res.json({
      mode: signNowConfigured() ? "live" : "placeholder",
      reservationPublicId: reservation.publicId,
      sessionId: reservation.docusealSubmissionId,
      embedUrl: existingFlags.embedUrl,
      status: reservation.docusealStatus,
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
      message: signNowConfigured() ? "Existing SignNow signing session loaded." : "Existing SignNow placeholder session loaded.",
    });
  }

  const sessionId = reservation.docusealSubmissionId ?? `signnow_${reservation.publicId}`;
  const updated = await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      docusealSubmissionId: sessionId,
      docusealStatus: "SUBMISSION_CREATED",
      status: reservation.status === "PAYMENT_RECEIVED" ? "AWAITING_SIGNATURE" : reservation.status,
      internalFlags: {
        ...getLegacyFlagsObject(reservation.internalFlags),
        signnow: {
          provider: "signnow",
          embedUrl: null,
          templateId: env.SIGNNOW_TEMPLATE_ID_WEEKEND_RENTAL ?? null,
          sessionId,
        },
      },
    },
  });

  return res.json({
    mode: signNowConfigured() ? "live" : "placeholder",
    reservation: updated,
    reservationPublicId: reservation.publicId,
    sessionId,
    embedUrl: null,
    status: updated.docusealStatus,
    signedDocumentUrl: updated.signedDocumentUrl ?? null,
    message: signNowConfigured()
      ? "SignNow credentials are configured. The next step is wiring your exact SignNow template field mapping and invite flow."
      : "SignNow credentials are still missing, so the signing step is using the SignNow placeholder mode.",
  });
}));

router.get("/signing-session-status", asyncRoute(async (req, res) => {
  const parsed = z.object({ reservationPublicId: z.string().min(1) }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Missing reservationPublicId." });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId: parsed.data.reservationPublicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const flags = getLegacySigningFlags(reservation.internalFlags);
  return res.json({
    mode: signNowConfigured() ? "live" : "placeholder",
    reservationPublicId: reservation.publicId,
    sessionId: reservation.docusealSubmissionId ?? null,
    embedUrl: flags.embedUrl ?? null,
    status: reservation.docusealStatus,
    signedDocumentUrl: reservation.signedDocumentUrl ?? null,
  });
}));

router.post("/webhook", asyncRoute(async (req, res) => {
  const payload = req.body ?? {};
  const parsed = z
    .object({
      event: z.string().optional(),
      event_type: z.string().optional(),
      data: z
        .object({
          external_id: z.string().optional(),
          document_id: z.string().optional(),
          signed_document_url: z.string().url().optional(),
        })
        .optional(),
    })
    .safeParse(payload);

  const eventType = parsed.success ? parsed.data.event ?? parsed.data.event_type ?? "unknown" : "unknown";
  const reservationPublicId = parsed.success ? parsed.data.data?.external_id ?? null : null;
  const signedDocumentUrl = parsed.success ? parsed.data.data?.signed_document_url ?? null : null;

  await prisma.webhookEvent.create({
    data: {
      provider: "DOCUSEAL",
      providerEventId: payload?.id,
      reservationId: reservationPublicId,
      eventType,
      payload,
      processedAt: new Date(),
    },
  });

  if (reservationPublicId) {
    const reservation = await prisma.reservation.findUnique({ where: { publicId: reservationPublicId } });
    if (reservation) {
      await prisma.reservation.update({
        where: { publicId: reservationPublicId },
        data: {
          docusealStatus: eventType.includes("complete") || eventType.includes("signed") ? "COMPLETED" : reservation.docusealStatus,
          status: eventType.includes("complete") || eventType.includes("signed") ? "CONFIRMED" : reservation.status,
          confirmedAt: eventType.includes("complete") || eventType.includes("signed") ? new Date() : reservation.confirmedAt,
          signedDocumentUrl: signedDocumentUrl ?? reservation.signedDocumentUrl,
        },
      });
    }
  }

  return res.json({ received: true });
}));

function getLegacyFlagsObject(flags: unknown) {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return {};
  }

  return flags as Record<string, unknown>;
}

function getLegacySigningFlags(flags: unknown) {
  const objectFlags = getLegacyFlagsObject(flags);
  const signNow = objectFlags.signnow;
  if (signNow && typeof signNow === "object" && !Array.isArray(signNow)) {
    return signNow as { embedUrl?: string | null };
  }

  return { embedUrl: null };
}

export default router;
