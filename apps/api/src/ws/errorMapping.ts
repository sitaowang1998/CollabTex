import type { WorkspaceErrorEvent } from "@collab-tex/shared";
import { ActiveDocumentSessionInvalidatedError } from "../services/activeDocumentRegistry.js";
import { ActiveDocumentStateDocumentNotFoundError } from "../services/activeDocumentStateLoader.js";
import { InvalidCollaborationUpdateError } from "../services/collaboration.js";
import { DocumentTextStateDocumentNotFoundError } from "../services/currentTextState.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../services/projectAccess.js";
import {
  RealtimeDocumentNotFoundError,
  RealtimeDocumentSessionMismatchError,
} from "../services/realtimeDocument.js";
import {
  WorkspaceAccessDeniedError,
  WorkspaceDocumentNotFoundError,
} from "../services/workspace.js";

export function mapWorkspaceError(error: unknown): WorkspaceErrorEvent {
  if (error instanceof WorkspaceAccessDeniedError) {
    return {
      code: "FORBIDDEN",
      message: "project membership required",
    };
  }

  if (error instanceof WorkspaceDocumentNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: "workspace document not found",
    };
  }

  if (error instanceof ActiveDocumentStateDocumentNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: "workspace document not found",
    };
  }

  return {
    code: "UNAVAILABLE",
    message: "workspace unavailable",
  };
}

export function mapDocumentUpdateError(error: unknown): WorkspaceErrorEvent {
  if (
    error instanceof RealtimeDocumentSessionMismatchError ||
    error instanceof InvalidCollaborationUpdateError ||
    error instanceof ActiveDocumentSessionInvalidatedError
  ) {
    return {
      code: "INVALID_REQUEST",
      message:
        error instanceof RealtimeDocumentSessionMismatchError
          ? "socket is not joined to this document"
          : error instanceof ActiveDocumentSessionInvalidatedError
            ? "socket session is no longer current"
            : "update payload is not a valid Yjs update",
    };
  }

  if (error instanceof ProjectNotFoundError) {
    return {
      code: "FORBIDDEN",
      message: "project membership required",
    };
  }

  if (error instanceof ProjectRoleRequiredError) {
    return {
      code: "FORBIDDEN",
      message: "required project role missing",
    };
  }

  if (
    error instanceof RealtimeDocumentNotFoundError ||
    error instanceof DocumentTextStateDocumentNotFoundError
  ) {
    return {
      code: "NOT_FOUND",
      message: "workspace document not found",
    };
  }

  return {
    code: "UNAVAILABLE",
    message: "realtime unavailable",
  };
}

export function mapSyncRequestError(error: unknown): WorkspaceErrorEvent {
  if (
    error instanceof RealtimeDocumentSessionMismatchError ||
    error instanceof ActiveDocumentSessionInvalidatedError
  ) {
    return {
      code: "INVALID_REQUEST",
      message:
        error instanceof RealtimeDocumentSessionMismatchError
          ? "socket is not joined to this document"
          : "socket session is no longer current",
    };
  }

  if (error instanceof ProjectNotFoundError) {
    return {
      code: "FORBIDDEN",
      message: "project membership required",
    };
  }

  if (error instanceof ProjectRoleRequiredError) {
    return {
      code: "FORBIDDEN",
      message: "required project role missing",
    };
  }

  return {
    code: "UNAVAILABLE",
    message: "realtime unavailable",
  };
}

export function isUnexpectedSyncRequestError(error: unknown): boolean {
  return (
    !(error instanceof RealtimeDocumentSessionMismatchError) &&
    !(error instanceof ActiveDocumentSessionInvalidatedError) &&
    !(error instanceof ProjectNotFoundError) &&
    !(error instanceof ProjectRoleRequiredError)
  );
}

export function isUnexpectedWorkspaceError(error: unknown): boolean {
  return (
    !(error instanceof WorkspaceAccessDeniedError) &&
    !(error instanceof WorkspaceDocumentNotFoundError) &&
    !(error instanceof ActiveDocumentStateDocumentNotFoundError)
  );
}

export function isUnexpectedDocumentUpdateError(error: unknown): boolean {
  return (
    !(error instanceof RealtimeDocumentSessionMismatchError) &&
    !(error instanceof InvalidCollaborationUpdateError) &&
    !(error instanceof ActiveDocumentSessionInvalidatedError) &&
    !(error instanceof ProjectNotFoundError) &&
    !(error instanceof ProjectRoleRequiredError) &&
    !(error instanceof RealtimeDocumentNotFoundError) &&
    !(error instanceof DocumentTextStateDocumentNotFoundError)
  );
}

export function shouldSuppressStaleSessionFailure(
  error: unknown,
  input: {
    isCurrentSession: () => boolean;
  },
): boolean {
  if (
    !(error instanceof RealtimeDocumentSessionMismatchError) &&
    !(error instanceof ActiveDocumentSessionInvalidatedError)
  ) {
    return false;
  }

  return !input.isCurrentSession();
}
