import { buildAgreementAnchorWidgetRects } from "./agreement-anchor-widgets.js";
import type { GeneratedAgreement } from "./agreement-renderer.js";

export const openSignWidgetAdapterVersion = "a5-1";

export type OpenSignPlaceholderSummary = {
  name: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function buildOpenSignDocumentPlaceholders(options: {
  templatePlaceholders: unknown[] | null;
  contactId: string;
  placeholderValues: Map<string, string>;
  generatedAgreement: GeneratedAgreement;
}) {
  const templateEntries = Array.isArray(options.templatePlaceholders) ? options.templatePlaceholders : [];
  const anchorPlaceholders = buildAnchorDrivenSignPlaceholders(
    templateEntries,
    options.contactId,
    options.generatedAgreement,
  );

  const textPlaceholders = templateEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }

    const updated = { ...(entry as Record<string, unknown>) };
    updated.signerPtr = {
      __type: "Pointer",
      className: "contracts_Contactbook",
      objectId: options.contactId,
    };
    updated.SignerPtr = updated.signerPtr;
    updated.signerObjId = options.contactId;
    updated.SignerObjId = options.contactId;
    const key = firstString([
      getNestedString(updated, ["Name"]),
      getNestedString(updated, ["name"]),
      getNestedString(updated, ["key"]),
      getNestedString(updated, ["Key"]),
    ]);

    if (!key) {
      return updated;
    }

    const normalized = key.toLowerCase();
    const nextValue = options.placeholderValues.get(normalized);
    if (nextValue == null) {
      return updated;
    }

    updated.text = nextValue;
    updated.Text = nextValue;
    updated.value = nextValue;
    updated.Value = nextValue;
    updated.defaultValue = nextValue;
    updated.DefaultValue = nextValue;
    return updated;
  });

  if (anchorPlaceholders.length === 0) {
    return textPlaceholders;
  }

  return [
    ...textPlaceholders.filter((entry) => !entryMatchesSignPlaceholder(entry)),
    ...anchorPlaceholders,
  ];
}

export function summarizeOpenSignSubmittedWidgets(generatedAgreement: GeneratedAgreement): OpenSignPlaceholderSummary[] {
  return generatedAgreement.widgetRects.map((rect) => ({
    name: rect.name,
    type: rect.type,
    page: rect.page,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }));
}

export function buildOpenSignDirectSignerPlaceholders(options: {
  contactId: string;
  generatedAgreement: GeneratedAgreement;
  role?: string;
}) {
  const widgetRects = buildAgreementAnchorWidgetRects(options.generatedAgreement.pdfAnchorLocateResult);
  if (widgetRects.length === 0) {
    return [];
  }

  const signerPtr = {
    __type: "Pointer",
    className: "contracts_Contactbook",
    objectId: options.contactId,
  };

  const placeholderItems = widgetRects.map((rect) => buildDirectPlaceholderItem(rect));

  return [
    {
      Role: options.role ?? "Customer",
      role: options.role ?? "Customer",
      signerPtr,
      SignerPtr: signerPtr,
      signerObjId: options.contactId,
      SignerObjId: options.contactId,
      placeHolder: placeholderItems,
      placeholder: placeholderItems,
      PlaceHolder: placeholderItems,
    },
  ];
}

function buildAnchorDrivenSignPlaceholders(
  templateEntries: unknown[],
  contactId: string,
  generatedAgreement: GeneratedAgreement,
) {
  const widgetRects = buildAgreementAnchorWidgetRects(generatedAgreement.pdfAnchorLocateResult);
  if (widgetRects.length === 0) {
    return [];
  }

  const signerEntry = templateEntries.find(entryMatchesSignPlaceholder);
  if (!signerEntry || typeof signerEntry !== "object" || Array.isArray(signerEntry)) {
    return [];
  }

  const placeholderItems =
    getNestedArray(signerEntry, ["placeHolder"]) ??
    getNestedArray(signerEntry, ["PlaceHolder"]) ??
    getNestedArray(signerEntry, ["placeholder"]) ??
    [];

  const prototypes = {
    initials: findPlaceholderItemPrototype(placeholderItems, "initials"),
    signature: findPlaceholderItemPrototype(placeholderItems, "signature"),
    date: findPlaceholderItemPrototype(placeholderItems, "date"),
  };

  if (!prototypes.initials || !prototypes.signature || !prototypes.date) {
    return [];
  }

  const updated = { ...(signerEntry as Record<string, unknown>) };
  updated.signerPtr = {
    __type: "Pointer",
    className: "contracts_Contactbook",
    objectId: contactId,
  };
  updated.SignerPtr = updated.signerPtr;
  updated.signerObjId = contactId;
  updated.SignerObjId = contactId;
  updated.placeHolder = widgetRects.map((rect) => {
    const prototype = prototypes[rect.type];
    return clonePlaceholderItemForRect(prototype!, rect);
  });
  updated.placeholder = updated.placeHolder;
  updated.PlaceHolder = updated.placeHolder;
  return [updated];
}

function entryMatchesSignPlaceholder(entry: unknown) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }

  const role = firstString([
    getNestedString(entry, ["Role"]),
    getNestedString(entry, ["role"]),
  ]);
  if (role && role.toLowerCase() === "customer") {
    return true;
  }

  const items =
    getNestedArray(entry, ["placeHolder"]) ??
    getNestedArray(entry, ["PlaceHolder"]) ??
    getNestedArray(entry, ["placeholder"]) ??
    [];

  return Array.isArray(items) && items.some((item) => isSignPlaceholderItem(item));
}

function findPlaceholderItemPrototype(items: unknown[], type: "initials" | "signature" | "date") {
  return items.find((item) => placeholderItemMatchesType(item, type));
}

function isSignPlaceholderItem(item: unknown) {
  return ["initials", "signature", "date"].some((type) => placeholderItemMatchesType(item, type));
}

function placeholderItemMatchesType(item: unknown, type: string) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }

  const positions = getNestedArray(item, ["pos"]) ?? getNestedArray(item, ["Pos"]) ?? [];
  return positions.some((position) => {
    const positionType = firstString([
      getNestedString(position, ["type"]),
      getNestedString(position, ["Type"]),
    ]);
    return positionType?.toLowerCase() === type;
  });
}

function clonePlaceholderItemForRect(
  prototype: unknown,
  rect: ReturnType<typeof buildAgreementAnchorWidgetRects>[number],
) {
  const cloned = stripPlaceholderIdentifiers(cloneJsonRecord(prototype));
  const positions = getNestedArray(cloned, ["pos"]) ?? getNestedArray(cloned, ["Pos"]) ?? [];
  const positionTemplate =
    Array.isArray(positions) && positions.length > 0 && positions[0] && typeof positions[0] === "object"
      ? stripPlaceholderIdentifiers(cloneJsonRecord(positions[0]))
      : {};
  const rawOptions =
    (typeof positionTemplate.options === "object" && positionTemplate.options && !Array.isArray(positionTemplate.options))
      ? positionTemplate.options as Record<string, unknown>
      : (typeof positionTemplate.Options === "object" && positionTemplate.Options && !Array.isArray(positionTemplate.Options))
        ? positionTemplate.Options as Record<string, unknown>
        : {};
  const options = stripPlaceholderIdentifiers(cloneJsonRecord(rawOptions));
  options.name = rect.name;
  options.Name = rect.name;
  options.required = true;
  options.Required = true;
  options.value = "";
  options.Value = "";
  positionTemplate.options = options;
  positionTemplate.Options = options;
  positionTemplate.name = rect.name;
  positionTemplate.Name = rect.name;
  positionTemplate.type = rect.type;
  positionTemplate.Type = rect.type;
  setNumericField(positionTemplate, ["xPosition", "XPosition", "x"], rect.x);
  setNumericField(positionTemplate, ["yPosition", "YPosition", "y"], rect.y);
  setNumericField(positionTemplate, ["Width", "width", "w"], rect.width);
  setNumericField(positionTemplate, ["Height", "height", "h"], rect.height);
  setNumericField(positionTemplate, ["pageNumber", "PageNumber", "page", "Page"], rect.page);
  cloned.type = rect.type;
  cloned.Type = rect.type;
  cloned.pos = [positionTemplate];
  cloned.Pos = [positionTemplate];
  return cloned;
}

function buildDirectPlaceholderItem(
  rect: ReturnType<typeof buildAgreementAnchorWidgetRects>[number],
) {
  const position = {
    type: rect.type,
    Type: rect.type,
    xPosition: rect.x,
    XPosition: rect.x,
    yPosition: rect.y,
    YPosition: rect.y,
    Width: rect.width,
    width: rect.width,
    Height: rect.height,
    height: rect.height,
    pageNumber: rect.page,
    PageNumber: rect.page,
    options: {
      name: rect.name,
      Name: rect.name,
      required: true,
      Required: true,
      value: "",
      Value: "",
    },
  };

  return {
    type: rect.type,
    Type: rect.type,
    pageNumber: rect.page,
    PageNumber: rect.page,
    pos: [position],
    Pos: [position],
  };
}

function setNumericField(target: Record<string, unknown>, keys: string[], value: number) {
  for (const key of keys) {
    target[key] = value;
  }
}

function stripPlaceholderIdentifiers(target: Record<string, unknown>) {
  for (const key of [
    "id",
    "Id",
    "objectId",
    "createdAt",
    "updatedAt",
    "CreatedAt",
    "UpdatedAt",
    "key",
    "Key",
    "uuid",
    "UUID",
  ]) {
    delete target[key];
  }

  return target;
}

function cloneJsonRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function getNestedString(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function getNestedArray(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return Array.isArray(current) ? current : null;
}

function firstString(values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? null;
}
