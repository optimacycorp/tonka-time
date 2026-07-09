import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: "../.env" });
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://tonka:tonka@localhost:5432/tonka"),
  SITE_URL: z.string().url().default("http://localhost:5173"),
  API_PORT: z.coerce.number().default(8787),
  AUTH_SESSION_DAYS: z.coerce.number().default(14),
  PHONE_CODE_TTL_MINUTES: z.coerce.number().default(10),
  ADMIN_EMAILS: z.string().default("optimacycorp@gmail.com"),
  NOTIFICATION_EMAIL_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_PHONE: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CURRENCY: z.string().default("usd"),
  OPENSIGN_PUBLIC_URL: z.string().optional(),
  OPENSIGN_API_URL: z.string().optional(),
  OPENSIGN_TENANT_ID: z.string().optional(),
  OPENSIGN_API_KEY: z.string().optional(),
  OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL: z.string().optional(),
  OPENSIGN_WEBHOOK_SECRET: z.string().optional(),
  CORE_DELIVERY_FEE_CENTS: z.coerce.number().default(10000),
  EXTENDED_DELIVERY_BASE_FEE_CENTS: z.coerce.number().default(15000),
  EXTENDED_DELIVERY_PER_MILE_CENTS: z.coerce.number().default(300),
  WEEKEND_PRICE_CENTS: z.coerce.number().default(59500),
  DAMAGE_WAIVER_FEE_CENTS: z.coerce.number().default(7500),
  DEPOSIT_CENTS: z.coerce.number().default(50000),
});

export const env = envSchema.parse(process.env);
export const adminEmails = env.ADMIN_EMAILS.split(",").map((email) => email.trim().toLowerCase());
