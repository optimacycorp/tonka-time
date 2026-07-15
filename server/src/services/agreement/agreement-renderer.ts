import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "../../lib/config.js";
import { buildAgreementData, type ReservationAgreementSource } from "./agreement-data.js";
import { agreementTokens } from "./agreement-tokens.js";

export type GeneratedAgreement = {
  reservationId: string;
  templatePath: string;
  outputDirectory: string;
  outputDocxPath: string;
  outputPdfPath: string;
  sha256: string;
  generatedAt: string;
  templateTokenCount: number;
  renderMode: "skeleton";
};

export async function renderUnsignedAgreement(
  reservation: ReservationAgreementSource,
  options?: { force?: boolean },
): Promise<GeneratedAgreement> {
  const templatePath = resolveAgreementTemplatePath();
  await access(templatePath);

  const templateBuffer = await readFile(templatePath);
  const agreementData = buildAgreementData(reservation);
  const outputDirectory = path.join(resolveAgreementStorageRoot(), reservation.publicId);
  await mkdir(outputDirectory, { recursive: true });

  const fingerprint = createHash("sha256")
    .update(templateBuffer)
    .update(JSON.stringify({ agreementData, force: options?.force === true }))
    .digest("hex");

  return {
    reservationId: reservation.id,
    templatePath,
    outputDirectory,
    outputDocxPath: path.join(outputDirectory, `${reservation.publicId}-unsigned.docx`),
    outputPdfPath: path.join(outputDirectory, `${reservation.publicId}-unsigned.pdf`),
    sha256: fingerprint,
    generatedAt: new Date().toISOString(),
    templateTokenCount: agreementTokens.length,
    renderMode: "skeleton",
  };
}

export function resolveAgreementTemplatePath() {
  return env.AGREEMENT_TEMPLATE_DOCX_PATH
    ? path.resolve(env.AGREEMENT_TEMPLATE_DOCX_PATH)
    : path.resolve(process.cwd(), "..", "Tonka_Time_Weekend_Rental_Agreement_Template.docx");
}

function resolveAgreementStorageRoot() {
  return env.AGREEMENT_PRIVATE_STORAGE_DIR
    ? path.resolve(env.AGREEMENT_PRIVATE_STORAGE_DIR)
    : path.resolve(process.cwd(), "tmp", "agreements");
}
