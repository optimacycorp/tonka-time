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
  FAKE_PAY: z
    .string()
    .optional()
    .transform((value) => value?.toLowerCase() === "true"),
  OPENSIGN_PUBLIC_URL: z.string().optional(),
  OPENSIGN_API_URL: z.string().optional(),
  OPENSIGN_INTERNAL_API_URL: z.string().optional(),
  OPENSIGN_APP_ID: z.string().default("opensign"),
  OPENSIGN_TENANT_ID: z.string().optional(),
  OPENSIGN_API_KEY: z.string().optional(),
  OPENSIGN_MASTER_KEY: z.string().optional(),
  OPENSIGN_USERNAME: z.string().optional(),
  OPENSIGN_PASSWORD: z.string().optional(),
  OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL: z.string().optional(),
  OPENSIGN_WEBHOOK_SECRET: z.string().optional(),
  OPENSIGN_REQUEST_TIMEOUT_MS: z.coerce.number().default(15000),
  CORE_DELIVERY_FEE_CENTS: z.coerce.number().default(10000),
  EXTENDED_DELIVERY_BASE_FEE_CENTS: z.coerce.number().default(15000),
  EXTENDED_DELIVERY_PER_MILE_CENTS: z.coerce.number().default(300),
  WEEKEND_PRICE_CENTS: z.coerce.number().default(59500),
  DAMAGE_WAIVER_FEE_CENTS: z.coerce.number().default(7500),
  DEPOSIT_CENTS: z.coerce.number().default(50000),
  AGREEMENT_TEMPLATE_DOCX_PATH: z.string().optional(),
  AGREEMENT_PRIVATE_STORAGE_DIR: z.string().optional(),
  AGREEMENT_GENERATION_MODE: z.enum(["opensign_prefill", "server_pdf"]).default("server_pdf"),
  AGREEMENT_RENDER_TIMEOUT_MS: z.coerce.number().default(120000),
  AGREEMENT_PDF_CONVERTER: z.enum(["auto", "soffice", "word"]).default("auto"),
  AGREEMENT_NORMALIZE_PDF: z
    .string()
    .optional()
    .transform((value) => value == null ? true : value.toLowerCase() === "true"),
  AGREEMENT_OFFICE_BIN: z.string().optional(),
  AGREEMENT_REQUIRE_ANCHORS: z
    .string()
    .optional()
    .transform((value) => value?.toLowerCase() === "true"),
});

export const env = envSchema.parse(process.env);
export const adminEmails = env.ADMIN_EMAILS.split(",").map((email) => email.trim().toLowerCase());
