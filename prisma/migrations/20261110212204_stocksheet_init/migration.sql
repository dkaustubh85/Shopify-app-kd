-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncOperationId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "syncStartedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "templateId" TEXT,
    "fileName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "mapping" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    "undoneAt" DATETIME
);

-- CreateTable
CREATE TABLE "UploadRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "UploadRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "uploadId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Job_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WriteBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "rowIds" JSONB NOT NULL,
    "mutation" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "firstSentAt" DATETIME,
    "error" TEXT,
    CONSTRAINT "WriteBatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VariantCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
