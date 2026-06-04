import crypto from "node:crypto";

type ApiKeyFormFieldType = "text" | "textarea" | "tel" | "url" | "file";

type ApiKeyFormField = {
  id: string;
  label: string;
  name: string;
  placeholder: string | null;
  required: boolean;
  type: ApiKeyFormFieldType;
};

type SubmittedCustomField = {
  fieldId: string;
  fileName?: string;
  fileUrl?: string;
  label: string;
  mimeType?: string;
  name: string;
  size?: number;
  type: ApiKeyFormFieldType;
  value?: string;
};

const FORM_FIELD_TYPES = new Set<ApiKeyFormFieldType>([
  "text",
  "textarea",
  "tel",
  "url",
  "file",
]);

const RESERVED_FIELD_NAMES = new Set(["name", "email", "subject", "message"]);

function createFieldId() {
  return crypto.randomUUID();
}

function normalizeFieldName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeFieldLabel(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFieldPlaceholder(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
}

function normalizeFieldType(value: unknown): ApiKeyFormFieldType {
  if (
    typeof value === "string" &&
    FORM_FIELD_TYPES.has(value as ApiKeyFormFieldType)
  ) {
    return value as ApiKeyFormFieldType;
  }

  return "text";
}

function normalizeFieldRequired(value: unknown) {
  return value === true;
}

function normalizeApiKeyFormFields(input: unknown): ApiKeyFormField[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenNames = new Set<string>();
  const normalizedFields: ApiKeyFormField[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const field = item as Record<string, unknown>;
    const label = normalizeFieldLabel(field.label);
    const fallbackName = normalizeFieldName(label);
    const name = normalizeFieldName(
      typeof field.name === "string" ? field.name : fallbackName,
    );

    if (
      !label ||
      !name ||
      RESERVED_FIELD_NAMES.has(name) ||
      seenNames.has(name)
    ) {
      continue;
    }

    seenNames.add(name);

    normalizedFields.push({
      id:
        typeof field.id === "string" && field.id.trim()
          ? field.id.trim()
          : createFieldId(),
      label,
      name,
      placeholder: normalizeFieldPlaceholder(field.placeholder),
      required: normalizeFieldRequired(field.required),
      type: normalizeFieldType(field.type),
    });
  }

  return normalizedFields.slice(0, 12);
}

function readApiKeyFormFields(input: unknown) {
  return normalizeApiKeyFormFields(input);
}

export type { ApiKeyFormField, ApiKeyFormFieldType, SubmittedCustomField };
export { readApiKeyFormFields, normalizeApiKeyFormFields };
