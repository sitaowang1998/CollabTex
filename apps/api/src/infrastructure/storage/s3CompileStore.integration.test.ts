import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompileArtifactNotFoundError } from "../../services/compile.js";
import { createS3CompileStore } from "./s3CompileStore.js";

function getTestConfig() {
  const endpoint = process.env.TEST_S3_ENDPOINT;
  const bucket = process.env.TEST_S3_COMPILE_BUCKET;
  const region = process.env.TEST_S3_REGION || "us-east-1";

  if (!endpoint || !bucket) {
    throw new Error("TEST_S3_ENDPOINT and TEST_S3_COMPILE_BUCKET must be set");
  }

  return { endpoint, bucket, region };
}

describe("s3CompileStore", () => {
  let s3Client: S3Client;
  let store: ReturnType<typeof createS3CompileStore>;
  const keyPrefix = `test-${randomUUID()}/`;

  beforeAll(() => {
    const config = getTestConfig();
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    store = createS3CompileStore(s3Client, config.bucket);
  });

  afterAll(() => {
    s3Client.destroy();
  });

  function testKey(suffix: string) {
    return `${keyPrefix}${suffix}`;
  }

  it("writes and reads a PDF round-trip", async () => {
    const content = Buffer.from("%PDF-1.4 fake pdf content");
    const key = testKey("project-1/compile-1.pdf");

    await store.writePdf(key, content);
    const result = await store.readPdf(key);

    expect(result).toEqual(content);
  });

  it("throws CompileArtifactNotFoundError for missing key", async () => {
    await expect(store.readPdf(testKey("nonexistent.pdf"))).rejects.toThrow(
      CompileArtifactNotFoundError,
    );
  });

  it("overwrites existing PDF on write", async () => {
    const key = testKey("project-1/overwrite-compile.pdf");

    await store.writePdf(key, Buffer.from("version 1"));
    await store.writePdf(key, Buffer.from("version 2"));

    const result = await store.readPdf(key);
    expect(result.toString()).toBe("version 2");
  });
});
