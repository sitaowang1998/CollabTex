import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  InvalidSnapshotDataError,
  parseProjectSnapshotState,
  SnapshotDataNotFoundError,
  type ProjectSnapshotState,
  type SnapshotStore,
} from "../../services/snapshot.js";
import { isNoSuchKeyError, streamToBuffer } from "./s3Helpers.js";

export function createS3SnapshotStore(
  s3Client: S3Client,
  bucket: string,
): SnapshotStore {
  return {
    readProjectSnapshot: async (storagePath) => {
      try {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: storagePath,
          }),
        );
        const raw = (await streamToBuffer(response.Body)).toString("utf8");
        const parsed = parseSnapshotJson(raw);
        return parseProjectSnapshotState(parsed);
      } catch (error) {
        if (isNoSuchKeyError(error)) {
          throw new SnapshotDataNotFoundError();
        }
        throw error;
      }
    },
    writeProjectSnapshot: async (storagePath, snapshot) => {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: JSON.stringify(snapshot satisfies ProjectSnapshotState),
          ContentType: "application/json",
        }),
      );
    },
  };
}

function parseSnapshotJson(rawSnapshot: string): unknown {
  try {
    return JSON.parse(rawSnapshot) as unknown;
  } catch {
    throw new InvalidSnapshotDataError("snapshot payload must be valid JSON");
  }
}
