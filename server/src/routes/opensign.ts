import { Router, type RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

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
  const embedUrl = normalizeOpenSignSignerUrl(flags.embedUrl, reservation.docusealSubmissionId ?? undefined);

  if (reservation.docusealStatus === "COMPLETED" || reservation.signedDocumentUrl) {
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

async function createLiveSigningSession(reservation: {
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
}): Promise<OpenSignLiveSession> {
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

async function createLiveSigningSessionViaLegacyApi(reservation: {
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
}): Promise<OpenSignLiveSession> {
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

async function createLiveSigningSessionViaAdminSession(reservation: {
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
}): Promise<OpenSignLiveSession> {
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

  const templateUrl = firstString([
    getNestedString(template, ["URL"]),
    getNestedString(template, ["url"]),
  ]);

  if (!templateUrl) {
    throw new Error("The OpenSign template exists, but it does not expose a source PDF URL.");
  }

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

  const signers = buildOpenSignDocumentSigners(contactId);
  const placeholders = buildOpenSignDocumentPlaceholders(
    getNestedArray(template, ["Placeholders"]),
    contactId,
    reservation,
  );

  const documentPayload: Record<string, unknown> = {
    Name: `${templateName} ${reservation.publicId}`.trim(),
    URL: templateUrl,
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
    SignedUrl: templateUrl,
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
    console.error("OpenSign signinglinks lookup failed", fallbackError);
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
      selectedEmbedUrl: safeEmbedUrl,
      selectedSource: isSafeOpenSignUrl(absolutizeOpenSignUrl(extractSigningLink(signingLinksDebug))) ? "signinglinks" : "getDocument",
      documentDebug,
      signingLinksDebug: toPrismaJson(signingLinksDebug),
    }),
  };
}

function buildTemplateWidgetDefaults(reservation: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}) {
  return [
    { name: "name", readonly: false, default: `${reservation.firstName} ${reservation.lastName}`.trim() },
    { name: "email", readonly: false, default: reservation.email },
    { name: "phone", readonly: false, default: reservation.phone },
    { name: "company", readonly: false, default: "Tonka Time Rentals customer" },
    { name: "job title", readonly: false, default: "Customer" },
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
  reservation: {
    publicId: string;
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
    firstName: string;
    lastName: string;
    email: string;
  },
) {
  const placeholderValues = new Map(
    buildTemplatePrefill(reservation).map((entry) => [entry.name.toLowerCase(), entry.response]),
  );
  placeholderValues.set("name", `${reservation.firstName} ${reservation.lastName}`.trim());
  placeholderValues.set("email", reservation.email);

  const templateEntries = Array.isArray(templatePlaceholders) ? templatePlaceholders : [];
  return templateEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }

    const updated = { ...(entry as Record<string, unknown>) };
    updated.signerPtr = {
      __type: "Pointer",
      className: "contracts_Contactbook",
      objectId: contactId,
    };
    updated.signerObjId = contactId;
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
}

function buildTemplatePrefill(reservation: {
  publicId: string;
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
}) {
  const [workCategory, ...workNotes] = (reservation.workDescription ?? "").split(":");
  const normalizedCategory = workNotes.length > 0 ? workCategory.trim() : "";
  const normalizedNotes = workNotes.length > 0 ? workNotes.join(":").trim() : reservation.workDescription ?? "";

  return [
    { name: "reservation_id", response: reservation.publicId },
    { name: "weekend_start", response: reservation.weekendStartDate.toISOString().slice(0, 10) },
    { name: "weekend_end", response: reservation.weekendEndDate.toISOString().slice(0, 10) },
    { name: "jobsite_address", response: `${reservation.jobsiteStreet}, ${reservation.jobsiteCity}, ${reservation.jobsiteState} ${reservation.jobsiteZip}` },
    { name: "ticket_811", response: reservation.colorado811Ticket ?? "" },
    { name: "work_category", response: normalizedCategory },
    { name: "work_description", response: normalizedNotes },
    { name: "damage_waiver_choice", response: reservation.damageWaiverChoice },
    { name: "is_property_owner", response: reservation.isPropertyOwner == null ? "" : reservation.isPropertyOwner ? "Yes" : "No" },
    { name: "owner_permission", response: reservation.ownerPermission == null ? "" : reservation.ownerPermission ? "Yes" : "No" },
  ];
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
    return normalizeOpenSignSignerUrl(rankedCandidate, documentId);
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

function normalizeOpenSignSignerUrl(url: string | null | undefined, documentId?: string) {
  const absolute = absolutizeOpenSignUrl(url ?? null);
  if (!absolute) {
    return null;
  }

  try {
    const parsed = new URL(absolute);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const singleSegment = pathSegments.length === 1 ? pathSegments[0] : null;

    if (singleSegment && (!documentId || singleSegment.toLowerCase() === documentId.toLowerCase())) {
      parsed.pathname = `/load/recipientsignpdf/${singleSegment}`;
      return parsed.toString();
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
