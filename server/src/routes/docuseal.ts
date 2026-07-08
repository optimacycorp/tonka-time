import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

type ReservationInternalFlags = {
  docuseal?: {
    embedSrc?: string | null;
    submitterSlug?: string | null;
    submitterId?: number | null;
    lastKnownStatus?: string | null;
  };
};

type DocuSealTemplateField = {
  name?: string;
};

type DocuSealTemplateResponse = {
  fields?: DocuSealTemplateField[];
};

type DocuSealDocument = {
  url?: string | null;
};

type DocuSealSubmitter = {
  id?: number;
  slug?: string;
  embed_src?: string;
  external_id?: string | null;
  status?: string | null;
  documents?: DocuSealDocument[];
};

type DocuSealSubmissionResponse = {
  id: number;
  status?: string | null;
  documents?: DocuSealDocument[];
  submitters?: DocuSealSubmitter[];
};

const createSubmissionSchema = z.object({ reservationPublicId: z.string().min(1) });

function docusealConfigured() {
  return Boolean(env.DOCUSEAL_API_KEY && env.DOCUSEAL_TEMPLATE_ID_WEEKEND_RENTAL);
}

async function docusealFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  if (!env.DOCUSEAL_API_KEY) {
    throw new Error("DocuSeal API key is not configured.");
  }

  const response = await fetch(`${env.DOCUSEAL_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": env.DOCUSEAL_API_KEY,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `DocuSeal request failed with ${response.status}.`;
    throw new Error(message);
  }

  return data as T;
}

function normalizeFieldName(fieldName: string) {
  return fieldName.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function reservationValueAliases(reservation: Awaited<ReturnType<typeof prisma.reservation.findUniqueOrThrow>>) {
  const fullName = `${reservation.firstName} ${reservation.lastName}`.trim();
  return new Map<string, string>([
    ["full name", fullName],
    ["name", fullName],
    ["first name", reservation.firstName],
    ["last name", reservation.lastName],
    ["email", reservation.email],
    ["email address", reservation.email],
    ["phone", reservation.phone],
    ["phone number", reservation.phone],
    ["jobsite street", reservation.jobsiteStreet],
    ["street address", reservation.jobsiteStreet],
    ["address", reservation.jobsiteStreet],
    ["jobsite city", reservation.jobsiteCity],
    ["city", reservation.jobsiteCity],
    ["jobsite state", reservation.jobsiteState],
    ["state", reservation.jobsiteState],
    ["jobsite zip", reservation.jobsiteZip],
    ["zip", reservation.jobsiteZip],
    ["zip code", reservation.jobsiteZip],
    ["weekend start date", reservation.weekendStartDate.toISOString().slice(0, 10)],
    ["friday start date", reservation.weekendStartDate.toISOString().slice(0, 10)],
    ["weekend end date", reservation.weekendEndDate.toISOString().slice(0, 10)],
    ["monday end date", reservation.weekendEndDate.toISOString().slice(0, 10)],
    ["delivery zone", reservation.deliveryZone],
    ["colorado 811 ticket", reservation.colorado811Ticket ?? ""],
    ["811 ticket", reservation.colorado811Ticket ?? ""],
    ["damage waiver choice", reservation.damageWaiverChoice],
    ["work description", reservation.workDescription ?? ""],
    ["gate access notes", reservation.gateAccessNotes ?? ""],
    ["surface access notes", reservation.surfaceAccessNotes ?? ""],
    ["property owner", reservation.isPropertyOwner ? "Yes" : "No"],
    ["owner permission", reservation.ownerPermission ? "Yes" : "No"],
    ["weekend rental amount", dollars(reservation.rentalSubtotalCents)],
    ["delivery amount", dollars(reservation.deliveryFeeCents)],
    ["damage waiver amount", dollars(reservation.damageWaiverFeeCents)],
    ["refundable deposit", dollars(reservation.depositCents)],
    ["total due today", dollars(reservation.totalDueCents)],
    ["deposit refund note", `The ${dollars(reservation.depositCents)} deposit is refunded after satisfactory machine return.`],
  ]);
}

function buildSubmitterValues(fieldNames: string[], reservation: Awaited<ReturnType<typeof prisma.reservation.findUniqueOrThrow>>) {
  const aliases = reservationValueAliases(reservation);
  return Object.fromEntries(
    fieldNames
      .map((fieldName) => {
        const value = aliases.get(normalizeFieldName(fieldName));
        return value ? [fieldName, value] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getInternalFlags(flags: unknown): ReservationInternalFlags {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return {};
  }

  return flags as ReservationInternalFlags;
}

async function getSubmissionById(submissionId: string) {
  return docusealFetch<DocuSealSubmissionResponse>(`/submissions/${submissionId}`);
}

async function persistSubmissionSnapshot(reservationPublicId: string, submission: DocuSealSubmissionResponse) {
  const submitter = submission.submitters?.[0] ?? null;
  await prisma.reservation.update({
    where: { publicId: reservationPublicId },
    data: {
      docusealSubmissionId: String(submission.id),
      docusealStatus: mapDocuSealStatus(submission.status),
      signedDocumentUrl: submission.documents?.[0]?.url ?? submitter?.documents?.[0]?.url ?? undefined,
      internalFlags: {
        ...(getInternalFlags((await prisma.reservation.findUnique({ where: { publicId: reservationPublicId }, select: { internalFlags: true } }))?.internalFlags)),
        docuseal: {
          embedSrc: submitter?.embed_src ?? null,
          submitterSlug: submitter?.slug ?? null,
          submitterId: submitter?.id ?? null,
          lastKnownStatus: submitter?.status ?? submission.status ?? null,
        },
      },
      status: submission.status === "completed" ? "CONFIRMED" : "AWAITING_SIGNATURE",
      confirmedAt: submission.status === "completed" ? new Date() : undefined,
    },
  });
}

function mapDocuSealStatus(status?: string | null) {
  switch (status) {
    case "completed":
      return "COMPLETED" as const;
    case "declined":
      return "DECLINED" as const;
    case "opened":
      return "OPENED" as const;
    case "sent":
    case "awaiting":
    case "pending":
      return "SENT" as const;
    default:
      return "SUBMISSION_CREATED" as const;
  }
}

router.post("/create-submission", asyncRoute(async (req, res) => {
  const parsed = createSubmissionSchema.safeParse(req.body);
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

  if (!docusealConfigured()) {
    const updated = await prisma.reservation.update({
      where: { publicId: reservation.publicId },
      data: {
        docusealSubmissionId: `docuseal_${reservation.publicId}`,
        docusealStatus: "SUBMISSION_CREATED",
        status: reservation.status === "PAYMENT_RECEIVED" ? "AWAITING_SIGNATURE" : reservation.status,
      },
    });

    return res.json({
      mode: "placeholder",
      reservation: updated,
      embedUrl: null,
      message: "DocuSeal API credentials are missing, so the app is using the signing placeholder.",
    });
  }

  if (reservation.docusealSubmissionId && /^\d+$/.test(reservation.docusealSubmissionId)) {
    const submission = await getSubmissionById(reservation.docusealSubmissionId);
    const submitter = submission.submitters?.find((item) => item.external_id === reservation.publicId) ?? submission.submitters?.[0] ?? null;
    await persistSubmissionSnapshot(reservation.publicId, submission);

    return res.json({
      mode: "live",
      reservationPublicId: reservation.publicId,
      submissionId: String(submission.id),
      embedUrl: submitter?.embed_src ?? null,
      status: submission.status ?? submitter?.status ?? null,
      signedDocumentUrl: submission.documents?.[0]?.url ?? submitter?.documents?.[0]?.url ?? null,
      message: "Existing DocuSeal submission loaded.",
    });
  }

  const template = await docusealFetch<DocuSealTemplateResponse>(`/templates/${env.DOCUSEAL_TEMPLATE_ID_WEEKEND_RENTAL}`);
  const templateFieldNames = (template.fields ?? []).map((field) => field.name).filter((name): name is string => Boolean(name));
  const values = buildSubmitterValues(templateFieldNames, reservation as Awaited<ReturnType<typeof prisma.reservation.findUniqueOrThrow>>);
  const createPayload = {
    template_id: Number(env.DOCUSEAL_TEMPLATE_ID_WEEKEND_RENTAL),
    send_email: true,
    send_sms: false,
    completed_redirect_url: `${env.SITE_URL}/reserve/confirmation?reservation=${reservation.publicId}`,
    submitters: [
      {
        name: `${reservation.firstName} ${reservation.lastName}`.trim(),
        email: reservation.email,
        phone: reservation.phone.startsWith("+") ? reservation.phone : undefined,
        external_id: reservation.publicId,
        values,
      },
    ],
  };

  const submission = await docusealFetch<DocuSealSubmissionResponse>("/submissions", {
    method: "POST",
    body: JSON.stringify(createPayload),
  });
  const submitter = submission.submitters?.find((item) => item.external_id === reservation.publicId) ?? submission.submitters?.[0] ?? null;

  const updated = await prisma.reservation.update({
    where: { publicId: reservation.publicId },
    data: {
      docusealSubmissionId: String(submission.id),
      docusealStatus: mapDocuSealStatus(submission.status),
      status: "AWAITING_SIGNATURE",
      internalFlags: {
        ...getInternalFlags(reservation.internalFlags),
        docuseal: {
          embedSrc: submitter?.embed_src ?? null,
          submitterSlug: submitter?.slug ?? null,
          submitterId: submitter?.id ?? null,
          lastKnownStatus: submitter?.status ?? submission.status ?? null,
        },
      },
    },
  });

  return res.json({
    mode: "live",
    reservation: updated,
    reservationPublicId: reservation.publicId,
    submissionId: String(submission.id),
    embedUrl: submitter?.embed_src ?? null,
    status: submission.status ?? submitter?.status ?? null,
    signedDocumentUrl: submission.documents?.[0]?.url ?? submitter?.documents?.[0]?.url ?? null,
    message: "DocuSeal submission created.",
  });
}));

router.get("/submission-status", asyncRoute(async (req, res) => {
  const parsed = z.object({ reservationPublicId: z.string().min(1) }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Missing reservationPublicId." });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId: parsed.data.reservationPublicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  if (!reservation.docusealSubmissionId || !/^\d+$/.test(reservation.docusealSubmissionId) || !docusealConfigured()) {
    return res.json({
      mode: docusealConfigured() ? "live" : "placeholder",
      reservationPublicId: reservation.publicId,
      submissionId: reservation.docusealSubmissionId ?? null,
      embedUrl: getInternalFlags(reservation.internalFlags).docuseal?.embedSrc ?? null,
      status: reservation.docusealStatus,
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
    });
  }

  const submission = await getSubmissionById(reservation.docusealSubmissionId);
  const submitter = submission.submitters?.find((item) => item.external_id === reservation.publicId) ?? submission.submitters?.[0] ?? null;
  await persistSubmissionSnapshot(reservation.publicId, submission);

  return res.json({
    mode: "live",
    reservationPublicId: reservation.publicId,
    submissionId: String(submission.id),
    embedUrl: submitter?.embed_src ?? null,
    status: submission.status ?? submitter?.status ?? null,
    signedDocumentUrl: submission.documents?.[0]?.url ?? submitter?.documents?.[0]?.url ?? null,
  });
}));

router.post("/webhook", asyncRoute(async (req, res) => {
  const parsed = z
    .object({
      event_type: z.string().optional(),
      data: z
        .object({
          id: z.number().optional(),
          external_id: z.string().optional(),
          documents: z.array(z.object({ url: z.string().url().optional() })).optional(),
          submitters: z
            .array(
              z.object({
                external_id: z.string().optional(),
                status: z.string().optional(),
                slug: z.string().optional(),
                embed_src: z.string().url().optional(),
                documents: z.array(z.object({ url: z.string().url().optional() })).optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .safeParse(req.body);

  const webhookReservationPublicId =
    parsed.success
      ? parsed.data.data?.external_id ??
        parsed.data.data?.submitters?.find((submitter) => submitter.external_id)?.external_id ??
        null
      : null;
  const webhookSubmissionId = parsed.success ? parsed.data.data?.id : undefined;

  const targetReservation =
    webhookReservationPublicId
      ? await prisma.reservation.findUnique({ where: { publicId: webhookReservationPublicId } })
      : webhookSubmissionId
        ? await prisma.reservation.findFirst({ where: { docusealSubmissionId: String(webhookSubmissionId) } })
        : null;

  await prisma.webhookEvent.create({
    data: {
      provider: "DOCUSEAL",
      providerEventId: req.body?.id,
      reservationId: targetReservation?.publicId ?? null,
      eventType: parsed.success ? parsed.data.event_type ?? "unknown" : "unknown",
      payload: req.body ?? {},
      processedAt: new Date(),
    },
  });

  if (parsed.success && targetReservation) {
    const submitter = parsed.data.data?.submitters?.find((item) => item.external_id === targetReservation.publicId) ?? parsed.data.data?.submitters?.[0];
    const documents = parsed.data.data?.documents ?? submitter?.documents;

    await prisma.reservation.update({
      where: { publicId: targetReservation.publicId },
      data: {
        docusealSubmissionId: webhookSubmissionId ? String(webhookSubmissionId) : targetReservation.docusealSubmissionId,
        docusealStatus:
          parsed.data.event_type === "submission.completed"
            ? "COMPLETED"
            : parsed.data.event_type === "submission.declined"
              ? "DECLINED"
              : parsed.data.event_type === "submission.opened"
                ? "OPENED"
                : targetReservation.docusealStatus,
        status:
          parsed.data.event_type === "submission.completed"
            ? "CONFIRMED"
            : parsed.data.event_type === "submission.declined"
              ? "AWAITING_ADMIN_REVIEW"
              : "AWAITING_SIGNATURE",
        confirmedAt: parsed.data.event_type === "submission.completed" ? new Date() : targetReservation.confirmedAt,
        signedDocumentUrl: documents?.[0]?.url ?? targetReservation.signedDocumentUrl,
        internalFlags: {
          ...getInternalFlags(targetReservation.internalFlags),
          docuseal: {
            embedSrc: submitter?.embed_src ?? getInternalFlags(targetReservation.internalFlags).docuseal?.embedSrc ?? null,
            submitterSlug: submitter?.slug ?? getInternalFlags(targetReservation.internalFlags).docuseal?.submitterSlug ?? null,
            submitterId: getInternalFlags(targetReservation.internalFlags).docuseal?.submitterId ?? null,
            lastKnownStatus: submitter?.status ?? parsed.data.event_type ?? null,
          },
        },
      },
    });
  }

  return res.json({ received: true });
}));

export default router;
