import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import type { TypedSocket } from "./socket";
import type {
  DocumentSyncResponseEvent,
  ServerDocumentUpdateEvent,
  DocumentUpdateAckEvent,
  DocumentResetEvent,
  WorkspaceErrorEvent,
  PresenceUpdateEvent,
} from "@collab-tex/shared";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function generateUserColor(name: string | undefined): string {
  if (!name) return "#30bced";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

export interface YjsDocumentSyncOptions {
  projectId: string;
  documentId: string;
  socket: TypedSocket;
  userName?: string;
  onSynced: () => void;
  onError: (err: { code: string; message: string }) => void;
}

const REMOTE_ORIGIN = "remote";
const JOIN_TIMEOUT_MS = 5000;
const MAX_JOIN_RETRIES = 5;

export class YjsDocumentSync {
  private _ydoc: Y.Doc;
  private _awareness: Awareness;
  private _synced = false;
  private _serverVersion = 0;
  private _destroyed = false;
  private _updateCounter = 0;
  private _joinRetryCount = 0;
  private _joinTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly projectId: string;
  private readonly documentId: string;
  private readonly socket: TypedSocket;
  private readonly onSynced: () => void;
  private readonly onError: (err: { code: string; message: string }) => void;

  private readonly handleSyncResponse: (
    data: DocumentSyncResponseEvent,
  ) => void;
  private readonly handleDocUpdate: (data: ServerDocumentUpdateEvent) => void;
  private readonly handleUpdateAck: (data: DocumentUpdateAckEvent) => void;
  private readonly handleReset: (data: DocumentResetEvent) => void;
  private readonly handleError: (data: WorkspaceErrorEvent) => void;
  private readonly handlePresenceUpdate: (data: PresenceUpdateEvent) => void;
  private readonly handleReconnect: () => void;
  private readonly handleConnect: () => void;
  private readonly userName: string | undefined;
  private ydocObserver: (update: Uint8Array, origin: unknown) => void;
  private awarenessObserver: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: string | null,
  ) => void;

  constructor(options: YjsDocumentSyncOptions) {
    this.projectId = options.projectId;
    this.documentId = options.documentId;
    this.socket = options.socket;
    this.userName = options.userName;
    this.onSynced = options.onSynced;
    this.onError = options.onError;

    this._ydoc = new Y.Doc();
    this._awareness = new Awareness(this._ydoc);
    this.setAwarenessUser();

    this.handleSyncResponse = (data) => {
      if (data.documentId !== this.documentId || this._destroyed) return;
      this.clearJoinTimeout();
      this._joinRetryCount = 0;
      try {
        const bytes = decodeBase64(data.stateB64);
        Y.applyUpdate(this._ydoc, bytes, REMOTE_ORIGIN);
      } catch (err) {
        this.onError({
          code: "SYNC_FAILED",
          message: "Failed to sync document. Please try again.",
        });
        console.warn("[yjs-sync] Failed to apply sync response", {
          documentId: this.documentId,
          error: err,
        });
        return;
      }
      this._serverVersion = data.serverVersion;
      this._synced = true;
      this.onSynced();
    };

    this.handleDocUpdate = (data) => {
      if (data.documentId !== this.documentId || this._destroyed) return;
      if (!this._synced) return;
      try {
        const bytes = decodeBase64(data.updateB64);
        Y.applyUpdate(this._ydoc, bytes, REMOTE_ORIGIN);
        this._serverVersion = data.serverVersion;
      } catch (err) {
        console.warn("[yjs-sync] Failed to apply remote update", {
          documentId: this.documentId,
          error: err,
        });
      }
    };

    this.handleUpdateAck = (data) => {
      if (data.documentId !== this.documentId || this._destroyed) return;
      this._serverVersion = data.serverVersion;
    };

    this.handleReset = (data) => {
      if (data.documentId !== this.documentId || this._destroyed) return;
      this._serverVersion = data.serverVersion;
      this._synced = false;

      this._ydoc.off("update", this.ydocObserver);
      this._awareness.off("update", this.awarenessObserver);
      this._awareness.destroy();
      this._ydoc.destroy();

      this._ydoc = new Y.Doc();
      this._awareness = new Awareness(this._ydoc);
      this.setAwarenessUser();
      this.ydocObserver = this.createYdocObserver();
      this.awarenessObserver = this.createAwarenessObserver();
      this._ydoc.on("update", this.ydocObserver);
      this._awareness.on("update", this.awarenessObserver);

      this._joinRetryCount = 0;
      this.emitJoin();
    };

    this.handleError = (data) => {
      if (this._destroyed) return;
      this.onError(data);
    };

    this.handlePresenceUpdate = (data) => {
      if (data.documentId !== this.documentId || this._destroyed) return;
      try {
        const bytes = decodeBase64(data.awarenessB64);
        applyAwarenessUpdate(this._awareness, bytes, REMOTE_ORIGIN);
      } catch (err) {
        console.warn("[yjs-sync] Failed to apply presence update", {
          documentId: this.documentId,
          error: err,
        });
      }
    };

    this.handleReconnect = () => {
      if (this._destroyed) return;
      this._synced = false;
      this._joinRetryCount = 0;
      this.emitJoin();
    };

    this.handleConnect = () => {
      if (this._destroyed) return;
      this.emitJoin();
    };

    this.ydocObserver = this.createYdocObserver();
    this.awarenessObserver = this.createAwarenessObserver();
    this._ydoc.on("update", this.ydocObserver);
    this._awareness.on("update", this.awarenessObserver);

    this.socket.on("doc.sync.response", this.handleSyncResponse);
    this.socket.on("doc.update", this.handleDocUpdate);
    this.socket.on("doc.update.ack", this.handleUpdateAck);
    this.socket.on("doc.reset", this.handleReset);
    this.socket.on("realtime:error", this.handleError);
    this.socket.on("presence.update", this.handlePresenceUpdate);
    this.socket.io.on("reconnect", this.handleReconnect);

    if (this.socket.connected) {
      this.emitJoin();
    } else {
      this.socket.on("connect", this.handleConnect);
    }
  }

  private setAwarenessUser(): void {
    this._awareness.setLocalStateField("user", {
      name: this.userName ?? "Anonymous",
      color: generateUserColor(this.userName),
    });
  }

  private emitJoin(): void {
    this.clearJoinTimeout();

    if (this._joinRetryCount >= MAX_JOIN_RETRIES) {
      this.onError({
        code: "JOIN_TIMEOUT",
        message:
          "Unable to connect to the document. Please check your connection and try again.",
      });
      return;
    }

    this._joinRetryCount++;
    this.socket.emit("workspace:join", {
      projectId: this.projectId,
      documentId: this.documentId,
      awarenessClientID: this._ydoc.clientID,
    });
    this._joinTimeoutTimer = setTimeout(() => {
      this._joinTimeoutTimer = null;
      if (!this._destroyed && !this._synced) {
        this.emitJoin();
      }
    }, JOIN_TIMEOUT_MS);
  }

  private clearJoinTimeout(): void {
    if (this._joinTimeoutTimer !== null) {
      clearTimeout(this._joinTimeoutTimer);
      this._joinTimeoutTimer = null;
    }
  }

  private createYdocObserver() {
    return (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || this._destroyed || !this._synced) return;

      const updateB64 = encodeBase64(update);
      const clientUpdateId = `${Date.now()}-${++this._updateCounter}`;

      this.socket.emit("doc.update", {
        documentId: this.documentId,
        updateB64,
        clientUpdateId,
      });
    };
  }

  private createAwarenessObserver() {
    return (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: string | null,
    ) => {
      if (origin === REMOTE_ORIGIN || this._destroyed || !this._synced) return;

      const changedClients = changes.added
        .concat(changes.updated)
        .concat(changes.removed);

      try {
        const update = encodeAwarenessUpdate(this._awareness, changedClients);
        const awarenessB64 = encodeBase64(update);
        this.socket.emit("presence.update", {
          documentId: this.documentId,
          awarenessB64,
        });
      } catch (err) {
        console.warn("[yjs-sync] Failed to send awareness update", {
          documentId: this.documentId,
          error: err,
        });
      }
    };
  }

  get doc(): Y.Doc {
    return this._ydoc;
  }

  get awareness(): Awareness {
    return this._awareness;
  }

  get isSynced(): boolean {
    return this._synced;
  }

  get serverVersion(): number {
    return this._serverVersion;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this.clearJoinTimeout();

    // Broadcast awareness removal to peers BEFORE removing observers.
    // Without this, peers never learn we left (awareness.destroy() triggers
    // setLocalState(null) but the observer is already gone by then).
    if (this._synced && this.socket.connected) {
      try {
        const clientID = this._ydoc.clientID;
        this._awareness.setLocalState(null);
        const update = encodeAwarenessUpdate(this._awareness, [clientID]);
        this.socket.emit("presence.update", {
          documentId: this.documentId,
          awarenessB64: encodeBase64(update),
        });
      } catch (err) {
        console.warn("[yjs-sync] Failed to send awareness removal", {
          documentId: this.documentId,
          error: err,
        });
      }
    }

    this._ydoc.off("update", this.ydocObserver);
    this._awareness.off("update", this.awarenessObserver);

    this.socket.off("doc.sync.response", this.handleSyncResponse);
    this.socket.off("doc.update", this.handleDocUpdate);
    this.socket.off("doc.update.ack", this.handleUpdateAck);
    this.socket.off("doc.reset", this.handleReset);
    this.socket.off("realtime:error", this.handleError);
    this.socket.off("presence.update", this.handlePresenceUpdate);
    this.socket.off("connect", this.handleConnect);
    this.socket.io.off("reconnect", this.handleReconnect);

    this._awareness.destroy();
    this._ydoc.destroy();
  }
}
