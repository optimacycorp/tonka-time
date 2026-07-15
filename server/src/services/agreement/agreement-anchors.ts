export const agreementAnchorLayoutVersion = "a2";

export const agreementAnchors = [
  "OS_INITIAL_811",
  "OS_INITIAL_TUTORIAL",
  "OS_INITIAL_DAMAGE_WAIVER",
  "OS_SIGNATURE_CUSTOMER",
  "OS_DATE_SIGNED",
] as const;

export type AgreementAnchor = (typeof agreementAnchors)[number];

export type AgreementAnchorWidgetType = "initials" | "signature" | "date";

export type AgreementAnchorSpec = {
  widgetType: AgreementAnchorWidgetType;
  widgetName: string;
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
};

export const agreementAnchorSpecs: Record<AgreementAnchor, AgreementAnchorSpec> = {
  OS_INITIAL_811: {
    widgetType: "initials",
    widgetName: "initials_811",
    xOffset: -34,
    yOffset: -1,
    width: 24,
    height: 14,
  },
  OS_INITIAL_TUTORIAL: {
    widgetType: "initials",
    widgetName: "initials_tutorial",
    xOffset: -34,
    yOffset: -1,
    width: 24,
    height: 14,
  },
  OS_INITIAL_DAMAGE_WAIVER: {
    widgetType: "initials",
    widgetName: "initials_damage_waiver",
    xOffset: -34,
    yOffset: -1,
    width: 24,
    height: 14,
  },
  OS_SIGNATURE_CUSTOMER: {
    widgetType: "signature",
    widgetName: "customer_signature",
    xOffset: -150,
    yOffset: -2,
    width: 140,
    height: 20,
  },
  OS_DATE_SIGNED: {
    widgetType: "date",
    widgetName: "date_signed",
    xOffset: -72,
    yOffset: -2,
    width: 64,
    height: 18,
  },
};

const anchorPattern = /\[\[\s*(OS_[A-Z0-9_]+)\s*\]\]/g;

export type AgreementAnchorValidation = {
  layoutVersion: string;
  expectedAnchors: readonly AgreementAnchor[];
  anchorCounts: Record<string, number>;
  missingAnchors: AgreementAnchor[];
  duplicateAnchors: AgreementAnchor[];
  unexpectedAnchors: string[];
  valid: boolean;
};

export function findAgreementAnchors(text: string) {
  return Array.from(text.matchAll(anchorPattern), (match) => match[1]);
}

export function validateAgreementAnchors(texts: string[]): AgreementAnchorValidation {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const anchor of findAgreementAnchors(text)) {
      counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
    }
  }

  const anchorCounts = Object.fromEntries(
    [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  );

  const missingAnchors = agreementAnchors.filter((anchor) => (counts.get(anchor) ?? 0) === 0);
  const duplicateAnchors = agreementAnchors.filter((anchor) => (counts.get(anchor) ?? 0) > 1);
  const unexpectedAnchors = [...counts.keys()]
    .filter((anchor) => !agreementAnchors.includes(anchor as AgreementAnchor))
    .sort();

  return {
    layoutVersion: agreementAnchorLayoutVersion,
    expectedAnchors: agreementAnchors,
    anchorCounts,
    missingAnchors,
    duplicateAnchors,
    unexpectedAnchors,
    valid: missingAnchors.length === 0 && duplicateAnchors.length === 0 && unexpectedAnchors.length === 0,
  };
}
