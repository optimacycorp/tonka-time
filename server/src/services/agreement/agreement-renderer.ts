import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { env } from "../../lib/config.js";
import { buildAgreementData, type ReservationAgreementSource } from "./agreement-data.js";
import { buildAgreementAnchorWidgetRects, type AgreementAnchorWidgetRect } from "./agreement-anchor-widgets.js";
import { agreementTokens, findUnresolvedAgreementTokens } from "./agreement-tokens.js";
import {
  type AgreementAnchorValidation,
  validateAgreementAnchors,
} from "./agreement-anchors.js";
import { locateAgreementAnchorsInPdf, type AgreementAnchorLocateResult } from "./agreement-anchor-locator.js";
import { ensureAgreementPdfArtifactsScript, type AgreementPdfArtifactsPayload } from "./agreement-pdf-artifacts.js";

export type GeneratedAgreement = {
  reservationId: string;
  templatePath: string;
  templateVersion: string;
  templateSha256: string;
  layoutVersion: string;
  outputDirectory: string;
  outputDocxPath: string;
  outputPdfPath: string;
  outputMaskedPdfPath: string;
  outputDebugPdfPath: string;
  outputAnchorDataPath: string;
  outputDataPath: string;
  sha256: string;
  generatedAt: string;
  templateTokenCount: number;
  replacedTokenCount: number;
  unresolvedTokens: string[];
  sourceAnchorValidation: AgreementAnchorValidation;
  renderedAnchorValidation: AgreementAnchorValidation;
  pdfAnchorLocateResult: AgreementAnchorLocateResult;
  widgetRects: AgreementAnchorWidgetRect[];
  pdfPageCount: number;
  renderMode: "docx_pdf";
};

export async function renderUnsignedAgreement(
  reservation: ReservationAgreementSource,
  options?: { force?: boolean },
): Promise<GeneratedAgreement> {
  const templatePath = resolveAgreementTemplatePath();
  await access(templatePath);

  const templateBuffer = await readFile(templatePath);
  const templateSha256 = createHash("sha256").update(templateBuffer).digest("hex");
  const templateVersion = buildAgreementTemplateVersion(templatePath, templateSha256);
  const agreementData = buildAgreementData(reservation);
  const outputDirectory = path.join(resolveAgreementStorageRoot(), reservation.publicId);
  await mkdir(outputDirectory, { recursive: true });
  const outputDocxPath = path.join(outputDirectory, `${reservation.publicId}-unsigned.docx`);
  const outputPdfPath = path.join(outputDirectory, `${reservation.publicId}-unsigned.pdf`);
  const outputMaskedPdfPath = path.join(outputDirectory, `${reservation.publicId}-unsigned-masked.pdf`);
  const outputDebugPdfPath = path.join(outputDirectory, `${reservation.publicId}-unsigned-debug.pdf`);
  const outputAnchorDataPath = path.join(outputDirectory, `${reservation.publicId}-anchor-layout.json`);
  const outputDataPath = path.join(outputDirectory, `${reservation.publicId}-agreement-data.json`);

  const fingerprint = createHash("sha256")
    .update(templateBuffer)
    .update(JSON.stringify({ agreementData, force: options?.force === true }))
    .digest("hex");
  const sourceXmlTexts = await readDocxXmlTexts(templatePath);
  const sourceAnchorValidation = validateAgreementAnchors(sourceXmlTexts);

  await writeFile(outputDataPath, JSON.stringify(agreementData, null, 2), "utf8");
  await renderAgreementDocx({
    templatePath,
    outputDocxPath,
    outputDataPath,
  });
  const unresolvedTokens = await scanDocxForUnresolvedTokens(outputDocxPath);
  if (unresolvedTokens.length > 0) {
    throw new Error(`Agreement render left unresolved placeholders: ${unresolvedTokens.join(", ")}`);
  }
  const renderedXmlTexts = await readDocxXmlTexts(outputDocxPath);
  const renderedAnchorValidation = validateAgreementAnchors(renderedXmlTexts);
  if (env.AGREEMENT_REQUIRE_ANCHORS && !renderedAnchorValidation.valid) {
    throw new Error(
      `Agreement anchor validation failed. Missing: ${renderedAnchorValidation.missingAnchors.join(", ") || "none"}. ` +
      `Duplicates: ${renderedAnchorValidation.duplicateAnchors.join(", ") || "none"}. ` +
      `Unexpected: ${renderedAnchorValidation.unexpectedAnchors.join(", ") || "none"}.`,
    );
  }

  await convertDocxToPdf(outputDocxPath, outputPdfPath);
  const pdfPageCount = await countPdfPages(outputPdfPath);
  if (pdfPageCount <= 0) {
    throw new Error("Rendered agreement PDF did not contain any pages.");
  }
  const pdfAnchorLocateResult = await locateAgreementAnchorsInPdf(outputPdfPath, {
    requireAnchors: env.AGREEMENT_REQUIRE_ANCHORS === true,
  });
  if (env.AGREEMENT_REQUIRE_ANCHORS && pdfAnchorLocateResult.status !== "located") {
    throw new Error(
      `Agreement PDF anchor location failed. Missing: ${pdfAnchorLocateResult.missingAnchors.join(", ") || "none"}. ` +
      `Duplicates: ${pdfAnchorLocateResult.duplicateAnchors.join(", ") || "none"}. ` +
      `Unexpected: ${pdfAnchorLocateResult.unexpectedAnchors.join(", ") || "none"}.`,
    );
  }
  const widgetRects = buildAgreementAnchorWidgetRects(pdfAnchorLocateResult);
  await generateAgreementPdfArtifacts({
    reservationPublicId: reservation.publicId,
    outputPdfPath,
    outputMaskedPdfPath,
    outputDebugPdfPath,
    outputAnchorDataPath,
    pdfAnchorLocateResult,
    widgetRects,
  });

  return {
    reservationId: reservation.id,
    templatePath,
    templateVersion,
    templateSha256,
    layoutVersion: pdfAnchorLocateResult.layoutVersion,
    outputDirectory,
    outputDocxPath,
    outputPdfPath,
    outputMaskedPdfPath,
    outputDebugPdfPath,
    outputAnchorDataPath,
    outputDataPath,
    sha256: fingerprint,
    generatedAt: new Date().toISOString(),
    templateTokenCount: agreementTokens.length,
    replacedTokenCount: agreementTokens.length,
    unresolvedTokens,
    sourceAnchorValidation,
    renderedAnchorValidation,
    pdfAnchorLocateResult,
    widgetRects,
    pdfPageCount,
    renderMode: "docx_pdf",
  };
}

function buildAgreementTemplateVersion(templatePath: string, templateSha256: string) {
  return `${path.basename(templatePath)}:${templateSha256.slice(0, 12)}`;
}

export function resolveAgreementTemplatePath() {
  return env.AGREEMENT_TEMPLATE_DOCX_PATH
    ? path.resolve(env.AGREEMENT_TEMPLATE_DOCX_PATH)
    : path.resolve(process.cwd(), "..", "docs", "Tonka_Time_Weekend_Rental_Agreement_Template.docx");
}

function resolveAgreementStorageRoot() {
  return env.AGREEMENT_PRIVATE_STORAGE_DIR
    ? path.resolve(env.AGREEMENT_PRIVATE_STORAGE_DIR)
    : path.resolve(process.cwd(), "tmp", "agreements");
}

async function renderAgreementDocx(options: {
  templatePath: string;
  outputDocxPath: string;
  outputDataPath: string;
}) {
  const scriptPath = path.resolve(process.cwd(), "scripts", "render_agreement_docx.py");
  await access(scriptPath);
  await runCommand(resolvePythonCommand(), [
    scriptPath,
    options.templatePath,
    options.outputDocxPath,
    options.outputDataPath,
  ]);
  await access(options.outputDocxPath);
}

async function scanDocxForUnresolvedTokens(docxPath: string) {
  const xmlTexts = await readDocxXmlTexts(docxPath);
  const unresolved = new Set<string>();
  for (const xml of xmlTexts) {
    for (const token of findUnresolvedAgreementTokens(xml)) {
      unresolved.add(token);
    }
  }

  return [...unresolved].sort();
}

async function readDocxXmlTexts(docxPath: string) {
  const inspectionDirectory = path.join(path.dirname(docxPath), ".inspection");
  const extractedDirectory = path.join(inspectionDirectory, path.basename(docxPath, ".docx"));
  await mkdir(extractedDirectory, { recursive: true });
  await unzipDocx(docxPath, extractedDirectory);

  const xmlTargets = [
    path.join(extractedDirectory, "word", "document.xml"),
    path.join(extractedDirectory, "word", "header1.xml"),
    path.join(extractedDirectory, "word", "header2.xml"),
    path.join(extractedDirectory, "word", "header3.xml"),
    path.join(extractedDirectory, "word", "footer1.xml"),
    path.join(extractedDirectory, "word", "footer2.xml"),
    path.join(extractedDirectory, "word", "footer3.xml"),
    path.join(extractedDirectory, "word", "footnotes.xml"),
    path.join(extractedDirectory, "word", "endnotes.xml"),
  ];

  const xmlTexts: string[] = [];
  for (const xmlPath of xmlTargets) {
    try {
      xmlTexts.push(await readFile(xmlPath, "utf8"));
    } catch {
      // Ignore optional XML parts that do not exist in this template.
    }
  }

  return xmlTexts;
}

async function convertDocxToPdf(inputDocxPath: string, outputPdfPath: string) {
  const outputDirectory = path.dirname(outputPdfPath);
  await mkdir(outputDirectory, { recursive: true });

  if (process.platform === "win32" && env.AGREEMENT_PDF_CONVERTER !== "soffice") {
    await convertDocxToPdfWithWord(inputDocxPath, outputPdfPath);
    return;
  }

  await convertDocxToPdfWithSoffice(inputDocxPath, outputDirectory);
  const sofficePdfPath = path.join(outputDirectory, `${path.basename(inputDocxPath, ".docx")}.pdf`);
  if (sofficePdfPath !== outputPdfPath) {
    await copyFile(sofficePdfPath, outputPdfPath);
  }
}

async function convertDocxToPdfWithSoffice(inputDocxPath: string, outputDirectory: string) {
  const officeBin = env.AGREEMENT_OFFICE_BIN || "soffice";
  await runCommand(officeBin, [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDirectory,
    inputDocxPath,
  ]);
}

async function convertDocxToPdfWithWord(inputDocxPath: string, outputPdfPath: string) {
  const officeBin = env.AGREEMENT_OFFICE_BIN || "WINWORD.EXE";
  const powershell = [
    "$word = New-Object -ComObject Word.Application",
    "$word.Visible = $false",
    `$doc = $word.Documents.Open('${escapePowerShellString(inputDocxPath)}')`,
    `$doc.SaveAs([ref]'${escapePowerShellString(outputPdfPath)}', [ref]17)`,
    "$doc.Close()",
    "$word.Quit()",
  ].join("; ");

  if (officeBin.toUpperCase().endsWith("WINWORD.EXE")) {
    await runCommand("powershell.exe", ["-NoProfile", "-Command", powershell]);
    return;
  }

  await runCommand(officeBin, ["/mFilePrintDefault", inputDocxPath]);
  await access(outputPdfPath);
}

async function countPdfPages(pdfPath: string) {
  const script = path.resolve(process.cwd(), "scripts", "count_pdf_pages.py");
  await access(script);
  const output = await runCommand(resolvePythonCommand(), [script, pdfPath]);
  const parsed = Number.parseInt(output.trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not determine PDF page count for ${pdfPath}`);
  }
  return parsed;
}

async function unzipDocx(docxPath: string, outputDirectory: string) {
  const script = path.resolve(process.cwd(), "scripts", "unzip_docx.py");
  await access(script);
  await runCommand(resolvePythonCommand(), [script, docxPath, outputDirectory]);
}

async function generateAgreementPdfArtifacts(options: {
  reservationPublicId: string;
  outputPdfPath: string;
  outputMaskedPdfPath: string;
  outputDebugPdfPath: string;
  outputAnchorDataPath: string;
  pdfAnchorLocateResult: AgreementAnchorLocateResult;
  widgetRects: AgreementAnchorWidgetRect[];
}) {
  const script = await ensureAgreementPdfArtifactsScript();
  const payload: AgreementPdfArtifactsPayload = {
    layoutVersion: options.pdfAnchorLocateResult.layoutVersion,
    reservationPublicId: options.reservationPublicId,
    generatedAt: new Date().toISOString(),
    sourcePdfPath: options.outputPdfPath,
    maskedPdfPath: options.outputMaskedPdfPath,
    debugPdfPath: options.outputDebugPdfPath,
    anchorLocations: options.pdfAnchorLocateResult.locations,
    widgetRects: options.widgetRects,
  };
  await writeFile(options.outputAnchorDataPath, JSON.stringify(payload, null, 2), "utf8");
  await runCommand(resolvePythonCommand(), [script, options.outputAnchorDataPath]);
  await access(options.outputMaskedPdfPath);
  await access(options.outputDebugPdfPath);
}

function resolvePythonCommand() {
  return env.AGREEMENT_OFFICE_BIN && env.AGREEMENT_OFFICE_BIN.toLowerCase().includes("python")
    ? env.AGREEMENT_OFFICE_BIN
    : process.platform === "win32"
      ? "python"
      : "python3";
}

function escapePowerShellString(value: string) {
  return value.replace(/'/g, "''");
}

async function runCommand(command: string, args: string[]) {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${env.AGREEMENT_RENDER_TIMEOUT_MS}ms: ${command}`));
    }, env.AGREEMENT_RENDER_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`Command failed (${command} ${args.join(" ")}): ${stderr || stdout || `exit code ${code}`}`));
    });
  });

  return output;
}
