-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('admin', 'editor', 'commenter', 'reader');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('text', 'binary');

-- CreateEnum
CREATE TYPE "CommentThreadStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "SnapshotRefreshJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tombstoneAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMembership" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "mime" VARCHAR(255),
    "contentHash" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTextState" (
    "documentId" UUID NOT NULL,
    "yjsState" BYTEA NOT NULL,
    "textContent" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTextState_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "storagePath" VARCHAR(1024) NOT NULL,
    "message" TEXT,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotRefreshJob" (
    "id" UUID NOT NULL,
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

-- CreateTable
CREATE TABLE "CommentThread" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "status" "CommentThreadStatus" NOT NULL DEFAULT 'open',
    "startAnchor" VARCHAR(1024) NOT NULL,
    "endAnchor" VARCHAR(1024) NOT NULL,
    "quotedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ProjectMembership_userId_idx" ON "ProjectMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_projectId_path_key" ON "Document"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_storagePath_key" ON "Snapshot"("storagePath");

-- CreateIndex
CREATE INDEX "Snapshot_projectId_idx" ON "Snapshot"("projectId");

-- CreateIndex
CREATE INDEX "SnapshotRefreshJob_projectId_createdAt_idx" ON "SnapshotRefreshJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SnapshotRefreshJob_status_createdAt_idx" ON "SnapshotRefreshJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CommentThread_documentId_createdAt_idx" ON "CommentThread"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommentThread_projectId_idx" ON "CommentThread"("projectId");

-- CreateIndex
CREATE INDEX "Comment_threadId_createdAt_idx" ON "Comment"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTextState" ADD CONSTRAINT "DocumentTextState_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotRefreshJob" ADD CONSTRAINT "SnapshotRefreshJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotRefreshJob" ADD CONSTRAINT "SnapshotRefreshJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentThread" ADD CONSTRAINT "CommentThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentThread" ADD CONSTRAINT "CommentThread_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
