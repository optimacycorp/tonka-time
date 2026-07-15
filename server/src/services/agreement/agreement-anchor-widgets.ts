import {
  agreementAnchors,
  agreementAnchorSpecs,
  type AgreementAnchor,
  type AgreementAnchorWidgetType,
} from "./agreement-anchors.js";
import type { AgreementAnchorLocateResult } from "./agreement-anchor-locator.js";

export type AgreementAnchorWidgetRect = {
  anchor: AgreementAnchor;
  name: string;
  type: AgreementAnchorWidgetType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function buildAgreementAnchorWidgetRects(result: AgreementAnchorLocateResult) {
  const rects: AgreementAnchorWidgetRect[] = [];

  for (const anchor of agreementAnchors) {
    const location = result.locations[anchor];
    if (!location) {
      continue;
    }

    const spec = agreementAnchorSpecs[anchor];
    rects.push({
      anchor,
      name: spec.widgetName,
      type: spec.widgetType,
      page: location.page,
      x: round2(location.x + spec.xOffset),
      y: round2(location.y + spec.yOffset),
      width: round2(spec.width),
      height: round2(spec.height),
    });
  }

  return rects;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
