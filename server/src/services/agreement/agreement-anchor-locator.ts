import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  agreementAnchors,
  type AgreementAnchor,
  agreementAnchorLayoutVersion,
} from "./agreement-anchors.js";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

export type AgreementAnchorLocation = {
  anchor: AgreementAnchor;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  matchedText: string;
  sourceItemCount: number;
};

export type AgreementAnchorLocateResult = {
  layoutVersion: string;
  status: "located" | "skipped" | "missing";
  pageCount: number;
  locations: Partial<Record<AgreementAnchor, AgreementAnchorLocation>>;
  missingAnchors: AgreementAnchor[];
  duplicateAnchors: AgreementAnchor[];
  unexpectedAnchors: string[];
  debug: {
    pageTextSamples: Array<{
      page: number;
      sample: string;
    }>;
  };
};

type PageTextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const MAX_WINDOW_ITEMS = 16;

export async function locateAgreementAnchorsInPdf(
  pdfPath: string,
  options?: { requireAnchors?: boolean },
): Promise<AgreementAnchorLocateResult> {
  const bytes = await readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageTextSamples: AgreementAnchorLocateResult["debug"]["pageTextSamples"] = [];
  const found = new Map<AgreementAnchor, AgreementAnchorLocation[]>();
  const unexpectedAnchors = new Set<string>();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items.flatMap((item) => (isPdfTextItem(item) ? [toPageTextRun(item as PdfTextItem)] : []));
    items.sort(compareRuns);
    const pageText = items.map((item) => item.text).join("");
    pageTextSamples.push({
      page: pageNumber,
      sample: pageText.slice(0, 500),
    });

    for (const anchor of agreementAnchors) {
      const locations = locateAnchorInRuns(anchor, items, pageNumber);
      if (locations.length > 0) {
        found.set(anchor, [...(found.get(anchor) ?? []), ...locations]);
      }
    }

    for (const rawAnchor of pageText.matchAll(/\[\[\s*(OS_[A-Z0-9_]+)\s*\]\]/g)) {
      const value = rawAnchor[1];
      if (!agreementAnchors.includes(value as AgreementAnchor)) {
        unexpectedAnchors.add(value);
      }
    }
  }

  const locations: Partial<Record<AgreementAnchor, AgreementAnchorLocation>> = {};
  const missingAnchors: AgreementAnchor[] = [];
  const duplicateAnchors: AgreementAnchor[] = [];

  for (const anchor of agreementAnchors) {
    const matches = found.get(anchor) ?? [];
    if (matches.length === 0) {
      missingAnchors.push(anchor);
      continue;
    }
    if (matches.length > 1) {
      duplicateAnchors.push(anchor);
    }
    locations[anchor] = matches[0];
  }

  const shouldRequire = options?.requireAnchors === true;
  const status =
    missingAnchors.length === 0 && duplicateAnchors.length === 0 && unexpectedAnchors.size === 0
      ? "located"
      : shouldRequire
        ? "missing"
        : "skipped";

  return {
    layoutVersion: agreementAnchorLayoutVersion,
    status,
    pageCount: pdf.numPages,
    locations,
    missingAnchors,
    duplicateAnchors,
    unexpectedAnchors: [...unexpectedAnchors].sort(),
    debug: {
      pageTextSamples,
    },
  };
}

function locateAnchorInRuns(anchor: AgreementAnchor, runs: PageTextRun[], page: number) {
  const target = `[[${anchor}]]`;
  const located: AgreementAnchorLocation[] = [];

  for (let start = 0; start < runs.length; start += 1) {
    let combined = "";
    const consumed: PageTextRun[] = [];

    for (let cursor = start; cursor < runs.length && cursor < start + MAX_WINDOW_ITEMS; cursor += 1) {
      const run = runs[cursor];
      combined += run.text;
      consumed.push(run);

      if (normalizeAnchorText(combined).includes(target)) {
        const clipped = clipRunsToAnchor(consumed, target);
        if (clipped) {
          const clippedRuns = clipped.runs;
          const bounds = unionRuns(clippedRuns);
          located.push({
            anchor,
            page,
            ...bounds,
            matchedText: combined,
            sourceItemCount: clippedRuns.length,
          });
        }
        break;
      }

      if (!couldStillContainAnchor(combined, target)) {
        break;
      }
    }
  }

  return dedupeLocations(located);
}

function couldStillContainAnchor(text: string, target: string) {
  const normalized = normalizeAnchorText(text);
  const anchorStart = normalized.indexOf("[[");
  if (anchorStart >= 0) {
    return target.startsWith(normalized.slice(anchorStart));
  }

  return normalized.length < target.length + 64;
}

function dedupeLocations(locations: AgreementAnchorLocation[]) {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = [
      location.anchor,
      location.page,
      location.x.toFixed(2),
      location.y.toFixed(2),
      location.width.toFixed(2),
      location.height.toFixed(2),
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeAnchorText(text: string) {
  return text.replace(/\s+/g, "");
}

function unionRuns(runs: PageTextRun[]) {
  const left = Math.min(...runs.map((run) => run.x));
  const top = Math.min(...runs.map((run) => run.y));
  const right = Math.max(...runs.map((run) => run.x + run.width));
  const bottom = Math.max(...runs.map((run) => run.y + run.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function clipRunsToAnchor(runs: PageTextRun[], target: string) {
  const normalizedRuns = runs.map((run) => ({
    run,
    normalizedText: normalizeAnchorText(run.text),
  }));
  const normalized = normalizedRuns.map((entry) => entry.normalizedText).join("");
  const anchorStart = normalized.indexOf(target);
  if (anchorStart < 0) {
    return null;
  }

  const anchorEnd = anchorStart + target.length;
  const clippedRuns: PageTextRun[] = [];
  let offset = 0;

  for (const entry of normalizedRuns) {
    const segmentStart = offset;
    const segmentEnd = offset + entry.normalizedText.length;
    offset = segmentEnd;

    if (entry.normalizedText.length === 0 || segmentEnd <= anchorStart || segmentStart >= anchorEnd) {
      continue;
    }

    const localStart = Math.max(0, anchorStart - segmentStart);
    const localEnd = Math.min(entry.normalizedText.length, anchorEnd - segmentStart);
    const startRatio = localStart / entry.normalizedText.length;
    const endRatio = localEnd / entry.normalizedText.length;
    const clippedWidth = entry.run.width * (endRatio - startRatio);

    clippedRuns.push({
      text: target,
      x: entry.run.x + entry.run.width * startRatio,
      y: entry.run.y,
      width: clippedWidth,
      height: entry.run.height,
    });
  }

  if (clippedRuns.length === 0) {
    return null;
  }

  return { runs: clippedRuns };
}

function compareRuns(left: PageTextRun, right: PageTextRun) {
  if (Math.abs(left.y - right.y) > 3) {
    return left.y - right.y;
  }
  return left.x - right.x;
}

function isPdfTextItem(item: unknown) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }

  const candidate = item as Partial<PdfTextItem>;
  return (
    typeof candidate.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function toPageTextRun(item: PdfTextItem): PageTextRun {
  const x = item.transform[4] ?? 0;
  const baselineY = item.transform[5] ?? 0;
  const height = item.height || Math.abs(item.transform[3] ?? 0);
  return {
    text: item.str,
    x,
    y: Math.max(0, baselineY - height),
    width: item.width,
    height,
  };
}
