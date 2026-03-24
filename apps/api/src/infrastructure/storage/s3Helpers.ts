import type { Readable } from "node:stream";
import { NoSuchKey } from "@aws-sdk/client-s3";

export async function streamToBuffer(
  body: Readable | ReadableStream | Blob | undefined,
): Promise<Buffer> {
  if (!body) {
    throw new Error("S3 response body is unexpectedly empty");
  }

  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }

  const chunks: Buffer[] = [];
  const readable = body as Readable;
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export function isNoSuchKeyError(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;
  return error instanceof Error && error.name === "NoSuchKey";
}
