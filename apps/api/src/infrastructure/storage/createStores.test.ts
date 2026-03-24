import { afterEach, describe, expect, it } from "vitest";
import type {
  StorageConfigLocal,
  StorageConfigS3,
} from "../../config/appConfig.js";
import { createStores } from "./createStores.js";

describe("createStores", () => {
  const destroyCallbacks: (() => void)[] = [];

  afterEach(() => {
    for (const destroy of destroyCallbacks) {
      destroy();
    }
    destroyCallbacks.length = 0;
  });

  it("returns stores without destroy for local backend", () => {
    const config: StorageConfigLocal = {
      storageBackend: "local",
      snapshotStorageRoot: "/tmp/test-snapshots",
      compileStorageRoot: "/tmp/test-compiles",
      binaryContentStorageRoot: "/tmp/test-binary",
    };

    const stores = createStores(config);

    expect(stores.snapshotStore).toBeDefined();
    expect(stores.binaryContentStore).toBeDefined();
    expect(stores.compileArtifactStore).toBeDefined();
    expect(stores.destroy).toBeUndefined();
  });

  it("returns stores with destroy for s3 backend", () => {
    const config: StorageConfigS3 = {
      storageBackend: "s3",
      s3Region: "us-east-1",
      s3Endpoint: "http://localhost:4566",
      s3BinaryContentBucket: "test-binary",
      s3SnapshotBucket: "test-snapshots",
      s3CompileBucket: "test-compiles",
    };

    const stores = createStores(config);
    if (stores.destroy) {
      destroyCallbacks.push(stores.destroy);
    }

    expect(stores.snapshotStore).toBeDefined();
    expect(stores.binaryContentStore).toBeDefined();
    expect(stores.compileArtifactStore).toBeDefined();
    expect(stores.destroy).toBeTypeOf("function");
  });

  it("destroy cleans up s3 client without error", () => {
    const config: StorageConfigS3 = {
      storageBackend: "s3",
      s3Region: "us-east-1",
      s3Endpoint: "http://localhost:4566",
      s3BinaryContentBucket: "test-binary",
      s3SnapshotBucket: "test-snapshots",
      s3CompileBucket: "test-compiles",
    };

    const stores = createStores(config);

    expect(() => stores.destroy?.()).not.toThrow();
  });
});
