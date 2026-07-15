import { access } from "node:fs/promises";
import path from "node:path";
import type { AgreementAnchorLocateResult } from "./agreement-anchor-locator.js";
import type { AgreementAnchorWidgetRect } from "./agreement-anchor-widgets.js";

export type AgreementPdfArtifactsPayload = {
  layoutVersion: string;
  reservationPublicId: string;
  generatedAt: string;
  sourcePdfPath: string;
  maskedPdfPath: string;
  debugPdfPath: string;
  anchorLocations: AgreementAnchorLocateResult["locations"];
  widgetRects: AgreementAnchorWidgetRect[];
};

export async function ensureAgreementPdfArtifactsScript() {
  const scriptPath = path.resolve(process.cwd(), "scripts", "render_agreement_pdf_artifacts.py");
  await access(scriptPath);
  return scriptPath;
}
