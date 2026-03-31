import type {
  ClientDocumentUpdateEvent,
  WorkspaceErrorEvent,
  WorkspaceJoinRequest,
} from "@collab-tex/shared";

export function parseWorkspaceJoinRequest(
  value: unknown,
): WorkspaceJoinRequest | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "workspace:join payload must be an object",
    };
  }

  const projectId =
    typeof value.projectId === "string" ? value.projectId.trim() : "";
  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";

  if (!projectId) {
    return {
      code: "INVALID_REQUEST",
      message: "projectId is required",
    };
  }

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  const awarenessClientID =
    typeof value.awarenessClientID === "number"
      ? value.awarenessClientID
      : undefined;

  return { projectId, documentId, awarenessClientID };
}

export type ParsedDocumentUpdateRequest = ClientDocumentUpdateEvent & {
  update: Uint8Array;
};

export function parseDocumentUpdateRequest(
  value: unknown,
): ParsedDocumentUpdateRequest | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "doc.update payload must be an object",
    };
  }

  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";
  const updateB64 =
    typeof value.updateB64 === "string" ? value.updateB64.trim() : "";
  const clientUpdateId =
    typeof value.clientUpdateId === "string" ? value.clientUpdateId.trim() : "";

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  if (!updateB64) {
    return {
      code: "INVALID_REQUEST",
      message: "updateB64 is required",
    };
  }

  if (!clientUpdateId) {
    return {
      code: "INVALID_REQUEST",
      message: "clientUpdateId is required",
    };
  }

  try {
    return {
      documentId,
      updateB64,
      clientUpdateId,
      update: decodeBase64Update(updateB64),
    };
  } catch {
    return {
      code: "INVALID_REQUEST",
      message: "updateB64 must be a valid base64-encoded Yjs update",
    };
  }
}

function decodeBase64Update(value: string): Uint8Array {
  if (!isStrictBase64(value)) {
    throw new Error("Invalid base64");
  }

  return Buffer.from(value, "base64");
}

function isStrictBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0
    ? /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    : false;
}

export function parseSyncRequest(
  value: unknown,
): { documentId: string } | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "doc.sync.request payload must be an object",
    };
  }

  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  return { documentId };
}

const MAX_AWARENESS_B64_LENGTH = 8192;

export function parsePresenceUpdateRequest(
  value: unknown,
): { documentId: string; awarenessB64: string } | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "presence.update payload must be an object",
    };
  }

  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";
  const awarenessB64 =
    typeof value.awarenessB64 === "string" ? value.awarenessB64.trim() : "";

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  if (!awarenessB64) {
    return {
      code: "INVALID_REQUEST",
      message: "awarenessB64 is required",
    };
  }

  if (awarenessB64.length > MAX_AWARENESS_B64_LENGTH) {
    return {
      code: "INVALID_REQUEST",
      message: `awarenessB64 exceeds maximum length of ${MAX_AWARENESS_B64_LENGTH}`,
    };
  }

  if (!isStrictBase64(awarenessB64)) {
    return {
      code: "INVALID_REQUEST",
      message: "awarenessB64 must be valid base64",
    };
  }

  return { documentId, awarenessB64 };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
