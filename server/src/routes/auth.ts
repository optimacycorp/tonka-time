import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { claimReservationsForUser, createSessionForUser, optionalAuth, requireAuth, revokeSession } from "../lib/auth.js";
import { env } from "../lib/config.js";
import { createPhoneCode, hashPassword, hashToken, normalizeEmail, normalizePhone, verifyPassword } from "../lib/security.js";

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.post("/signup", asyncRoute(async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().min(7).optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = normalizeEmail(parsed.data.email);
  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email }, ...(phone ? [{ phone }] : [])],
    },
  });

  if (existing?.email === email && existing.passwordHash) {
    return res.status(409).json({ error: "An account already exists for that email." });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          email,
          phone: phone ?? existing.phone,
          passwordHash,
          firstName: parsed.data.firstName ?? existing.firstName,
          lastName: parsed.data.lastName ?? existing.lastName,
          emailVerifiedAt: new Date(),
        },
      })
    : await prisma.user.create({
        data: {
          email,
          phone,
          passwordHash,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          emailVerifiedAt: new Date(),
        },
      });

  await claimReservationsForUser(user);
  const session = await createSessionForUser(user.id);

  return res.status(201).json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
}));

router.post("/login", asyncRoute(async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  await claimReservationsForUser(user);
  const session = await createSessionForUser(user.id);
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
}));

router.post("/phone/request-code", asyncRoute(async (req, res) => {
  const parsed = z.object({
    phone: z.string().min(7),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const phone = normalizePhone(parsed.data.phone);
  const existingUser = await prisma.user.findUnique({ where: { phone } });
  const user = existingUser ?? await prisma.user.create({
    data: {
      phone,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    },
  });

  await claimReservationsForUser(user);
  await prisma.phoneLoginCode.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = createPhoneCode();
  await prisma.phoneLoginCode.create({
    data: {
      userId: user.id,
      phone,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + env.PHONE_CODE_TTL_MINUTES * 60 * 1000),
    },
  });

  const smsConfigured = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_PHONE);
  return res.json({
    sent: true,
    channel: "sms",
    phone,
    message: smsConfigured
      ? "Login code queued for SMS delivery."
      : "SMS provider is not configured yet, so the code is available in dev mode only.",
    devCode: smsConfigured ? undefined : code,
  });
}));

router.post("/phone/verify-code", asyncRoute(async (req, res) => {
  const parsed = z.object({
    phone: z.string().min(7),
    code: z.string().length(6),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const phone = normalizePhone(parsed.data.phone);
  const codeHash = hashToken(parsed.data.code);
  const now = new Date();
  const phoneCode = await prisma.phoneLoginCode.findFirst({
    where: {
      phone,
      codeHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!phoneCode?.userId) {
    return res.status(401).json({ error: "Invalid or expired code." });
  }

  await prisma.phoneLoginCode.update({
    where: { id: phoneCode.id },
    data: { consumedAt: now },
  });

  const user = await prisma.user.update({
    where: { id: phoneCode.userId },
    data: { phoneVerifiedAt: now },
  });

  await claimReservationsForUser(user);
  const session = await createSessionForUser(user.id);
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
}));

router.get("/me", optionalAuth, asyncRoute(async (_req, res) => {
  const user = res.locals.user;
  if (!user) {
    return res.status(401).json({ error: "Not signed in." });
  }

  return res.json({ user });
}));

router.post("/logout", requireAuth, asyncRoute(async (_req, res) => {
  await revokeSession(res.locals.authToken as string | null);
  return res.json({ ok: true });
}));

export default router;
