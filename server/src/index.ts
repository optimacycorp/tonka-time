import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./lib/config.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import stripeRoutes from "./routes/stripe.js";
import docusealRoutes from "./routes/docuseal.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "tonka-time-rentals" });
});

app.use("/api", publicRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/docuseal", docusealRoutes);

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(env.API_PORT, () => {
  console.log(`Tonka Time API listening on http://localhost:${env.API_PORT}`);
});
