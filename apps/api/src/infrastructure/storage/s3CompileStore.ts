import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  CompileArtifactNotFoundError,
  type CompileArtifactStore,
} from "../../services/compile.js";
import { isNoSuchKeyError, streamToBuffer } from "./s3Helpers.js";

export function createS3CompileStore(
  s3Client: S3Client,
  bucket: string,
): CompileArtifactStore {
  return {
    writePdf: async (storagePath, content) => {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: content,
          ContentType: "application/pdf",
        }),
      );
    },
    readPdf: async (storagePath) => {
      try {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: storagePath,
          }),
        );
        return await streamToBuffer(response.Body);
      } catch (error) {
        if (isNoSuchKeyError(error)) {
          throw new CompileArtifactNotFoundError();
        }
        throw error;
      }
    },
  };
}
