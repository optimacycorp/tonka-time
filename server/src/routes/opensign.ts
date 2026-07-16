import { Router, type RequestHandler } from "express";
import path from "node:path";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { renderUnsignedAgreement, type GeneratedAgreement } from "../services/agreement/agreement-renderer.js";
import { buildAgreementAnchorWidgetRects } from "../services/agreement/agreement-anchor-widgets.js";
import type { ReservationAgreementSource } from "../services/agreement/agreement-data.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const createSigningSessionSchema = z.object({ reservationPublicId: z.string().min(1) });

type OpenSignFlags = {
  provider?: string;
  embedUrl?: string | null;
  documentId?: string | null;
  signingLink?: string | null;
  templateId?: string | null;
  sessionId?: string | null;
  tenantId?: string | null;
  createdAt?: string | null;
  debug?: Prisma.InputJsonValue | null;
};

type OpenSignLiveSession = {
  sessionId: string;
  documentId: string;
  embedUrl: string;
  debug?: Prisma.InputJsonValue | null;
};

type OpenSignReservationData = {
  id: string;
  publicId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  weekendStartDate: Date;
  weekendEndDate: Date;
  jobsiteStreet: string;
  jobsiteCity: string;
  jobsiteState: string;
  jobsiteZip: string;
  colorado811Ticket: string | null;
  workDescription: string | null;
  isPropertyOwner: boolean | null;
  ownerPermission: boolean | null;
  damageWaiverChoice: string;
  deliveryFeeCents?: number | null;
  extendedFeeCents?: number | null;
  damageWaiverFeeCents?: number | null;
  rentalSubtotalCents?: number | null;
  taxCents?: number | null;
  depositCents?: number | null;
  totalDueCents?: number | null;
  stripeCheckoutSessionId?: string | null;
  checklistJson?: unknown;
  internalFlags?: unknown;
};

function openSignConfigured() {
  return Boolean(
    env.OPENSIGN_PUBLIC_URL &&
      env.OPENSIGN_API_URL &&
      (env.OPENSIGN_API_KEY || env.OPENSIGN_MASTER_KEY) &&
      env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL,
  );
}

function openSignHasAdminSessionAuth() {
  return Boolean(env.OPENSIGN_USERNAME && env.OPENSIGN_PASSWORD && env.OPENSIGN_APP_ID);
}

function extractOpenSignDebug(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error) || !("openSignDebug" in error)) {
    return null;
  }

  const debug = (error as { openSignDebug?: unknown }).openSignDebug;
  return toPrismaJson(debug);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

  if (["CANCELLED", "EXPIRED"].includes(reservation.status)) {
    return res.status(409).json({ error: "The agreement cannot be created for a cancelled or expired reservation." });
  }

  const existingFlags = getLegacySigningFlags(reservation.internalFlags);
  const existingEmbedUrl = normalizeOpenSignSignerUrl(existingFlags.embedUrl, reservation.docusealSubmissionId ?? undefined);
  if (reservation.docusealSubmissionId && isSafeOpenSignUrl(existingEmbedUrl)) {
    return res.json({
      mode: openSignConfigured() ? "live" : "placeholder",
      reservationPublicId: reservation.publicId,
      sessionId: reservation.docusealSubmissionId,
      embedUrl: existingEmbedUrl,
      status: reservation.docusealStatus,
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
      message: openSignConfigured()
        ? "Existing OpenSign signing session loaded."
        : "OpenSign is not fully configured yet, so the signing step is unavailable.",
    });
  }

  if (!openSignConfigured()) {
    await prisma.reservation.update({
      where: { publicId: reservation.publicId },
      data: {
        docusealStatus: reservation.docusealStatus === "COMPLETED" ? reservation.docusealStatus : "ERROR",
        status: reservation.docusealStatus === "COMPLETED" ? reservation.status : "AWAITING_SIGNATURE",
        internalFlags: {
          ...getLegacyFlagsObject(reservation.internalFlags),
          opensign: {
            ...existingFlags,
            provider: "opensign",
            embedUrl: null,
            templateId: env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL ?? null,
            tenantId: env.OPENSIGN_TENANT_ID ?? null,
            configMissing: true,
          },
        },
      },
    });

    return res.json({
      mode: "placeholder",
      reservationPublicId: reservation.publicId,
      sessionId: reservation.docusealSubmissionId ?? null,
      embedUrl: null,
      status: reservation.docusealStatus === "COMPLETED" ? reservation.docusealStatus : "ERROR",
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
      message: "OpenSign is not fully configured yet. Add the API URL, template ID, and either an API key or master key before customers can sign.",
    });
  }

  try {
    const created = await createLiveSigningSession(reservation);
    const createdDebug =
      "debug" in created && created.debug !== undefined
        ? created.debug ?? null
        : null;
    const updated = await prisma.reservation.update({
      where: { publicId: reservation.publicId },
      data: {
        docusealSubmissionId: created.sessionId,
        docusealStatus: "SENT",
        status: ["DRAFT", "PENDING_PAYMENT", "AWAITING_SIGNATURE"].includes(reservation.status) ? "AWAITING_SIGNATURE" : reservation.status,
        internalFlags: {
          ...getLegacyFlagsObject(reservation.internalFlags),
          opensign: {
            provider: "opensign",
            embedUrl: created.embedUrl,
            documentId: created.documentId,
            signingLink: created.embedUrl,
            templateId: env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL ?? null,
            sessionId: created.sessionId,
            tenantId: env.OPENSIGN_TENANT_ID ?? null,
            createdAt: new Date().toISOString(),
            debug: createdDebug,
          },
        },
      },
    });

    return res.json({
      mode: "live",
      reservation: updated,
      reservationPublicId: updated.publicId,
      sessionId: created.sessionId,
      embedUrl: created.embedUrl,
      status: updated.docusealStatus,
      signedDocumentUrl: updated.signedDocumentUrl ?? null,
      message: "OpenSign signing session is ready.",
    });
  } catch (error) {
    const debug = extractOpenSignDebug(error);
    await prisma.reservation.update({
      where: { publicId: reservation.publicId },
      data: {
        docusealStatus: "ERROR",
        status: "AWAITING_SIGNATURE",
        internalFlags: {
          ...getLegacyFlagsObject(reservation.internalFlags),
          opensign: {
            ...existingFlags,
            provider: "opensign",
            lastError: error instanceof Error ? error.message : "Could not create the OpenSign session.",
            templateId: env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL ?? null,
            tenantId: env.OPENSIGN_TENANT_ID ?? null,
            debug,
          },
        },
      },
    });

    return res.status(502).json({
      error: error instanceof Error
        ? error.message
        : "OpenSign did not return a signer session. Check the template signer role, auth key configuration, and OpenSign API URL.",
    });
  }
}));

router.get("/generated-agreement/:publicId.pdf", asyncRoute(async (req, res) => {
  const publicId = String(req.params.publicId);
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token || !verifyGeneratedAgreementToken(publicId, token)) {
    return res.status(403).json({ error: "Invalid agreement token." });
  }

  const reservation = await prisma.reservation.findUnique({ where: { publicId } });
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const generated = await renderUnsignedAgreement(reservation as ReservationAgreementSource);
  res.type("application/pdf");
  res.sendFile(path.resolve(generated.outputMaskedPdfPath));
}));

router.get("/signing-session-status", asyncRoute(async (req, res) => {
  const parsed = z.object({ reservationPublicId: z.string().min(1) }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Missing reservationPublicId." });
  }

  const reservation = await syncOpenSignReservationStatus(parsed.data.reservationPublicId);
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found" });
  }

  const flags = getLegacySigningFlags(reservation.internalFlags);
  const embedUrl = normalizeOpenSignSignerUrl(flags.embedUrl, reservation.docusealSubmissionId ?? undefined);

  if (reservation.docusealStatus === "COMPLETED") {
    return res.json({
      mode: openSignConfigured() ? "live" : "placeholder",
      reservationPublicId: reservation.publicId,
      sessionId: reservation.docusealSubmissionId ?? null,
      embedUrl: null,
      status: reservation.docusealStatus,
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
      message: "The agreement has already been signed.",
    });
  }

  if (isSafeOpenSignUrl(embedUrl)) {
    return res.json({
      mode: openSignConfigured() ? "live" : "placeholder",
      reservationPublicId: reservation.publicId,
      sessionId: reservation.docusealSubmissionId ?? null,
      embedUrl,
      status: reservation.docusealStatus,
      signedDocumentUrl: reservation.signedDocumentUrl ?? null,
      message: "OpenSign signing session is available.",
    });
  }

  return res.json({
    mode: openSignConfigured() ? "live" : "placeholder",
    reservationPublicId: reservation.publicId,
    sessionId: reservation.docusealSubmissionId ?? null,
    embedUrl: null,
    status: reservation.docusealStatus,
    signedDocumentUrl: reservation.signedDocumentUrl ?? null,
    message: openSignConfigured()
      ? "OpenSign is reachable, but no signer document link has been created yet."
      : "OpenSign is not fully configured yet.",
  });
}));

async function syncOpenSignReservationStatus(publicId: string) {
  const reservation = await prisma.reservation.findUnique({ where: { publicId } });
  if (!reservation) {
    return null;
  }

  if (reservation.docusealStatus === "COMPLETED" || !reservation.docusealSubmissionId) {
    return reservation;
  }

  if (!openSignConfigured() || !openSignHasAdminSessionAuth()) {
    return reservation;
  }

  try {
    const sessionToken = await loginOpenSignAdmin();
    const document = await fetchJson(`${getOpenSignApiBase()}/functions/getDocument`, {
      method: "POST",
      headers: {
        ...buildOpenSignHeaders({ includeMasterKey: false }),
        "X-Parse-Session-Token": sessionToken,
      },
      body: JSON.stringify({ docId: reservation.docusealSubmissionId }),
    });

    const signedDocumentUrl = firstString([
      getNestedString(document, ["result", "SignedUrl"]),
      getNestedString(document, ["result", "signedUrl"]),
      getNestedString(document, ["SignedUrl"]),
      getNestedString(document, ["signedUrl"]),
      getNestedString(document, ["data", "SignedUrl"]),
      getNestedString(document, ["data", "signedUrl"]),
    ]);

    const isCompleted = firstBoolean([
      getNestedBoolean(document, ["result", "IsCompleted"]),
      getNestedBoolean(document, ["result", "isCompleted"]),
      getNestedBoolean(document, ["IsCompleted"]),
      getNestedBoolean(document, ["isCompleted"]),
      getNestedBoolean(document, ["data", "IsCompleted"]),
      getNestedBoolean(document, ["data", "isCompleted"]),
    ]);

    if (isCompleted !== true) {
      return reservation;
    }

    return prisma.reservation.update({
      where: { publicId },
      data: {
        docusealStatus: "COMPLETED",
        status: reservation.paymentStatus === "PAID" ? "CONFIRMED" : "PENDING_PAYMENT",
        confirmedAt: reservation.paymentStatus === "PAID" ? reservation.confirmedAt ?? new Date() : reservation.confirmedAt,
        signedDocumentUrl: signedDocumentUrl ?? reservation.signedDocumentUrl,
        internalFlags: {
          ...getLegacyFlagsObject(reservation.internalFlags),
          opensign: {
            ...getLegacySigningFlags(reservation.internalFlags),
            syncedAt: new Date().toISOString(),
            completionDetectedBy: "getDocument",
          },
        },
      },
    });
  } catch (error) {
    console.info("OpenSign status sync skipped", error);
    return reservation;
  }
}

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
          status: eventType.includes("complete") || eventType.includes("signed")
            ? reservation.paymentStatus === "PAID"
              ? "CONFIRMED"
              : "PENDING_PAYMENT"
            : reservation.status,
          confirmedAt: eventType.includes("complete") || eventType.includes("signed")
            ? reservation.paymentStatus === "PAID"
              ? new Date()
              : reservation.confirmedAt
            : reservation.confirmedAt,
          signedDocumentUrl: signedDocumentUrl ?? reservation.signedDocumentUrl,
        },
      });
    }
  }

  return res.json({ received: true });
}));

async function createLiveSigningSession(reservation: OpenSignReservationData): Promise<OpenSignLiveSession> {
  if (openSignHasAdminSessionAuth()) {
    return createLiveSigningSessionViaAdminSession(reservation);
  }

  if (!env.OPENSIGN_API_KEY) {
    throw new Error(
      "OpenSign needs either OPENSIGN_USERNAME/OPENSIGN_PASSWORD for admin-session document creation or a working OPENSIGN_API_KEY flow.",
    );
  }

  return createLiveSigningSessionViaLegacyApi(reservation);
}

async function createLiveSigningSessionViaLegacyApi(reservation: OpenSignReservationData): Promise<OpenSignLiveSession> {
  const apiBase = getOpenSignApiBase();
  const signerName = `${reservation.firstName} ${reservation.lastName}`.trim();
  const createPayload = {
    title: `Tonka Time Rental Agreement ${reservation.publicId}`,
    note: `Reservation ${reservation.publicId} for ${reservation.weekendStartDate.toISOString().slice(0, 10)} through ${reservation.weekendEndDate.toISOString().slice(0, 10)}`,
    external_id: reservation.publicId,
    sendInOrder: true,
    signers: [
      {
        name: signerName,
        email: reservation.email,
        phone: reservation.phone,
        role: "Customer",
      },
    ],
    widgets: buildTemplateWidgetDefaults(reservation),
    prefill: buildTemplatePrefill(reservation),
  };

  const createResponse = await fetchJson(`${apiBase}/createdocument/${encodeURIComponent(env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL!)}`, {
    method: "POST",
    headers: buildOpenSignHeaders(),
    body: JSON.stringify(createPayload),
  });

  const documentId = extractDocumentId(createResponse);
  if (!documentId) {
    throw new Error("OpenSign created no document ID. Check that the template has at least one signer role and that the role name matches `Customer`.");
  }

  const signingLinkResponse = await fetchJson(`${apiBase}/signinglinks/${encodeURIComponent(documentId)}`, {
    method: "GET",
    headers: buildOpenSignHeaders(),
  });

  const embedUrl = absolutizeOpenSignUrl(extractSigningLink(signingLinkResponse));
  if (!isSafeOpenSignUrl(embedUrl)) {
    throw new Error("OpenSign did not return a signer document link. The template may be missing signers, or the signer role may not match `Customer`.");
  }
  const safeEmbedUrl = embedUrl as string;

  return {
    sessionId: documentId,
    documentId,
    embedUrl: safeEmbedUrl,
    debug: null,
  };
}

async function createLiveSigningSessionViaAdminSession(reservation: OpenSignReservationData): Promise<OpenSignLiveSession> {
  const apiBase = getOpenSignApiBase();
  const sessionToken = await loginOpenSignAdmin();
  const adminUser = await fetchJson(`${apiBase}/users/me`, {
    method: "GET",
    headers: {
      ...buildOpenSignHeaders({ includeMasterKey: false }),
      "X-Parse-Session-Token": sessionToken,
    },
  });

  const adminUserId = firstString([
    getNestedString(adminUser, ["objectId"]),
    getNestedString(adminUser, ["result", "objectId"]),
  ]);

  if (!adminUserId) {
    throw new Error("OpenSign login succeeded, but the admin user ID could not be read from /users/me.");
  }

  const template = await fetchJson(
    `${apiBase}/classes/contracts_Template/${encodeURIComponent(env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL!)}`,
    {
      method: "GET",
      headers: buildOpenSignHeaders(),
    },
  );

  const templateName =
    firstString([getNestedString(template, ["Name"]), getNestedString(template, ["name"])]) ??
    `Tonka Time Rental Agreement ${reservation.publicId}`;

  const contractUserId = firstString([
    getNestedString(template, ["ExtUserPtr", "objectId"]),
    getNestedString(template, ["extUserPtr", "objectId"]),
  ]);

  if (!contractUserId) {
    throw new Error("The OpenSign template is missing ExtUserPtr.objectId, so a document cannot be created from it.");
  }

  const tenantId = firstString([
    getNestedString(adminUser, ["TenantId", "objectId"]),
    getNestedString(adminUser, ["result", "TenantId", "objectId"]),
  ]);

  const contactId = await findOrCreateOpenSignContact({
    apiBase,
    sessionToken,
    adminUserId,
    tenantId,
    reservation,
  });

  const generatedAgreement = await renderUnsignedAgreement(reservation as ReservationAgreementSource);
  const generatedAgreementUrl = buildGeneratedAgreementUrl(reservation.publicId, generatedAgreement);
  const signers = buildOpenSignDocumentSigners(contactId);
  const widgets = buildTemplateWidgetDefaults(reservation);
  const prefill = buildTemplatePrefill(reservation);
  const placeholders = buildOpenSignDocumentPlaceholders(
    getNestedArray(template, ["Placeholders"]),
    contactId,
    reservation,
    generatedAgreement,
  );

  const documentPayload: Record<string, unknown> = {
    Name: `${templateName} ${reservation.publicId}`.trim(),
    URL: generatedAgreementUrl,
    Note: `Reservation ${reservation.publicId} for ${reservation.weekendStartDate.toISOString().slice(0, 10)} through ${reservation.weekendEndDate.toISOString().slice(0, 10)}`,
    Description: `Tonka Time rental agreement for ${reservation.email}`,
    ExtUserPtr: {
      __type: "Pointer",
      className: "contracts_Users",
      objectId: contractUserId,
    },
    CreatedBy: {
      __type: "Pointer",
      className: "_User",
      objectId: adminUserId,
    },
    SignedUrl: generatedAgreementUrl,
    SentToOthers: false,
    SendinOrder: true,
    AllowModifications: false,
    AutomaticReminders: true,
    NotifyOnSignatures: true,
    DocSentAt: { __type: "Date", iso: new Date().toISOString() },
    IsEnableOTP: false,
    TemplateId: {
      __type: "Pointer",
      className: "contracts_Template",
      objectId: env.OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL,
    },
    widgets,
    prefill,
    Signers: signers,
    Placeholders: placeholders,
  };

  const passthroughKeys = ["SignatureType", "Bcc", "Cc", "PenColors", "RemindOnceInEvery", "TimeToCompleteDays"] as const;
  for (const key of passthroughKeys) {
    const value = getNestedValue(template, [key]);
    if (value != null) {
      documentPayload[key] = value;
    }
  }

  const createResponse = await fetchJson(`${apiBase}/functions/createdocumentfromapp`, {
    method: "POST",
    headers: {
      ...buildOpenSignHeaders({ includeMasterKey: false }),
      "X-Parse-Session-Token": sessionToken,
    },
    body: JSON.stringify({ document: documentPayload }),
  });

  const documentId = extractDocumentId(createResponse);
  if (!documentId) {
    throw new Error("OpenSign did not return a document ID from createdocumentfromapp.");
  }

  const documentResponse = await fetchJson(`${apiBase}/functions/getDocument`, {
    method: "POST",
    headers: {
      ...buildOpenSignHeaders({ includeMasterKey: false }),
      "X-Parse-Session-Token": sessionToken,
    },
    body: JSON.stringify({ docId: documentId }),
  });

  const documentDebug = inspectOpenSignDocumentResponse(documentResponse, documentId);
  let signingLinksDebug: unknown = null;
  let embedUrl: string | null = null;
  try {
    signingLinksDebug = await fetchJson(`${apiBase}/signinglinks/${encodeURIComponent(documentId)}`, {
      method: "GET",
      headers: {
        ...buildOpenSignHeaders({ includeMasterKey: false }),
        "X-Parse-Session-Token": sessionToken,
      },
    });
    embedUrl = absolutizeOpenSignUrl(extractSigningLink(signingLinksDebug));
  } catch (fallbackError) {
    console.info("OpenSign signinglinks endpoint unavailable; falling back to getDocument", fallbackError);
  }

  if (!isSafeOpenSignUrl(embedUrl)) {
    embedUrl = documentDebug.embedUrl;
  }

  if (!isSafeOpenSignUrl(embedUrl)) {
    console.error("OpenSign getDocument did not expose a signer URL", documentDebug);
    const debugError = new Error(
      "OpenSign created the document, but no signer-specific URL was found in the document payload. Check that the template widgets are assigned to the Customer role and that the document was created from the saved template.",
    );
    (debugError as Error & { openSignDebug?: Record<string, unknown> }).openSignDebug = documentDebug;
    throw debugError;
  }
  const safeEmbedUrl = embedUrl as string;

  return {
    sessionId: documentId,
    documentId,
    embedUrl: safeEmbedUrl,
    debug: toPrismaJson({
      submittedWidgetRects: generatedAgreement.widgetRects,
      submittedPlaceholderSummary: generatedAgreement.widgetRects.map((rect) => ({
        name: rect.name,
        type: rect.type,
        page: rect.page,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })),
      selectedEmbedUrl: safeEmbedUrl,
      selectedSource: isSafeOpenSignUrl(absolutizeOpenSignUrl(extractSigningLink(signingLinksDebug))) ? "signinglinks" : "getDocument",
      documentDebug,
      signingLinksDebug: toPrismaJson(signingLinksDebug),
      generatedAgreement: {
        outputPdfPath: generatedAgreement.outputPdfPath,
        pdfPageCount: generatedAgreement.pdfPageCount,
        sha256: generatedAgreement.sha256,
        url: generatedAgreementUrl,
      },
    }),
  };
}

function buildGeneratedAgreementUrl(publicId: string, generated: GeneratedAgreement) {
  const base = new URL(env.SITE_URL);
  base.pathname = `/api/opensign/generated-agreement/${encodeURIComponent(publicId)}.pdf`;
  base.searchParams.set("token", signGeneratedAgreementToken(publicId));
  base.searchParams.set("v", generated.sha256.slice(0, 12));
  return base.toString();
}

function signGeneratedAgreementToken(publicId: string) {
  const secret = resolveGeneratedAgreementSecret();
  return createHmac("sha256", secret).update(publicId).digest("hex");
}

function verifyGeneratedAgreementToken(publicId: string, token: string) {
  return token === signGeneratedAgreementToken(publicId);
}

function resolveGeneratedAgreementSecret() {
  return (
    env.OPENSIGN_WEBHOOK_SECRET ||
    env.OPENSIGN_MASTER_KEY ||
    env.OPENSIGN_API_KEY ||
    env.STRIPE_WEBHOOK_SECRET ||
    env.DATABASE_URL
  );
}

function buildTemplateWidgetDefaults(reservation: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}) {
  const signerName = `${reservation.firstName} ${reservation.lastName}`.trim();
  return [
    ...expandWidgetAliases(["name", "customer_name"], signerName),
    ...expandWidgetAliases(["email", "customer_email"], reservation.email),
    ...expandWidgetAliases(["phone", "customer_phone"], reservation.phone),
    ...expandWidgetAliases(["company"], "Tonka Time Rentals customer"),
    ...expandWidgetAliases(["job_title", "job title"], "Customer"),
  ];
}

async function findOrCreateOpenSignContact(options: {
  apiBase: string;
  sessionToken: string;
  adminUserId: string;
  tenantId: string | null;
  reservation: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
}) {
  const { apiBase, sessionToken, adminUserId, tenantId, reservation } = options;
  const existing = await fetchJson(
    `${apiBase}/classes/contracts_Contactbook?where=${encodeURIComponent(JSON.stringify({
      Email: reservation.email,
      IsDeleted: { $ne: true },
    }))}&limit=1`,
    {
      method: "GET",
      headers: {
        ...buildOpenSignHeaders({ includeMasterKey: false }),
        "X-Parse-Session-Token": sessionToken,
      },
    },
  );

  const existingResults =
    getNestedArray(existing, ["results"]) ??
    getNestedArray(existing, ["result"]) ??
    [];

  const existingId =
    Array.isArray(existingResults) && existingResults.length > 0
      ? firstString([
          getNestedString(existingResults[0], ["objectId"]),
          getNestedString(existingResults[0], ["id"]),
        ])
      : null;

  if (existingId) {
    return existingId;
  }

  const payload: Record<string, unknown> = {
    Name: `${reservation.firstName} ${reservation.lastName}`.trim(),
    Email: reservation.email,
    Phone: reservation.phone || undefined,
    UserRole: "contracts_Guest",
    IsDeleted: false,
    CreatedBy: {
      __type: "Pointer",
      className: "_User",
      objectId: adminUserId,
    },
  };

  if (tenantId) {
    payload.TenantId = {
      __type: "Pointer",
      className: "partners_Tenant",
      objectId: tenantId,
    };
  }

  const created = await fetchJson(`${apiBase}/classes/contracts_Contactbook`, {
    method: "POST",
    headers: {
      ...buildOpenSignHeaders({ includeMasterKey: false }),
      "X-Parse-Session-Token": sessionToken,
    },
    body: JSON.stringify(payload),
  });

  const createdId = firstString([
    getNestedString(created, ["objectId"]),
    getNestedString(created, ["result", "objectId"]),
  ]);

  if (!createdId) {
    throw new Error("OpenSign did not return a contact ID for the signer.");
  }

  return createdId;
}

function buildOpenSignDocumentSigners(contactId: string) {
  return [
    {
      __type: "Pointer",
      className: "contracts_Contactbook",
      objectId: contactId,
    },
  ];
}

function buildOpenSignDocumentPlaceholders(
  templatePlaceholders: unknown[] | null,
  contactId: string,
  reservation: OpenSignReservationData,
  generatedAgreement: GeneratedAgreement,
) {
  const placeholderValues = new Map(
    buildTemplatePrefill(reservation).map((entry) => [entry.name.toLowerCase(), entry.response]),
  );
  placeholderValues.set("name", `${reservation.firstName} ${reservation.lastName}`.trim());
  placeholderValues.set("email", reservation.email);

  const templateEntries = Array.isArray(templatePlaceholders) ? templatePlaceholders : [];
  const anchorPlaceholders = buildAnchorDrivenSignPlaceholders(
    templateEntries,
    contactId,
    generatedAgreement,
  );

  const textPlaceholders = templateEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }

    const updated = { ...(entry as Record<string, unknown>) };
    updated.signerPtr = {
      __type: "Pointer",
      className: "contracts_Contactbook",
      objectId: contactId,
    };
    updated.SignerPtr = updated.signerPtr;
    updated.signerObjId = contactId;
    updated.SignerObjId = contactId;
    const key = firstString([
      getNestedString(updated, ["Name"]),
      getNestedString(updated, ["name"]),
      getNestedString(updated, ["key"]),
      getNestedString(updated, ["Key"]),
    ]);

    if (!key) {
      return updated;
    }

    const normalized = key.toLowerCase();
    const nextValue = placeholderValues.get(normalized);
    if (nextValue == null) {
      return updated;
    }

    updated.text = nextValue;
    updated.Text = nextValue;
    updated.value = nextValue;
    updated.Value = nextValue;
    updated.defaultValue = nextValue;
    updated.DefaultValue = nextValue;
    return updated;
  });

  if (anchorPlaceholders.length === 0) {
    return textPlaceholders;
  }

  return [
    ...textPlaceholders.filter((entry) => !entryMatchesSignPlaceholder(entry)),
    ...anchorPlaceholders,
  ];
}

function buildAnchorDrivenSignPlaceholders(
  templateEntries: unknown[],
  contactId: string,
  generatedAgreement: GeneratedAgreement,
) {
  const widgetRects = buildAgreementAnchorWidgetRects(generatedAgreement.pdfAnchorLocateResult);
  if (widgetRects.length === 0) {
    return [];
  }

  const signerEntry = templateEntries.find(entryMatchesSignPlaceholder);
  if (!signerEntry || typeof signerEntry !== "object" || Array.isArray(signerEntry)) {
    return [];
  }

  const placeholderItems =
    getNestedArray(signerEntry, ["placeHolder"]) ??
    getNestedArray(signerEntry, ["PlaceHolder"]) ??
    getNestedArray(signerEntry, ["placeholder"]) ??
    [];

  const prototypes = {
    initials: findPlaceholderItemPrototype(placeholderItems, "initials"),
    signature: findPlaceholderItemPrototype(placeholderItems, "signature"),
    date: findPlaceholderItemPrototype(placeholderItems, "date"),
  };

  if (!prototypes.initials || !prototypes.signature || !prototypes.date) {
    return [];
  }

  const updated = { ...(signerEntry as Record<string, unknown>) };
  updated.signerPtr = {
    __type: "Pointer",
    className: "contracts_Contactbook",
    objectId: contactId,
  };
  updated.SignerPtr = updated.signerPtr;
  updated.signerObjId = contactId;
  updated.SignerObjId = contactId;
  updated.placeHolder = widgetRects.map((rect) => {
    const prototype = prototypes[rect.type];
    return clonePlaceholderItemForRect(prototype!, rect);
  });
  updated.placeholder = updated.placeHolder;
  updated.PlaceHolder = updated.placeHolder;
  return [updated];
}

function entryMatchesSignPlaceholder(entry: unknown) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }

  const role = firstString([
    getNestedString(entry, ["Role"]),
    getNestedString(entry, ["role"]),
  ]);
  if (role && role.toLowerCase() === "customer") {
    return true;
  }

  const items =
    getNestedArray(entry, ["placeHolder"]) ??
    getNestedArray(entry, ["PlaceHolder"]) ??
    getNestedArray(entry, ["placeholder"]) ??
    [];

  return Array.isArray(items) && items.some((item) => isSignPlaceholderItem(item));
}

function findPlaceholderItemPrototype(items: unknown[], type: "initials" | "signature" | "date") {
  return items.find((item) => placeholderItemMatchesType(item, type));
}

function isSignPlaceholderItem(item: unknown) {
  return ["initials", "signature", "date"].some((type) => placeholderItemMatchesType(item, type));
}

function placeholderItemMatchesType(item: unknown, type: string) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }

  const positions = getNestedArray(item, ["pos"]) ?? getNestedArray(item, ["Pos"]) ?? [];
  return positions.some((position) => {
    const positionType = firstString([
      getNestedString(position, ["type"]),
      getNestedString(position, ["Type"]),
    ]);
    return positionType?.toLowerCase() === type;
  });
}

function clonePlaceholderItemForRect(
  prototype: unknown,
  rect: ReturnType<typeof buildAgreementAnchorWidgetRects>[number],
) {
  const cloned = stripPlaceholderIdentifiers(cloneJsonRecord(prototype));
  const positions = getNestedArray(cloned, ["pos"]) ?? getNestedArray(cloned, ["Pos"]) ?? [];
  const positionTemplate =
    Array.isArray(positions) && positions.length > 0 && positions[0] && typeof positions[0] === "object"
      ? stripPlaceholderIdentifiers(cloneJsonRecord(positions[0]))
      : {};
  const rawOptions =
    (typeof positionTemplate.options === "object" && positionTemplate.options && !Array.isArray(positionTemplate.options))
      ? positionTemplate.options as Record<string, unknown>
      : (typeof positionTemplate.Options === "object" && positionTemplate.Options && !Array.isArray(positionTemplate.Options))
        ? positionTemplate.Options as Record<string, unknown>
        : {};
  const options = stripPlaceholderIdentifiers(cloneJsonRecord(rawOptions));
  options.name = rect.name;
  options.Name = rect.name;
  options.required = true;
  options.Required = true;
  options.value = "";
  options.Value = "";
  positionTemplate.options = options;
  positionTemplate.Options = options;
  positionTemplate.name = rect.name;
  positionTemplate.Name = rect.name;
  positionTemplate.type = rect.type;
  positionTemplate.Type = rect.type;
  setNumericField(positionTemplate, ["xPosition", "XPosition", "x"], rect.x);
  setNumericField(positionTemplate, ["yPosition", "YPosition", "y"], rect.y);
  setNumericField(positionTemplate, ["Width", "width", "w"], rect.width);
  setNumericField(positionTemplate, ["Height", "height", "h"], rect.height);
  setNumericField(positionTemplate, ["pageNumber", "PageNumber", "page", "Page"], rect.page);
  cloned.type = rect.type;
  cloned.Type = rect.type;
  cloned.pos = [positionTemplate];
  cloned.Pos = [positionTemplate];
  return cloned;
}

function stripPlaceholderIdentifiers(target: Record<string, unknown>) {
  for (const key of [
    "id",
    "Id",
    "objectId",
    "createdAt",
    "updatedAt",
    "CreatedAt",
    "UpdatedAt",
    "key",
    "Key",
    "uuid",
    "UUID",
  ]) {
    delete target[key];
  }

  return target;
}

function setNumericField(target: Record<string, unknown>, keys: string[], value: number) {
  for (const key of keys) {
    target[key] = value;
  }
}

function cloneJsonRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function buildTemplatePrefill(reservation: OpenSignReservationData) {
  const [workCategory, ...workNotes] = (reservation.workDescription ?? "").split(":");
  const normalizedCategory = workNotes.length > 0 ? workCategory.trim() : "";
  const normalizedNotes = workNotes.length > 0 ? workNotes.join(":").trim() : reservation.workDescription ?? "";
  const signerName = `${reservation.firstName ?? ""} ${reservation.lastName ?? ""}`.trim();
  const today = new Date().toISOString().slice(0, 10);
  const checklistData = getChecklistData(reservation.checklistJson);
  const checklist = checklistData.checklist;
  const tutorial = checklistData.tutorialAcknowledgement;
  const acceptedWaiver = reservation.damageWaiverChoice === "ACCEPTED";

  return [
    ...expandPrefillAliases(["name", "customer_name"], signerName),
    ...expandPrefillAliases(["email", "customer_email"], reservation.email),
    ...expandPrefillAliases(["phone", "customer_phone"], reservation.phone),
    ...expandPrefillAliases(["reservation_id", "reservationid"], reservation.publicId),
    ...expandPrefillAliases(["payment_reference"], reservation.stripeCheckoutSessionId ?? reservation.publicId),
    ...expandPrefillAliases(["weekend_start"], reservation.weekendStartDate.toISOString().slice(0, 10)),
    ...expandPrefillAliases(["weekend_end"], reservation.weekendEndDate.toISOString().slice(0, 10)),
    ...expandPrefillAliases(["jobsite_address"], `${reservation.jobsiteStreet}, ${reservation.jobsiteCity}, ${reservation.jobsiteState} ${reservation.jobsiteZip}`),
    ...expandPrefillAliases(["ticket_811"], reservation.colorado811Ticket ?? ""),
    ...expandPrefillAliases(["work_category"], normalizedCategory),
    ...expandPrefillAliases(["work_description"], normalizedNotes),
    ...expandPrefillAliases(["weekend_rental_charge"], formatCurrencyValue(reservation.rentalSubtotalCents)),
    ...expandPrefillAliases(["delivery_fee"], formatCurrencyValue(reservation.deliveryFeeCents)),
    ...expandPrefillAliases(["extended_delivery_fee"], formatCurrencyValue(reservation.extendedFeeCents)),
    ...expandPrefillAliases(["damage_waiver_fee"], formatCurrencyValue(reservation.damageWaiverFeeCents)),
    ...expandPrefillAliases(["taxes"], formatCurrencyValue(reservation.taxCents)),
    ...expandPrefillAliases(["security_deposit"], formatCurrencyValue(reservation.depositCents)),
    ...expandPrefillAliases(["total_due"], formatCurrencyValue(reservation.totalDueCents)),
    ...expandPrefillAliases(["damage_waiver_choice"], reservation.damageWaiverChoice),
    ...expandPrefillAliases(["is_property_owner"], reservation.isPropertyOwner == null ? "" : reservation.isPropertyOwner ? "Yes" : "No"),
    ...expandPrefillAliases(["is_property_owner_yes"], reservation.isPropertyOwner ? "Yes" : ""),
    ...expandPrefillAliases(["is_property_owner_no"], reservation.isPropertyOwner === false ? "Yes" : ""),
    ...expandPrefillAliases(["owner_permission"], reservation.ownerPermission == null ? "" : reservation.ownerPermission ? "Yes" : "No"),
    ...expandPrefillAliases(["owner_permission_yes"], reservation.ownerPermission ? "Yes" : ""),
    ...expandPrefillAliases(["owner_permission_no"], reservation.ownerPermission === false ? "Yes" : ""),
    ...expandPrefillAliases(["damage_waiver_accept"], acceptedWaiver ? "Yes" : ""),
    ...expandPrefillAliases(["damage_waiver_decline"], acceptedWaiver ? "" : "Yes"),
    ...expandPrefillAliases(["damage_waiver_acknowledged"], checklistData.waiverAcknowledged ? "Yes" : ""),
    ...expandPrefillAliases(["date_signed"], today),
    ...expandPrefillAliases(["date_countersigned"], ""),
    ...expandPrefillAliases(["internal_approval_note"], ""),
    ...expandPrefillAliases(["signature_approved", "signature_approval"], ""),
    ...expandPrefillAliases(["machine_unit", "machine_serial", "attachments_included", "hour_meter_out", "hour_meter_in", "fuel_level_out", "fuel_level_in"], ""),
    ...expandPrefillAliases(["authorized_operator_1", "authorized_operator_1_phone", "authorized_operator_2", "authorized_operator_2_phone"], ""),
    ...expandPrefillAliases(["tutorial_video_version"], "quick-start-v1"),
    ...expandPrefillAliases(["tutorial_completion_status"], allTruthy(tutorial) ? "Completed" : "Pending"),
    ...expandPrefillAliases(["knows_boundaries"], checklist.knowsBoundaries ? "Yes" : ""),
    ...expandPrefillAliases(["understands_fence_not_boundary"], checklist.understandsFenceNotBoundary ? "Yes" : ""),
    ...expandPrefillAliases(["has_owner_permission"], checklist.hasOwnerPermission ? "Yes" : ""),
    ...expandPrefillAliases(["not_digging_neighbor_property"], checklist.notDiggingNeighborProperty ? "Yes" : ""),
    ...expandPrefillAliases(["not_digging_public_row_without_permit"], checklist.notDiggingPublicROWWithoutPermit ? "Yes" : ""),
    ...expandPrefillAliases(["submitted_811_or_will_before_digging"], checklist.submitted811OrWillBeforeDigging ? "Yes" : ""),
    ...expandPrefillAliases(["will_wait_for_locate_window"], checklist.willWaitForLocateWindow ? "Yes" : ""),
    ...expandPrefillAliases(["understands_private_utilities"], checklist.understandsPrivateUtilities ? "Yes" : ""),
    ...expandPrefillAliases(["will_avoid_utility_tolerance_zone"], checklist.willAvoidUtilityToleranceZone ? "Yes" : ""),
    ...expandPrefillAliases(["will_not_undermine_structures"], checklist.willNotUndermineStructures ? "Yes" : ""),
    ...expandPrefillAliases(["will_keep_people_pets_away"], checklist.willKeepPeoplePetsAway ? "Yes" : ""),
    ...expandPrefillAliases(["will_stop_if_unsafe"], checklist.willStopIfUnsafe ? "Yes" : ""),
    ...expandPrefillAliases(["understands_equipment_may_be_tracked"], checklist.understandsEquipmentMayBeTracked ? "Yes" : ""),
    ...expandPrefillAliases(["consents_to_location_monitoring"], checklist.consentsToLocationMonitoring ? "Yes" : ""),
    ...expandPrefillAliases(["will_use_only_at_approved_jobsite"], checklist.willUseOnlyAtApprovedJobsite ? "Yes" : ""),
    ...expandPrefillAliases(["will_not_move_without_approval"], checklist.willNotMoveWithoutApproval ? "Yes" : ""),
    ...expandPrefillAliases(["will_not_transport_without_approval"], checklist.willNotTransportWithoutApproval ? "Yes" : ""),
    ...expandPrefillAliases(["will_not_tamper_with_tracking_device"], checklist.willNotTamperWithTrackingDevice ? "Yes" : ""),
    ...expandPrefillAliases(["understands_geofence_breach_consequences"], checklist.understandsGeofenceBreachConsequences ? "Yes" : ""),
    ...expandPrefillAliases(["received_quick_start_guide"], tutorial.receivedQuickStartGuide ? "Yes" : ""),
    ...expandPrefillAliases(["understands_basic_controls"], tutorial.understandsBasicControls ? "Yes" : ""),
    ...expandPrefillAliases(["knows_emergency_shutdown"], tutorial.knowsEmergencyShutdown ? "Yes" : ""),
    ...expandPrefillAliases(["understands_tip_risk"], tutorial.understandsTipRisk ? "Yes" : ""),
    ...expandPrefillAliases(["will_watch_tutorial_videos"], tutorial.willWatchTutorialVideos ? "Yes" : ""),
    ...expandPrefillAliases(["will_call_if_unsure"], tutorial.willCallIfUnsure ? "Yes" : ""),
  ];
}

function expandWidgetAliases(names: string[], defaultValue: string) {
  return Array.from(new Set(names.flatMap((name) => buildTemplateFieldAliases(name)))).map((name) => ({
    name,
    readonly: false,
    default: defaultValue,
  }));
}

function expandPrefillAliases(names: string[], response: string) {
  return Array.from(new Set(names.flatMap((name) => buildTemplateFieldAliases(name)))).map((name) => ({
    name,
    response,
  }));
}

function buildTemplateFieldAliases(name: string) {
  const normalized = name.trim();
  const underscored = normalized.replace(/\s+/g, "_");
  const spaced = underscored.replace(/_/g, " ");
  return [
    normalized,
    underscored,
    spaced,
    `{{${normalized}}}`,
    `{{${underscored}}}`,
    `{{${spaced}}}`,
    `{{ ${normalized} }}`,
    `{{ ${underscored} }}`,
    `{{ ${spaced} }}`,
  ];
}

function formatCurrencyValue(cents: number | null | undefined) {
  if (cents == null) {
    return "";
  }

  return `$${(cents / 100).toFixed(2)}`;
}

function getChecklistData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      checklist: {} as Record<string, boolean>,
      tutorialAcknowledgement: {} as Record<string, boolean>,
      waiverAcknowledged: false,
    };
  }

  const root = value as Record<string, unknown>;
  const checklist =
    root.checklist && typeof root.checklist === "object" && !Array.isArray(root.checklist)
      ? root.checklist as Record<string, boolean>
      : {};
  const tutorialAcknowledgement =
    root.tutorialAcknowledgement && typeof root.tutorialAcknowledgement === "object" && !Array.isArray(root.tutorialAcknowledgement)
      ? root.tutorialAcknowledgement as Record<string, boolean>
      : {};

  return {
    checklist,
    tutorialAcknowledgement,
    waiverAcknowledged: root.waiverAcknowledged === true,
  };
}

function allTruthy(values: Record<string, boolean>) {
  const entries = Object.values(values);
  return entries.length > 0 && entries.every(Boolean);
}

function getOpenSignApiBase() {
  return (env.OPENSIGN_INTERNAL_API_URL || env.OPENSIGN_API_URL)!.replace(/\/+$/, "");
}

async function loginOpenSignAdmin() {
  const apiBase = getOpenSignApiBase();
  const loginUrl = new URL(`${apiBase}/login`);
  loginUrl.searchParams.set("username", env.OPENSIGN_USERNAME!);
  loginUrl.searchParams.set("password", env.OPENSIGN_PASSWORD!);

  const response = await fetchJson(loginUrl.toString(), {
    method: "GET",
    headers: buildOpenSignHeaders({ includeMasterKey: false }),
  });

  const sessionToken = firstString([
    getNestedString(response, ["sessionToken"]),
    getNestedString(response, ["result", "sessionToken"]),
  ]);

  if (!sessionToken) {
    throw new Error("OpenSign login did not return a session token. Check OPENSIGN_USERNAME and OPENSIGN_PASSWORD.");
  }

  return sessionToken;
}

function buildOpenSignHeaders(options?: { includeMasterKey?: boolean }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (env.OPENSIGN_API_KEY) {
    headers["x-api-token"] = env.OPENSIGN_API_KEY;
  }

  if (env.OPENSIGN_APP_ID) {
    headers["X-Parse-Application-Id"] = env.OPENSIGN_APP_ID;
  }

  if (options?.includeMasterKey !== false && env.OPENSIGN_MASTER_KEY) {
    headers["X-Parse-Master-Key"] = env.OPENSIGN_MASTER_KEY;
  }

  return headers;
}

function extractOpenSignEmbedUrl(payload: unknown, documentId: string) {
  const placeholderCollections = [
    getNestedArray(payload, ["result", "Placeholders"]),
    getNestedArray(payload, ["result", "placeholders"]),
    getNestedArray(payload, ["Placeholders"]),
    getNestedArray(payload, ["placeholders"]),
  ].filter((entry): entry is unknown[] => Array.isArray(entry));

  const signerCollections = [
    getNestedArray(payload, ["result", "Signers"]),
    getNestedArray(payload, ["result", "signers"]),
    getNestedArray(payload, ["Signers"]),
    getNestedArray(payload, ["signers"]),
  ].filter((entry): entry is unknown[] => Array.isArray(entry));

  const signerObjectId = firstString([
    ...placeholderCollections.flatMap((collection) => {
      const first = collection[0];
      return first && typeof first === "object" && !Array.isArray(first)
        ? [
            getNestedString(first, ["signerObjId"]),
            getNestedString(first, ["SignerObjId"]),
            getNestedString(first, ["signerPtr", "objectId"]),
            getNestedString(first, ["SignerPtr", "objectId"]),
          ]
        : [];
    }),
    ...signerCollections.flatMap((collection) => {
      const first = collection[0];
      return first && typeof first === "object" && !Array.isArray(first)
        ? [
            getNestedString(first, ["objectId"]),
            getNestedString(first, ["id"]),
          ]
        : [];
    }),
  ]);

  if (signerObjectId && env.OPENSIGN_PUBLIC_URL) {
    try {
      const preferred = new URL(env.OPENSIGN_PUBLIC_URL);
      preferred.pathname = `/load/recipientSignPdf/${encodeURIComponent(documentId)}/${encodeURIComponent(signerObjectId)}`;
      return preferred.toString();
    } catch {
      // fall through to other candidates
    }
  }

  const directCandidates = collectStringValues(payload).map((value: string) => absolutizeOpenSignUrl(value));
  const rankedCandidate = directCandidates.find((value: string | null) => {
    if (!value || !isSafeOpenSignUrl(value)) {
      return false;
    }

    const lower = value.toLowerCase();
    return (
      lower.includes("recipientsignpdf") ||
      lower.includes("/load/recipientsignpdf/") ||
      lower.includes("/recipient/") ||
      lower.includes("/sign/") ||
      lower.includes("/submit/") ||
      lower.includes(documentId.toLowerCase())
    );
  });

  if (rankedCandidate) {
    return normalizeOpenSignSignerUrl(rankedCandidate, documentId, signerObjectId ?? undefined);
  }

  return null;
}

function inspectOpenSignDocumentResponse(payload: unknown, documentId: string) {
  const embedUrl = extractOpenSignEmbedUrl(payload, documentId);
  const candidateUrls = Array.from(
    new Set(
      collectStringValues(payload)
        .map((value: string) => absolutizeOpenSignUrl(value))
        .filter((value: string | null): value is string => Boolean(value && isSafeOpenSignUrl(value))),
    ),
  ).slice(0, 20);

  const signerCollections = [
    getNestedArray(payload, ["signers"]),
    getNestedArray(payload, ["Signers"]),
    getNestedArray(payload, ["result", "signers"]),
    getNestedArray(payload, ["result", "Signers"]),
    getNestedArray(payload, ["data", "signers"]),
    getNestedArray(payload, ["data", "Signers"]),
    getNestedArray(payload, ["Recipients"]),
    getNestedArray(payload, ["recipients"]),
  ].filter((entry): entry is unknown[] => Array.isArray(entry));

  const signerSummaries = signerCollections
    .flatMap((collection) => collection)
    .map((entry) => summarizeOpenSignSigner(entry))
    .filter((entry) => entry != null)
    .slice(0, 10);

  const placeholderCollections = [
    getNestedArray(payload, ["Placeholders"]),
    getNestedArray(payload, ["placeholders"]),
    getNestedArray(payload, ["result", "Placeholders"]),
    getNestedArray(payload, ["result", "placeholders"]),
    getNestedArray(payload, ["data", "Placeholders"]),
    getNestedArray(payload, ["data", "placeholders"]),
  ].filter((entry): entry is unknown[] => Array.isArray(entry));

  const placeholderBindingSummary = placeholderCollections
    .flatMap((collection) => collection)
    .map((entry) => summarizeOpenSignPlaceholderBinding(entry))
    .filter((entry) => entry != null)
    .slice(0, 20);

  const topLevelKeys = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>).slice(0, 40)
    : [];

  return {
    embedUrl,
    candidateUrls,
    signerSummaries,
    placeholderBindingSummary,
    topLevelKeys,
    documentId,
  };
}

function summarizeOpenSignSigner(entry: unknown) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  return {
    name: firstString([
      getNestedString(entry, ["Name"]),
      getNestedString(entry, ["name"]),
    ]),
    email: firstString([
      getNestedString(entry, ["Email"]),
      getNestedString(entry, ["email"]),
    ]),
    role: firstString([
      getNestedString(entry, ["Role"]),
      getNestedString(entry, ["role"]),
    ]),
    objectId: firstString([
      getNestedString(entry, ["objectId"]),
      getNestedString(entry, ["id"]),
    ]),
    link: firstString([
      absolutizeOpenSignUrl(getNestedString(entry, ["url"])),
      absolutizeOpenSignUrl(getNestedString(entry, ["signing_url"])),
      absolutizeOpenSignUrl(getNestedString(entry, ["signingUrl"])),
      absolutizeOpenSignUrl(getNestedString(entry, ["link"])),
    ]),
  };
}

function summarizeOpenSignPlaceholderBinding(entry: unknown) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const placeholderItems =
    getNestedArray(entry, ["placeHolder"]) ??
    getNestedArray(entry, ["placeholder"]) ??
    [];

  const firstField =
    Array.isArray(placeholderItems) && placeholderItems.length > 0 && placeholderItems[0] && typeof placeholderItems[0] === "object"
      ? placeholderItems[0]
      : null;

  const firstPos =
    firstField && !Array.isArray(firstField)
      ? getNestedArray(firstField, ["pos"])?.[0] ?? null
      : null;

  return {
    role: firstString([
      getNestedString(entry, ["Role"]),
      getNestedString(entry, ["role"]),
    ]),
    signerObjId: firstString([
      getNestedString(entry, ["signerObjId"]),
      getNestedString(entry, ["SignerObjId"]),
    ]),
    signerPtrObjectId: firstString([
      getNestedString(entry, ["signerPtr", "objectId"]),
      getNestedString(entry, ["SignerPtr", "objectId"]),
    ]),
    placeholderId: firstString([
      getNestedString(entry, ["Id"]),
      getNestedString(entry, ["id"]),
    ]),
    fieldType:
      firstPos && typeof firstPos === "object" && !Array.isArray(firstPos)
        ? firstString([
            getNestedString(firstPos, ["type"]),
            getNestedString(firstPos, ["Type"]),
          ])
        : null,
    fieldName:
      firstPos && typeof firstPos === "object" && !Array.isArray(firstPos)
        ? firstString([
            getNestedString(firstPos, ["options", "name"]),
            getNestedString(firstPos, ["Options", "name"]),
            getNestedString(firstPos, ["Options", "Name"]),
          ])
        : null,
    fieldCount: Array.isArray(placeholderItems)
      ? placeholderItems.reduce((count, item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return count;
          }
          return count + (getNestedArray(item, ["pos"])?.length ?? 0);
        }, 0)
      : 0,
  };
}

async function fetchJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OPENSIGN_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      const endpoint = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();

      throw new Error(
        `OpenSign ${init.method ?? "GET"} ${endpoint} timed out after ${env.OPENSIGN_REQUEST_TIMEOUT_MS}ms. ` +
        `If OpenSign is on the same RackNerd server, point OPENSIGN_INTERNAL_API_URL at the local service (for example http://127.0.0.1:8081/app).`,
      );
    }

    throw error;
  }

  const text = await response.text();
  clearTimeout(timeout);
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const code =
      typeof data === "object" && data !== null && "code" in data && typeof (data as { code?: unknown }).code === "number"
        ? (data as { code: number }).code
        : null;
    const detail =
      typeof data === "string"
        ? data
        : typeof data === "object" && data !== null && "message" in data && typeof (data as { message?: unknown }).message === "string"
          ? (data as { message: string }).message
          : typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : `OpenSign request failed with HTTP ${response.status}.`;
    const endpoint = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })();

    throw new Error(
      `OpenSign ${init.method ?? "GET"} ${endpoint} failed with HTTP ${response.status}${
        code != null ? ` (code ${code})` : ""
      }: ${detail}`,
    );
  }

  return data;
}

function extractDocumentId(payload: unknown): string | null {
  return firstString([
    getNestedString(payload, ["id"]),
    getNestedString(payload, ["objectId"]),
    getNestedString(payload, ["documentId"]),
    getNestedString(payload, ["document_id"]),
    getNestedString(payload, ["result", "id"]),
    getNestedString(payload, ["result", "objectId"]),
    getNestedString(payload, ["result", "documentId"]),
    getNestedString(payload, ["data", "id"]),
    getNestedString(payload, ["data", "objectId"]),
    getNestedString(payload, ["data", "documentId"]),
  ]);
}

function extractSigningLink(payload: unknown): string | null {
  const direct = firstString([
    getNestedString(payload, ["url"]),
    getNestedString(payload, ["signing_url"]),
    getNestedString(payload, ["signingUrl"]),
    getNestedString(payload, ["result", "url"]),
    getNestedString(payload, ["result", "signing_url"]),
    getNestedString(payload, ["data", "url"]),
    getNestedString(payload, ["data", "signing_url"]),
  ]);
  if (direct) {
    return direct;
  }

  const collections = [
    getNestedArray(payload, ["links"]),
    getNestedArray(payload, ["signingLinks"]),
    getNestedArray(payload, ["signers"]),
    getNestedArray(payload, ["result", "links"]),
    getNestedArray(payload, ["result", "signingLinks"]),
    getNestedArray(payload, ["result", "signers"]),
    getNestedArray(payload, ["data", "links"]),
    getNestedArray(payload, ["data", "signingLinks"]),
    getNestedArray(payload, ["data", "signers"]),
  ];

  for (const entry of collections) {
    if (!entry) {
      continue;
    }

    for (const item of entry) {
      const found = firstString([
        getNestedString(item, ["url"]),
        getNestedString(item, ["signing_url"]),
        getNestedString(item, ["signingUrl"]),
        getNestedString(item, ["link"]),
      ]);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function getNestedString(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function getNestedBoolean(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "boolean" ? current : null;
}

function getNestedArray(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return Array.isArray(current) ? current : null;
}

function getNestedValue(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function firstString(values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? null;
}

function firstBoolean(values: Array<boolean | null | undefined>) {
  return values.find((value) => typeof value === "boolean") ?? null;
}

function collectStringValues(payload: unknown, seen = new Set<unknown>()): string[] {
  if (payload == null || seen.has(payload)) {
    return [] as string[];
  }

  if (typeof payload === "string") {
    return [payload];
  }

  if (typeof payload !== "object") {
    return [] as string[];
  }

  seen.add(payload);

  if (Array.isArray(payload)) {
    return payload.flatMap((value: unknown) => collectStringValues(value, seen));
  }

  return Object.values(payload).flatMap((value: unknown) => collectStringValues(value, seen));
}

function absolutizeOpenSignUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url, env.OPENSIGN_PUBLIC_URL).toString();
  } catch {
    return null;
  }
}

function normalizeOpenSignSignerUrl(url: string | null | undefined, documentId?: string, signerObjectId?: string) {
  const absolute = absolutizeOpenSignUrl(url ?? null);
  if (!absolute) {
    return null;
  }

  try {
    const parsed = new URL(absolute);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const singleSegment = pathSegments.length === 1 ? pathSegments[0] : null;

    if (singleSegment && (!documentId || singleSegment.toLowerCase() === documentId.toLowerCase())) {
      parsed.pathname = signerObjectId
        ? `/load/recipientSignPdf/${singleSegment}/${signerObjectId}`
        : `/load/recipientSignPdf/${singleSegment}`;
      return parsed.toString();
    }

    if (documentId && signerObjectId) {
      const lowerSegments = pathSegments.map((segment) => segment.toLowerCase());
      const hasRecipientRoute = lowerSegments.includes("recipientsignpdf");

      if (hasRecipientRoute) {
        parsed.pathname = `/load/recipientSignPdf/${documentId}/${signerObjectId}`;
        return parsed.toString();
      }
    }

    return parsed.toString();
  } catch {
    return absolute;
  }
}

function isSafeOpenSignUrl(url: string | null | undefined) {
  if (!url || !env.OPENSIGN_PUBLIC_URL) {
    return false;
  }

  try {
    const publicBase = new URL(env.OPENSIGN_PUBLIC_URL);
    const candidate = new URL(url, env.OPENSIGN_PUBLIC_URL);
    if (candidate.origin !== publicBase.origin) {
      return false;
    }

    const normalizedPath = candidate.pathname.replace(/\/+$/, "");
    if (!normalizedPath || normalizedPath === "" || normalizedPath === "/") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getLegacyFlagsObject(flags: unknown) {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return {};
  }

  return flags as Record<string, unknown>;
}

function getLegacySigningFlags(flags: unknown): OpenSignFlags {
  const objectFlags = getLegacyFlagsObject(flags);
  const openSign = objectFlags.opensign;
  if (openSign && typeof openSign === "object" && !Array.isArray(openSign)) {
    return openSign as OpenSignFlags;
  }

  return { embedUrl: null };
}

export default router;
