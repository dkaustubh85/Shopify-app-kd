-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncOperationId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "syncStartedAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "templateId" TEXT,
    "fileName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadRow" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "source" JSONB NOT NULL,
    "matchKey" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL DEFAULT '',
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "variantId" TEXT,
    "productId" TEXT,
    "inventoryItemId" TEXT,
    "previousQty" INTEGER,
    "newQty" INTEGER,
    "previousPrice" TEXT,
    "newPrice" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "undone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UploadRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "uploadId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteBatch" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowIds" JSONB NOT NULL,
    "mutation" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "firstSentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WriteBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantCache" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "imageUrl" TEXT,
    "tracked" BOOLEAN NOT NULL,
    "price" TEXT NOT NULL,
    "quantities" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_shopId_idx" ON "Template"("shopId");

-- CreateIndex
CREATE INDEX "Upload_shopId_createdAt_idx" ON "Upload"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "UploadRow_uploadId_status_idx" ON "UploadRow"("uploadId", "status");

-- CreateIndex
CREATE INDEX "Job_shopId_status_idx" ON "Job"("shopId", "status");

-- CreateIndex
CREATE INDEX "WriteBatch_jobId_status_idx" ON "WriteBatch"("jobId", "status");

-- CreateIndex
CREATE INDEX "VariantCache_shopId_sku_idx" ON "VariantCache"("shopId", "sku");

-- CreateIndex
CREATE INDEX "VariantCache_shopId_barcode_idx" ON "VariantCache"("shopId", "barcode");

-- CreateIndex
CREATE INDEX "VariantCache_shopId_handle_idx" ON "VariantCache"("shopId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "VariantCache_shopId_variantId_key" ON "VariantCache"("shopId", "variantId");

-- AddForeignKey
ALTER TABLE "UploadRow" ADD CONSTRAINT "UploadRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteBatch" ADD CONSTRAINT "WriteBatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
