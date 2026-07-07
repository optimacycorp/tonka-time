import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.post("/create-submission", async (req, res) => {
  const parsed = z.object({ reservationPublicId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId: parsed.data.reservationPublicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const updated = await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      docusealSubmissionId: `docuseal_${reservation.publicId}`,
      docusealStatus: "SUBMISSION_CREATED",
      status: reservation.status === "PAYMENT_RECEIVED" ? "AWAITING_SIGNATURE" : reservation.status,
    },
  });

  return res.json({
    reservation: updated,
    signingUrl: `/reserve/sign?reservation=${reservation.publicId}`,
    message: "Live DocuSeal submission wiring is scaffolded and ready for API credentials.",
  });
});

router.post("/webhook", async (req, res) => {
  const parsed = z
    .object({
      event_type: z.string().optional(),
      data: z.object({ external_id: z.string().optional() }).optional(),
    })
    .safeParse(req.body);

  await prisma.webhookEvent.create({
    data: {
      provider: "DOCUSEAL",
      providerEventId: req.body?.id,
      reservationId: parsed.success ? parsed.data.data?.external_id ?? null : null,
      eventType: parsed.success ? parsed.data.event_type ?? "unknown" : "unknown",
      payload: req.body ?? {},
      processedAt: new Date(),
    },
  });

  if (parsed.success && parsed.data.event_type === "submission.completed" && parsed.data.data?.external_id) {
    await prisma.reservation.update({
      where: { publicId: parsed.data.data.external_id },
      data: {
        docusealStatus: "COMPLETED",
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });
  }

  return res.json({ received: true });
});

export default router;
