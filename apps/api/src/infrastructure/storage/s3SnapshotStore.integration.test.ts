import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SnapshotDataNotFoundError,
  type ProjectSnapshotState,
} from "../../services/snapshot.js";
import { createS3SnapshotStore } from "./s3SnapshotStore.js";

function getTestConfig() {
  const endpoint = process.env.TEST_S3_ENDPOINT;
  const bucket = process.env.TEST_S3_SNAPSHOT_BUCKET;
  const region = process.env.TEST_S3_REGION || "us-east-1";

  if (!endpoint || !bucket) {
    throw new Error("TEST_S3_ENDPOINT and TEST_S3_SNAPSHOT_BUCKET must be set");
  }

  return { endpoint, bucket, region };
}

describe("s3SnapshotStore", () => {
  let s3Client: S3Client;
  let store: ReturnType<typeof createS3SnapshotStore>;
  const keyPrefix = `test-${randomUUID()}/`;

  beforeAll(() => {
    const config = getTestConfig();
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    store = createS3SnapshotStore(s3Client, config.bucket);
  });

  afterAll(() => {
    s3Client.destroy();
  });

  function testKey(suffix: string) {
    return `${keyPrefix}${suffix}`;
  }

  const docId1 = "00000000-0000-4000-8000-000000000001";
  const docId2 = "00000000-0000-4000-8000-000000000002";

  const sampleSnapshot: ProjectSnapshotState = {
    documents: {
      [docId1]: {
        path: "/main.tex",
        kind: "text",
        mime: null,
        textContent: "Hello world",
      },
    },
    commentThreads: null,
  };

  it("writes and reads a snapshot round-trip", async () => {
    const key = testKey("project-1/snapshot-1.json");

    await store.writeProjectSnapshot(key, sampleSnapshot);
    const result = await store.readProjectSnapshot(key);

    expect(result).toEqual(sampleSnapshot);
  });

  it("throws SnapshotDataNotFoundError for missing key", async () => {
    await expect(
      store.readProjectSnapshot(testKey("nonexistent.json")),
    ).rejects.toThrow(SnapshotDataNotFoundError);
  });

  it("overwrites existing snapshot on write", async () => {
    const key = testKey("project-1/overwrite-snapshot.json");
    const updated: ProjectSnapshotState = {
      documents: {
        [docId2]: {
          path: "/other.tex",
          kind: "text",
          mime: null,
          textContent: "Updated",
        },
      },
      commentThreads: null,
    };

    await store.writeProjectSnapshot(key, sampleSnapshot);
    await store.writeProjectSnapshot(key, updated);

    const result = await store.readProjectSnapshot(key);
    expect(result).toEqual(updated);
  });
});
