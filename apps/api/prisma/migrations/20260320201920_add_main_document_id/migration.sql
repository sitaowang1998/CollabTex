/*
  Warnings:

  - A unique constraint covering the columns `[mainDocumentId]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "mainDocumentId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Project_mainDocumentId_key" ON "Project"("mainDocumentId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_mainDocumentId_fkey" FOREIGN KEY ("mainDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
