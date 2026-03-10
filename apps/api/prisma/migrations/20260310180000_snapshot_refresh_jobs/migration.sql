-- CreateEnum
CREATE TYPE "SnapshotRefreshJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "SnapshotRefreshJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "requestedByUserId" UUID,
    "status" "SnapshotRefreshJobStatus" NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SnapshotRefreshJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnapshotRefreshJob_projectId_createdAt_idx" ON "SnapshotRefreshJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SnapshotRefreshJob_status_createdAt_idx" ON "SnapshotRefreshJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SnapshotRefreshJob" ADD CONSTRAINT "SnapshotRefreshJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotRefreshJob" ADD CONSTRAINT "SnapshotRefreshJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
