import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BinaryContentNotFoundError } from "../../services/binaryContent.js";
import { createS3BinaryContentStore } from "./s3BinaryContentStore.js";

function getTestConfig() {
  const endpoint = process.env.TEST_S3_ENDPOINT;
  const bucket = process.env.TEST_S3_BINARY_CONTENT_BUCKET;
  const region = process.env.TEST_S3_REGION || "us-east-1";

  if (!endpoint || !bucket) {
    throw new Error(
      "TEST_S3_ENDPOINT and TEST_S3_BINARY_CONTENT_BUCKET must be set",
    );
  }

  return { endpoint, bucket, region };
}

describe("s3BinaryContentStore", () => {
  let s3Client: S3Client;
  let store: ReturnType<typeof createS3BinaryContentStore>;
  const keyPrefix = `test-${randomUUID()}/`;

  beforeAll(() => {
    const config = getTestConfig();
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    store = createS3BinaryContentStore(s3Client, config.bucket);
  });

  afterAll(() => {
    s3Client.destroy();
  });

  function testKey(suffix: string) {
    return `${keyPrefix}${suffix}`;
  }

  it("writes and reads a binary file round-trip", async () => {
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const key = testKey("project-1/document-1");

    await store.put(key, content);
    const result = await store.get(key);

    expect(result).toEqual(content);
  });

  it("stores nested key paths", async () => {
    const key = testKey("a/b/c/file");

    await store.put(key, Buffer.from("data"));
    const result = await store.get(key);

    expect(result.toString()).toBe("data");
  });

  it("throws BinaryContentNotFoundError for missing key", async () => {
    await expect(store.get(testKey("nonexistent"))).rejects.toThrow(
      BinaryContentNotFoundError,
    );
  });

  it("overwrites existing object on put", async () => {
    const key = testKey("project-1/overwrite-test");

    await store.put(key, Buffer.from("version 1"));
    await store.put(key, Buffer.from("version 2"));

    const result = await store.get(key);
    expect(result.toString()).toBe("version 2");
  });

  it("deletes existing object", async () => {
    const key = testKey("project-1/delete-test");

    await store.put(key, Buffer.from("data"));
    await store.delete(key);

    await expect(store.get(key)).rejects.toThrow(BinaryContentNotFoundError);
  });

  it("delete does not throw for missing key", async () => {
    await expect(
      store.delete(testKey("nonexistent-delete")),
    ).resolves.toBeUndefined();
  });
});
