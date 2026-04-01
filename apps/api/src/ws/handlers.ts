import type {
  ActiveDocumentRegistry,
  ActiveDocumentSessionHandle,
} from "../services/activeDocumentRegistry.js";
import { ActiveDocumentSessionInvalidatedError } from "../services/activeDocumentRegistry.js";
import type { ProjectAccessService } from "../services/projectAccess.js";
import {
  RealtimeDocumentSessionMismatchError,
  type RealtimeDocumentService,
} from "../services/realtimeDocument.js";
import type { WorkspaceService } from "../services/workspace.js";
import {
  mapWorkspaceError,
  mapDocumentUpdateError,
  mapSyncRequestError,
  isUnexpectedWorkspaceError,
  isUnexpectedDocumentUpdateError,
  isUnexpectedSyncRequestError,
  shouldSuppressStaleSessionFailure,
} from "./errorMapping.js";
import type { ParsedDocumentUpdateRequest } from "./parsers.js";
import {
  createTextWorkspaceRoomName,
  createWorkspaceRoomName,
} from "./roomNames.js";
import {
  joinProjectRoom,
  leaveJoinedRoomIfNeeded,
  leaveJoinedSessionIfNeeded,
  leaveActiveTextSession,
} from "./sessionHelpers.js";
import type { WorkspaceSocket, ActiveTextSessionState } from "./types.js";

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

export async function openWorkspace(
  socket: WorkspaceSocket,
  workspaceService: WorkspaceService,
  input: {
    workspaceOpenInput: {
      userId: string;
      projectId: string;
      documentId: string;
    };
    activeDocumentRegistry: ActiveDocumentRegistry;
    joinSequence: number;
    isLatestJoin: () => boolean;
    getActiveWorkspaceRoomName: () => string | null;
    setActiveWorkspaceRoomName: (roomName: string) => void;
    setActiveDocumentId: (documentId: string | null) => void;
    getActiveProjectRoomName: () => string | null;
    setActiveProjectRoomName: (roomName: string) => void;
    setActiveProjectId: (projectId: string) => void;
    getActiveTextSession: () => ActiveTextSessionState | null;
    swapActiveTextSession: (
      nextSession: ActiveTextSessionState | null,
    ) => ActiveTextSessionState | null;
    revalidateAccess: (projectId: string, userId: string) => Promise<void>;
  },
): Promise<void> {
  while (input.isLatestJoin()) {
    let joinedSessionHandle: ActiveDocumentSessionHandle | null = null;
    let joinedWorkspaceRoomName: string | null = null;

    try {
      const openedWorkspace = await workspaceService.openDocument(
        input.workspaceOpenInput,
      );
      const nextActiveTextSession = openedWorkspace.initialSync
        ? await input.activeDocumentRegistry.join({
            projectId: input.workspaceOpenInput.projectId,
            documentId: input.workspaceOpenInput.documentId,
          })
        : null;

      joinedSessionHandle = nextActiveTextSession;
      const nextWorkspaceRoomName = nextActiveTextSession
        ? createTextWorkspaceRoomName(
            input.workspaceOpenInput.projectId,
            input.workspaceOpenInput.documentId,
            nextActiveTextSession.session.generation,
          )
        : createWorkspaceRoomName(
            input.workspaceOpenInput.projectId,
            input.workspaceOpenInput.documentId,
          );

      if (!input.isLatestJoin()) {
        await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
        return;
      }

      const previousWorkspaceRoomName = input.getActiveWorkspaceRoomName();

      if (
        previousWorkspaceRoomName &&
        previousWorkspaceRoomName !== nextWorkspaceRoomName
      ) {
        await socket.leave(previousWorkspaceRoomName);

        if (!input.isLatestJoin()) {
          await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
          return;
        }
      }

      await socket.join(nextWorkspaceRoomName);
      joinedWorkspaceRoomName = nextWorkspaceRoomName;

      if (!input.isLatestJoin()) {
        await leaveJoinedRoomIfNeeded(socket, input, nextWorkspaceRoomName);
        await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
        return;
      }

      if (nextActiveTextSession) {
        const syncResponse = await nextActiveTextSession.runExclusive(
          async (session) => {
            if (session.isInvalidated) {
              throw new ActiveDocumentSessionInvalidatedError();
            }

            if (!input.isLatestJoin()) {
              return null;
            }

            await input.revalidateAccess(
              input.workspaceOpenInput.projectId,
              input.workspaceOpenInput.userId,
            );

            return {
              documentId: session.documentId,
              stateB64: encodeBase64(session.document.exportUpdate()),
              serverVersion: session.serverVersion,
            };
          },
        );

        if (!syncResponse || !input.isLatestJoin()) {
          await leaveJoinedRoomIfNeeded(socket, input, nextWorkspaceRoomName);
          await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
          return;
        }

        const previousSession = input.swapActiveTextSession({
          projectId: input.workspaceOpenInput.projectId,
          documentId: input.workspaceOpenInput.documentId,
          joinSequence: input.joinSequence,
          workspaceRoomName: nextWorkspaceRoomName,
          handle: nextActiveTextSession,
        });
        joinedSessionHandle = null;
        input.setActiveWorkspaceRoomName(nextWorkspaceRoomName);
        input.setActiveDocumentId(input.workspaceOpenInput.documentId);

        const projectRoomJoined = await joinProjectRoom(
          socket,
          input,
          input.workspaceOpenInput.projectId,
        );
        if (!projectRoomJoined) {
          if (previousSession) {
            void leaveActiveTextSession(socket, previousSession);
          }
          return;
        }

        socket.emit("workspace:opened", openedWorkspace.workspace);
        socket.emit("doc.sync.response", syncResponse);

        if (previousSession) {
          void leaveActiveTextSession(socket, previousSession);
        }

        return;
      }

      const previousSession = input.swapActiveTextSession(null);
      input.setActiveWorkspaceRoomName(nextWorkspaceRoomName);
      input.setActiveDocumentId(input.workspaceOpenInput.documentId);

      const projectRoomJoined = await joinProjectRoom(
        socket,
        input,
        input.workspaceOpenInput.projectId,
      );
      if (!projectRoomJoined) {
        if (previousSession) {
          void leaveActiveTextSession(socket, previousSession);
        }
        return;
      }

      socket.emit("workspace:opened", openedWorkspace.workspace);

      if (previousSession) {
        void leaveActiveTextSession(socket, previousSession);
      }

      return;
    } catch (error) {
      if (joinedWorkspaceRoomName) {
        await leaveJoinedRoomIfNeeded(socket, input, joinedWorkspaceRoomName);
      }

      if (joinedSessionHandle) {
        await leaveActiveTextSession(socket, {
          projectId: input.workspaceOpenInput.projectId,
          documentId: input.workspaceOpenInput.documentId,
          joinSequence: input.joinSequence,
          workspaceRoomName: createTextWorkspaceRoomName(
            input.workspaceOpenInput.projectId,
            input.workspaceOpenInput.documentId,
            joinedSessionHandle.session.generation,
          ),
          handle: joinedSessionHandle,
        });
      }

      if (!input.isLatestJoin()) {
        return;
      }

      if (error instanceof ActiveDocumentSessionInvalidatedError) {
        continue;
      }

      if (isUnexpectedWorkspaceError(error)) {
        console.error("Workspace open failed", input.workspaceOpenInput, error);
      }

      socket.emit("realtime:error", mapWorkspaceError(error));
      return;
    }
  }
}

export async function applyDocumentUpdate(
  socket: WorkspaceSocket,
  realtimeDocumentService: RealtimeDocumentService,
  input: {
    request: ParsedDocumentUpdateRequest;
    sessionState: ActiveTextSessionState;
    userId: string;
    getActiveTextSession: () => ActiveTextSessionState | null;
  },
) {
  const isCurrentSession = () => {
    const currentSession = input.getActiveTextSession();

    return (
      currentSession?.handle === input.sessionState.handle &&
      currentSession.projectId === input.sessionState.projectId &&
      currentSession.documentId === input.sessionState.documentId &&
      currentSession.joinSequence === input.sessionState.joinSequence
    );
  };

  try {
    const result = await realtimeDocumentService.applyUpdate({
      projectId: input.sessionState.projectId,
      documentId: input.request.documentId,
      userId: input.userId,
      sessionHandle: input.sessionState.handle,
      update: input.request.update,
      isCurrentSession,
      buildAcceptedContext: ({
        session,
        isCurrentSession: isSenderCurrent,
      }) => ({
        shouldBroadcastToPeers: !session.isInvalidated,
        shouldEmitToSender: isSenderCurrent && !session.isInvalidated,
      }),
    });
    const updateEvent = {
      documentId: input.request.documentId,
      updateB64: encodeBase64(result.acceptedUpdate),
      clientUpdateId: input.request.clientUpdateId,
      serverVersion: result.serverVersion,
    };

    if (result.acceptedContext.shouldBroadcastToPeers) {
      try {
        socket
          .to(input.sessionState.workspaceRoomName)
          .emit("doc.update", updateEvent);
      } catch (error) {
        // Fire-and-forget safety net — Socket.IO emit is extremely unlikely
        // to throw synchronously, but we catch to avoid crashing the caller.
        console.error(
          "Failed to broadcast update to peers",
          {
            socketId: socket.id,
            documentId: input.request.documentId,
            roomName: input.sessionState.workspaceRoomName,
          },
          error,
        );
      }
    }

    if (result.acceptedContext.shouldEmitToSender) {
      socket.emit("doc.update", updateEvent);
      socket.emit("doc.update.ack", {
        documentId: input.request.documentId,
        clientUpdateId: input.request.clientUpdateId,
        serverVersion: result.serverVersion,
      });
    }
  } catch (error) {
    if (
      shouldSuppressStaleSessionFailure(error, {
        isCurrentSession,
      })
    ) {
      console.debug("Suppressed stale session doc.update failure", {
        socketId: socket.id,
        documentId: input.request.documentId,
        error: error instanceof Error ? error.constructor.name : String(error),
      });
      return;
    }

    if (isUnexpectedDocumentUpdateError(error)) {
      console.error(
        "Document update failed",
        {
          socketId: socket.id,
          userId: socket.data.userId,
          projectId: input.sessionState.projectId,
          documentId: input.request.documentId,
          clientUpdateId: input.request.clientUpdateId,
        },
        error,
      );
    }

    socket.emit("realtime:error", mapDocumentUpdateError(error));
  }
}

export async function handleSyncRequest(
  socket: WorkspaceSocket,
  projectAccessService: Pick<ProjectAccessService, "requireProjectMember">,
  input: {
    request: { documentId: string };
    sessionState: ActiveTextSessionState;
    userId: string;
    getActiveTextSession: () => ActiveTextSessionState | null;
  },
) {
  const isCurrentSession = () => {
    const currentSession = input.getActiveTextSession();

    return (
      currentSession?.handle === input.sessionState.handle &&
      currentSession.projectId === input.sessionState.projectId &&
      currentSession.documentId === input.sessionState.documentId &&
      currentSession.joinSequence === input.sessionState.joinSequence
    );
  };

  try {
    const syncResponse = await input.sessionState.handle.runExclusive(
      async (session) => {
        if (session.isInvalidated) {
          throw new ActiveDocumentSessionInvalidatedError();
        }

        if (!isCurrentSession()) {
          throw new RealtimeDocumentSessionMismatchError();
        }

        await projectAccessService.requireProjectMember(
          input.sessionState.projectId,
          input.userId,
        );

        return {
          documentId: session.documentId,
          stateB64: encodeBase64(session.document.exportUpdate()),
          serverVersion: session.serverVersion,
        };
      },
    );

    if (!isCurrentSession()) {
      return;
    }

    socket.emit("doc.sync.response", syncResponse);
  } catch (error) {
    if (
      shouldSuppressStaleSessionFailure(error, {
        isCurrentSession,
      })
    ) {
      console.debug("Suppressed stale session doc.sync.request failure", {
        socketId: socket.id,
        documentId: input.request.documentId,
        error: error instanceof Error ? error.constructor.name : String(error),
      });
      return;
    }

    if (isUnexpectedSyncRequestError(error)) {
      console.error(
        "Sync request failed",
        {
          socketId: socket.id,
          userId: input.userId,
          projectId: input.sessionState.projectId,
          documentId: input.request.documentId,
        },
        error,
      );
    }

    socket.emit("realtime:error", mapSyncRequestError(error));
  }
}
