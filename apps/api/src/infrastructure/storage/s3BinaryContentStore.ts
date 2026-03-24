import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  BinaryContentNotFoundError,
  type BinaryContentStore,
} from "../../services/binaryContent.js";
import { isNoSuchKeyError, streamToBuffer } from "./s3Helpers.js";

export function createS3BinaryContentStore(
  s3Client: S3Client,
  bucket: string,
): BinaryContentStore {
  return {
    put: async (storagePath, content) => {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: content,
        }),
      );
    },
    get: async (storagePath) => {
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
          throw new BinaryContentNotFoundError();
        }
        throw error;
      }
    },
    delete: async (storagePath) => {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: storagePath,
        }),
      );
    },
  };
}
