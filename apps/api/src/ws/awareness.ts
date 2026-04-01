import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { WorkspaceSocket } from "./types.js";

/**
 * Extract the first awareness clock value from a base64-encoded y-protocols
 * awareness update. Returns null if the payload cannot be decoded.
 */
export function extractAwarenessClock(awarenessB64: string): number | null {
  try {
    const bytes = Buffer.from(awarenessB64, "base64");
    const decoder = decoding.createDecoder(bytes);
    const count = decoding.readVarUint(decoder);
    if (count === 0) return null;
    decoding.readVarUint(decoder); // skip clientID
    return decoding.readVarUint(decoder); // clock
  } catch (error) {
    console.warn("Failed to extract awareness clock from update", error);
    return null;
  }
}

/**
 * Broadcast an awareness removal message to peers in a workspace room.
 * Uses lib0 encoding to produce a valid y-protocols awareness update that
 * marks the given clientID as removed (state = "null") with a clock value
 * one higher than the last seen clock, ensuring peers accept the removal.
 */
export function broadcastAwarenessRemoval(
  socket: WorkspaceSocket,
  workspaceRoomName: string,
  documentId: string,
  clientID: number,
  lastSeenClock: number,
) {
  try {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // 1 client in this update
    encoding.writeVarUint(encoder, clientID);
    encoding.writeVarUint(encoder, lastSeenClock + 1); // must be > currClock
    encoding.writeVarString(encoder, "null"); // null state signals removal
    const awarenessB64 = Buffer.from(encoding.toUint8Array(encoder)).toString(
      "base64",
    );

    socket.to(workspaceRoomName).emit("presence.update", {
      documentId,
      awarenessB64,
    });
  } catch (error) {
    console.error(
      "Failed to broadcast awareness removal",
      { socketId: socket.id, documentId, clientID },
      error,
    );
  }
}
