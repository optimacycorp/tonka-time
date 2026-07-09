import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { env } from "./lib/config.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/account.js";
import stripeRoutes, { stripeWebhookHandler } from "./routes/stripe.js";
import openSignRoutes from "./routes/opensign.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: true, credentials: true }));
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "tonka-time-rentals" });
});

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api", publicRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/opensign", openSignRoutes);

app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api")) {
    next(error);
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  console.error(error);
  res.status(500).json({ error: message });
});

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(env.API_PORT, () => {
  console.log(`Tonka Time API listening on http://localhost:${env.API_PORT}`);
});
