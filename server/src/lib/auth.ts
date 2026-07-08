import type { RequestHandler } from "express";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "./prisma.js";
import { env } from "./config.js";
import { createSessionToken, hashToken, normalizeEmail } from "./security.js";

export type AuthUser = Pick<User, "id" | "email" | "phone" | "firstName" | "lastName" | "role">;

function extractBearerToken(headerValue?: string | string[]) {
  if (!headerValue || Array.isArray(headerValue)) {
    return null;
  }

  const [scheme, value] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return null;
  }

  return value.trim();
}

async function resolveAuthUser(token: string | null): Promise<AuthUser | null> {
  if (!token) {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    id: session.user.id,
    email: session.user.email,
    phone: session.user.phone,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    role: session.user.role,
  };
}

export const optionalAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    res.locals.authToken = token;
    res.locals.user = await resolveAuthUser(token);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const user = await resolveAuthUser(token);
    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    res.locals.authToken = token;
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(role: UserRole): RequestHandler {
  return (req, res, next) => {
    const user = res.locals.user as AuthUser | undefined;
    if (!user || user.role !== role) {
      return res.status(403).json({ error: "You do not have access to this resource." });
    }
    next();
  };
}

export async function createSessionForUser(userId: string) {
  const token = createSessionToken();
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { token, sessionId: session.id, expiresAt: session.expiresAt };
}

export async function revokeSession(token: string | null) {
  if (!token) {
    return;
  }

  await prisma.authSession.deleteMany({
    where: { tokenHash: hashToken(token) },
  });
}

export async function claimReservationsForUser(user: Pick<User, "id" | "email" | "phone">) {
  const orFilters = [
    user.email ? { email: normalizeEmail(user.email) } : null,
    user.phone ? { phone: user.phone } : null,
  ].filter(Boolean) as Array<{ email?: string; phone?: string }>;

  if (orFilters.length === 0) {
    return;
  }

  await prisma.reservation.updateMany({
    where: {
      userId: null,
      OR: orFilters,
    },
    data: {
      userId: user.id,
    },
  });
}
