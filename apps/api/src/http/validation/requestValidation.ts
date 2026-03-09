import { HttpError } from "../errors/httpError.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_USER_EMAIL_LENGTH = 320;

export function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEmail(value: unknown): string | HttpError {
  const email = typeof value === "string" ? value.trim() : "";

  if (!email) {
    return new HttpError(400, "email is required");
  }

  if (email.length > MAX_USER_EMAIL_LENGTH) {
    return new HttpError(
      400,
      `email must be at most ${MAX_USER_EMAIL_LENGTH} characters`,
    );
  }

  if (!isValidEmailAddress(email)) {
    return new HttpError(400, "email must be a valid email address");
  }

  return email;
}

export function parseRequiredTrimmedString(
  value: string | string[] | undefined,
  name: string,
): string | HttpError {
  if (typeof value !== "string") {
    return new HttpError(400, `${name} is required`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return new HttpError(400, `${name} is required`);
  }

  return trimmed;
}

export function parseUuidParam(
  value: string | string[] | undefined,
  name: string,
): string | HttpError {
  const trimmed = parseRequiredTrimmedString(value, name);

  if (trimmed instanceof HttpError) {
    return trimmed;
  }

  if (!UUID_PATTERN.test(trimmed)) {
    return new HttpError(400, `${name} must be a valid UUID`);
  }

  return trimmed;
}

function isValidEmailAddress(email: string): boolean {
  if (/\s/.test(email)) {
    return false;
  }

  const parts = email.split("@");

  if (parts.length !== 2) {
    return false;
  }

  const [localPart, domain] = parts;

  if (!localPart || !domain) {
    return false;
  }

  if (
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..")
  ) {
    return false;
  }

  const domainLabels = domain.split(".");

  return (
    domainLabels.length >= 2 && domainLabels.every((label) => label.length > 0)
  );
}
