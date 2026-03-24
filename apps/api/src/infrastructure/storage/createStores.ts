import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "../../config/appConfig.js";
import type { BinaryContentStore } from "../../services/binaryContent.js";
import type { CompileArtifactStore } from "../../services/compile.js";
import type { SnapshotStore } from "../../services/snapshot.js";
import { createLocalFilesystemBinaryContentStore } from "./localFilesystemBinaryContentStore.js";
import { createLocalFilesystemCompileStore } from "./localFilesystemCompileStore.js";
import { createLocalFilesystemSnapshotStore } from "./localFilesystemSnapshotStore.js";
import { createS3BinaryContentStore } from "./s3BinaryContentStore.js";
import { createS3CompileStore } from "./s3CompileStore.js";
import { createS3SnapshotStore } from "./s3SnapshotStore.js";

export type Stores = {
  snapshotStore: SnapshotStore;
  binaryContentStore: BinaryContentStore;
  compileArtifactStore: CompileArtifactStore;
};

export function createStores(storageConfig: StorageConfig): Stores {
  if (storageConfig.storageBackend === "s3") {
    const s3Client = new S3Client({
      region: storageConfig.s3Region,
      ...(storageConfig.s3Endpoint && {
        endpoint: storageConfig.s3Endpoint,
        forcePathStyle: true,
      }),
    });

    return {
      snapshotStore: createS3SnapshotStore(
        s3Client,
        storageConfig.s3SnapshotBucket,
      ),
      binaryContentStore: createS3BinaryContentStore(
        s3Client,
        storageConfig.s3BinaryContentBucket,
      ),
      compileArtifactStore: createS3CompileStore(
        s3Client,
        storageConfig.s3CompileBucket,
      ),
    };
  }

  return {
    snapshotStore: createLocalFilesystemSnapshotStore(
      storageConfig.snapshotStorageRoot,
    ),
    binaryContentStore: createLocalFilesystemBinaryContentStore(
      storageConfig.binaryContentStorageRoot,
    ),
    compileArtifactStore: createLocalFilesystemCompileStore(
      storageConfig.compileStorageRoot,
    ),
  };
}
