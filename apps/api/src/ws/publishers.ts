import type {
  CommentAddedEvent,
  CommentThreadCreatedEvent,
  CommentThreadStatusChangedEvent,
  CompileDoneEvent,
  FileTreeChangedEvent,
  SnapshotRestoredEvent,
} from "@collab-tex/shared";
import type { ActiveDocumentRegistry } from "../services/activeDocumentRegistry.js";
import {
  createProjectRoomName,
  createTextWorkspaceRoomName,
  createWorkspaceRoomName,
} from "./roomNames.js";
import type { SocketIOServer } from "./types.js";

export function createSocketDocumentResetPublisher(
  io: SocketIOServer,
  activeDocumentRegistry: ActiveDocumentRegistry,
) {
  return {
    emitDocumentReset: async ({
      projectId,
      documentId,
      reason,
      serverVersion,
    }: {
      projectId: string;
      documentId: string;
      reason: string;
      serverVersion: number;
    }) => {
      if (reason === "snapshot_restore") {
        const { invalidatedGeneration } = activeDocumentRegistry.invalidate({
          projectId,
          documentId,
        });

        try {
          io.to(
            createTextWorkspaceRoomName(
              projectId,
              documentId,
              invalidatedGeneration,
            ),
          ).emit("doc.reset", {
            documentId,
            reason,
            serverVersion,
          });
        } catch (error) {
          // Fire-and-forget safety net — Socket.IO emit is extremely unlikely
          // to throw synchronously, but we catch to avoid crashing the caller.
          console.error(
            "Failed to broadcast doc.reset to text session",
            { projectId, documentId, reason },
            error,
          );
        }
      }

      try {
        io.to(createWorkspaceRoomName(projectId, documentId)).emit(
          "doc.reset",
          {
            documentId,
            reason,
            serverVersion,
          },
        );
      } catch (error) {
        // Fire-and-forget safety net — Socket.IO emit is extremely unlikely
        // to throw synchronously, but we catch to avoid crashing the caller.
        console.error(
          "Failed to broadcast doc.reset to workspace",
          { projectId, documentId, reason },
          error,
        );
      }
    },
  };
}

export function createCompileDonePublisher(io: SocketIOServer) {
  return {
    emitCompileDone: (event: CompileDoneEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "compile:done",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast compile:done",
          { projectId: event.projectId },
          error,
        );
      }
    },
  };
}

export type CommentPublisher = ReturnType<typeof createCommentPublisher>;

export function createCommentPublisher(io: SocketIOServer) {
  return {
    emitThreadCreated: (event: CommentThreadCreatedEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "comment:thread_created",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast comment:thread_created",
          { projectId: event.projectId },
          error,
        );
      }
    },
    emitCommentAdded: (event: CommentAddedEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "comment:added",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast comment:added",
          { projectId: event.projectId },
          error,
        );
      }
    },
    emitThreadStatusChanged: (event: CommentThreadStatusChangedEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "comment:thread_status_changed",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast comment:thread_status_changed",
          { projectId: event.projectId },
          error,
        );
      }
    },
  };
}

export type FileTreePublisher = ReturnType<typeof createFileTreePublisher>;

export function createFileTreePublisher(io: SocketIOServer) {
  return {
    emitTreeChanged: (event: FileTreeChangedEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "project:tree_changed",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast project:tree_changed",
          { projectId: event.projectId },
          error,
        );
      }
    },
  };
}

export type SnapshotPublisher = ReturnType<typeof createSnapshotPublisher>;

export function createSnapshotPublisher(io: SocketIOServer) {
  return {
    emitSnapshotRestored: (event: SnapshotRestoredEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "snapshot:restored",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast snapshot:restored",
          { projectId: event.projectId },
          error,
        );
      }
    },
  };
}
