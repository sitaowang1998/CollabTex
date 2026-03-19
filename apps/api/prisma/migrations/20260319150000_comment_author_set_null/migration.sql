-- AlterTable: make Comment.authorId nullable and change onDelete to SET NULL
ALTER TABLE "Comment" ALTER COLUMN "authorId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_authorId_fkey";

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
