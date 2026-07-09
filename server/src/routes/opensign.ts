import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const createSigningSessionSchema = z.object({ reservationPublicId: z.string().min(1) });

function openSignConfigured() {
  return Boolean(env.OPENSIGN_PUBLIC_URL && env.OPENSIGN_API_URL && env.OPENSIGN_TENANT_ID);
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
      mode: openSignConfigured() ? "live" : "placeholder",
      reservationPublicId: reservation.publicId,
      sessionId: reservation.docusealSubmissionId,
      embedUrl: existingFlags.embedUrl,
      status: reservation.docusealStatus,
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
      message: openSignConfigured() ? "Existing OpenSign signing session loaded." : "Existing OpenSign placeholder session loaded.",
    });
  }

  const sessionId = reservation.docusealSubmissionId ?? `opensign_${reservation.publicId}`;
  const embedUrl = existingFlags.embedUrl ?? buildFallbackSigningUrl(reservation.publicId);
  const updated = await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      docusealSubmissionId: sessionId,
      docusealStatus: "SUBMISSION_CREATED",
      status: reservation.status === "PAYMENT_RECEIVED" ? "AWAITING_SIGNATURE" : reservation.status,
      internalFlags: {
        ...getLegacyFlagsObject(reservation.internalFlags),
        opensign: {
          provider: "opensign",
          embedUrl,
          templateId: env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL ?? null,
          sessionId,
          tenantId: env.OPENSIGN_TENANT_ID ?? null,
        },
      },
    },
  });

  return res.json({
    mode: openSignConfigured() ? "live" : "placeholder",
    reservation: updated,
    reservationPublicId: reservation.publicId,
    sessionId,
    embedUrl,
    status: updated.docusealStatus,
    signedDocumentUrl: updated.signedDocumentUrl ?? null,
    message: openSignConfigured()
      ? "OpenSign is configured. The next step is wiring your exact OpenSign document template or API document-creation flow."
      : "OpenSign is not fully configured yet, so the signing step is using placeholder mode.",
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
    mode: openSignConfigured() ? "live" : "placeholder",
    reservationPublicId: reservation.publicId,
    sessionId: reservation.docusealSubmissionId ?? null,
    embedUrl: flags.embedUrl ?? buildFallbackSigningUrl(reservation.publicId),
    status: reservation.docusealStatus,
    signedDocumentUrl: reservation.signedDocumentUrl ?? null,
    message: openSignConfigured()
      ? "OpenSign signing session is available."
      : "OpenSign is not fully configured yet, so the signing step is using placeholder mode.",
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
      providerEventId: typeof payload?.id === "string" ? payload.id : null,
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

function buildFallbackSigningUrl(reservationPublicId: string) {
  if (!env.OPENSIGN_PUBLIC_URL) {
    return null;
  }

  const base = env.OPENSIGN_PUBLIC_URL.replace(/\/+$/, "");
  const tenant = env.OPENSIGN_TENANT_ID ? `?tenant=${encodeURIComponent(env.OPENSIGN_TENANT_ID)}&reservation=${encodeURIComponent(reservationPublicId)}` : `?reservation=${encodeURIComponent(reservationPublicId)}`;
  return `${base}${tenant}`;
}

function getLegacyFlagsObject(flags: unknown) {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return {};
  }

  return flags as Record<string, unknown>;
}

function getLegacySigningFlags(flags: unknown) {
  const objectFlags = getLegacyFlagsObject(flags);
  const openSign = objectFlags.opensign;
  if (openSign && typeof openSign === "object" && !Array.isArray(openSign)) {
    return openSign as { embedUrl?: string | null };
  }

  return { embedUrl: null };
}

export default router;
