import type { ActiveDocumentSessionHandle } from "../services/activeDocumentRegistry.js";
import {
  createProjectRoomName,
  createTextWorkspaceRoomName,
} from "./roomNames.js";
import type { WorkspaceSocket, ActiveTextSessionState } from "./types.js";

export async function joinProjectRoom(
  socket: WorkspaceSocket,
  input: {
    isLatestJoin: () => boolean;
    getActiveProjectRoomName: () => string | null;
    setActiveProjectRoomName: (roomName: string) => void;
    setActiveProjectId: (projectId: string) => void;
  },
  projectId: string,
): Promise<boolean> {
  const nextProjectRoomName = createProjectRoomName(projectId);
  const previousProjectRoomName = input.getActiveProjectRoomName();

  if (
    previousProjectRoomName &&
    previousProjectRoomName !== nextProjectRoomName
  ) {
    await socket.leave(previousProjectRoomName);

    if (!input.isLatestJoin()) {
      return false;
    }
  }

  await socket.join(nextProjectRoomName);

  if (!input.isLatestJoin()) {
    await socket.leave(nextProjectRoomName);
    return false;
  }

  input.setActiveProjectRoomName(nextProjectRoomName);
  input.setActiveProjectId(projectId);
  return true;
}

export async function leaveJoinedRoomIfNeeded(
  socket: WorkspaceSocket,
  input: {
    getActiveWorkspaceRoomName: () => string | null;
  },
  roomName: string,
) {
  if (input.getActiveWorkspaceRoomName() === roomName) {
    return;
  }

  await socket.leave(roomName);
}

export async function leaveJoinedSessionIfNeeded(
  socket: WorkspaceSocket,
  input: {
    workspaceOpenInput: { projectId: string; documentId: string };
    joinSequence: number;
  },
  joinedSessionHandle: ActiveDocumentSessionHandle | null,
) {
  if (!joinedSessionHandle) {
    return;
  }

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

export async function leaveActiveTextSession(
  socket: WorkspaceSocket,
  sessionState: ActiveTextSessionState,
) {
  try {
    await sessionState.handle.leave();
  } catch (error) {
    console.error(
      "Failed to leave active document session",
      {
        socketId: socket.id,
        projectId: sessionState.projectId,
        documentId: sessionState.documentId,
      },
      error,
    );
  }
}
