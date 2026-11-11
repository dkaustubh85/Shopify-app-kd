import { actions } from "../pipeline/actions/index.ts";
import type { ActionKind, PlannedChange } from "../pipeline/types.ts";
import { randomUUID } from "node:crypto";
import db from "../db.server.ts";
import { gql, SET, ADJUST, PRICE, type Admin } from "./graphql.server.ts";
import { liveQuantities, refreshProduct } from "./cache.server.ts";
import { requiresZeroAcknowledgement, undoPlan } from "../pipeline/preview.ts";
export async function enqueueUpload(
  shop: string,
  id: string,
  type: "apply" | "undo",
  ack: boolean,
  confirmed: boolean,
) {
  return db.$transaction(
    async (tx) => {
      const upload = await tx.upload.findFirst({
        where: { id, shopId: shop },
        include: { rows: true },
      });
      if (!upload) throw new Error("Upload not found.");
      if (type === "apply" && upload.status !== "preview")
        throw new Error("This upload is already queued or applied.");
      if (
        type === "undo" &&
        (!["completed", "partial", "failed"].includes(upload.status) ||
          upload.action === "setPrice")
      )
        throw new Error("This upload cannot be undone.");
      const rows = upload.rows.filter((r) =>
        type === "apply" ? r.status === "matched" : r.applied && !r.undone,
      );
      if (!rows.length) throw new Error("There are no eligible changes.");
      if (!confirmed)
        throw new Error("Confirm the number of variants before continuing.");
      const tracked = await tx.variantCache.count({
        where: { shopId: shop, tracked: true },
      });
      const zero = rows.filter(
        (r) =>
          (type === "apply" ? r.newQty : r.previousQty) === 0 &&
          (type === "apply" ? r.previousQty : r.newQty) !== 0,
      ).length;
      if (requiresZeroAcknowledgement(zero, tracked) && !ack)
        throw new Error(
          "More than 80% of tracked variants will become sold out. Tick I understand to continue.",
        );
      if (
        await tx.job.count({
          where: {
            shopId: shop,
            type: { in: ["apply", "undo"] },
            status: { in: ["queued", "running", "retryable"] },
          },
        })
      )
        throw new Error(
          "Finish or resume the current upload before starting another.",
        );
      const job = await tx.job.create({
        data: {
          shopId: shop,
          uploadId: id,
          type,
          payload: { ack },
          status: "queued",
        },
      });
      await tx.upload.update({
        where: { id },
        data: { status: type === "apply" ? "queued" : "undo_queued" },
      });
      return job;
    },
    { isolationLevel: "Serializable" },
  );
}
async function prepare(job: any, admin: Admin) {
  const upload = await db.upload.findUniqueOrThrow({
    where: { id: job.uploadId },
    include: { rows: { orderBy: { rowIndex: "asc" } } },
  });
  const undo = job.type === "undo";
  const rows = upload.rows.filter((r: any) =>
    undo ? r.applied && !r.undone : r.status === "matched",
  );
  if (!rows.length) return;
  const live =
    upload.action === "setPrice"
      ? new Map<string, number>()
      : await liveQuantities(
          admin,
          rows.map((r: any) => r.inventoryItemId!),
          upload.locationId,
        );
  const livePrices = new Map<string, string>();
  if (upload.action === "setPrice") {
    for (let i = 0; i < rows.length; i += 100) {
      const data = await gql(
        admin,
        "query LivePrices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price } } }",
        { ids: rows.slice(i, i + 100).map((r) => r.variantId) },
      );
      for (const v of data.nodes) if (v) livePrices.set(v.id, v.price);
    }
  }
  const ready: any[] = [];
  for (const row of rows) {
    let error: string | null = null;
    if (upload.action !== "setPrice") {
      const quantity = live.get(row.inventoryItemId!);
      try {
        if (quantity === undefined)
          throw new Error(
            "Inventory is not tracked or is not stocked at this location.",
          );
        if (undo) undoPlan(row, quantity);
        else if (quantity !== row.previousQty)
          throw new Error(
            "Stock changed after preview. Upload a fresh sheet to use current quantities.",
          );
      } catch (e) {
        error = (e as Error).message;
      }
    }
    if (
      upload.action === "setPrice" &&
      Number(livePrices.get(row.variantId!)) !== Number(row.previousPrice)
    )
      error = "Price changed after preview. Upload a fresh sheet.";
    if (error)
      await db.uploadRow.update({
        where: { id: row.id },
        data: { status: undo ? "undo_conflict" : "error", errorMessage: error },
      });
    else ready.push(row);
  }
  const groups: any[][] = [];
  if (upload.action === "setPrice") {
    const products = new Map<string, any[]>();
    for (const row of ready) {
      products.set(row.productId, [
        ...(products.get(row.productId) || []),
        row,
      ]);
    }
    for (const group of products.values())
      for (let i = 0; i < group.length; i += 250)
        groups.push(group.slice(i, i + 250));
  } else
    for (let i = 0; i < ready.length; i += 250)
      groups.push(ready.slice(i, i + 250));
  // Durable snapshots and immutable requests are committed before any mutation is sent.
  await db.$transaction(async (tx) => {
    for (const group of groups) {
      const key = randomUUID();
      const writerMutation = undo
        ? actions.setQuantity.mutation
        : actions[upload.action as ActionKind].mutation;
      const adjust = writerMutation === "inventoryAdjustQuantities";
      const mutation =
        writerMutation === "productVariantsBulkUpdate"
          ? PRICE
          : adjust
            ? ADJUST
            : SET;
      const variables =
        upload.action === "setPrice"
          ? {
              productId: group[0].productId,
              variants: group.map((r) => ({
                id: r.variantId,
                price: r.newPrice,
              })),
            }
          : {
              idempotencyKey: key,
              input: {
                name: "available",
                reason: "correction",
                referenceDocumentUri:
                  "stocksheet://upload/" + upload.id + "/" + job.type,
                ...(adjust
                  ? {
                      changes: group.map((r) => ({
                        inventoryItemId: r.inventoryItemId,
                        locationId: upload.locationId,
                        delta: r.newQty - r.previousQty,
                        changeFromQuantity: r.previousQty,
                      })),
                    }
                  : {
                      quantities: group.map((r) => ({
                        inventoryItemId: r.inventoryItemId,
                        locationId: upload.locationId,
                        quantity: undo ? r.previousQty : r.newQty,
                        changeFromQuantity: undo ? r.newQty : r.previousQty,
                      })),
                    }),
              },
            };
      await tx.writeBatch.create({
        data: {
          id: key,
          jobId: job.id,
          rowIds: group.map((r) => r.id),
          mutation,
          variables,
        },
      });
    }
    await tx.job.update({
      where: { id: job.id },
      data: {
        payload: {
          ...(job.payload as object),
          prepared: true,
          bulk: ready.length > 5000,
        },
      },
    });
  });
}
async function record(batch: any, result: any, undo: boolean) {
  const payload =
    result?.inventorySetQuantities ||
    result?.inventoryAdjustQuantities ||
    result?.productVariantsBulkUpdate;
  const errors = payload?.userErrors || [];
  if (!payload)
    throw new Error(
      "Shopify returned no mutation result. Retry with the saved request.",
    );
  const error = errors.length
    ? errors.map((e: any) => e.message).join("; ")
    : null;
  await db.$transaction(async (tx) => {
    await tx.uploadRow.updateMany({
      where: { id: { in: batch.rowIds as string[] } },
      data: error
        ? { status: undo ? "undo_conflict" : "error", errorMessage: error }
        : undo
          ? { status: "undone", undone: true, errorMessage: null }
          : { status: "success", applied: true, errorMessage: null },
    });
    await tx.writeBatch.update({
      where: { id: batch.id },
      data: { status: error ? "error" : "completed", error },
    });
  });
  if (!error) {
    const rows = await db.uploadRow.findMany({
      where: { id: { in: batch.rowIds as string[] } },
      include: { upload: true },
    });
    for (const r of rows) {
      const v = await db.variantCache.findUnique({
        where: {
          shopId_variantId: {
            shopId: r.upload.shopId,
            variantId: r.variantId!,
          },
        },
      });
      if (!v) continue;
      if (r.newPrice)
        await db.variantCache.update({
          where: { id: v.id },
          data: { price: r.newPrice },
        });
      else
        await db.variantCache.update({
          where: { id: v.id },
          data: {
            quantities: {
              ...(v.quantities as object),
              [r.upload.locationId]: undo ? r.previousQty : r.newQty,
            },
          },
        });
    }
  }
}
function retryWindow(batch: any) {
  if (
    batch.firstSentAt &&
    Date.now() - new Date(batch.firstSentAt).getTime() > 23 * 60 * 60 * 1000
  )
    throw new Error(
      "This request has an uncertain outcome older than 23 hours. Reconcile live inventory before continuing; automatic retry is disabled.",
    );
}
async function bulk(job: any, admin: Admin) {
  const batches = await db.writeBatch.findMany({
    where: { jobId: job.id },
    orderBy: { id: "asc" },
  });
  for (const b of batches.filter((b) => b.status === "pending")) retryWindow(b);
  let payload = job.payload as any;
  if (!payload.bulkOperationId) {
    const content = batches.map((b) => JSON.stringify(b.variables)).join("\n");
    const staged = await gql(
      admin,
      "mutation Stage($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url parameters { name value } } userErrors { message } } }",
      {
        input: [
          {
            resource: "BULK_MUTATION_VARIABLES",
            filename: job.id + ".jsonl",
            mimeType: "text/jsonl",
            httpMethod: "POST",
          },
        ],
      },
    );
    if (staged.stagedUploadsCreate.userErrors.length)
      throw new Error(staged.stagedUploadsCreate.userErrors[0].message);
    const target = staged.stagedUploadsCreate.stagedTargets[0];
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append(
      "file",
      new Blob([content], { type: "text/jsonl" }),
      job.id + ".jsonl",
    );
    const response = await fetch(target.url, { method: "POST", body: form });
    if (!response.ok)
      throw new Error("Bulk file staging failed. Retry the job.");
    const key = target.parameters.find((p: any) => p.name === "key")?.value;
    if (!key) throw new Error("Shopify did not provide a staging key.");
    await db.writeBatch.updateMany({
      where: { jobId: job.id, firstSentAt: null },
      data: { firstSentAt: new Date() },
    });
    const data = await gql(
      admin,
      "mutation RunBulk($mutation: String!, $path: String!, $identifier: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $path, clientIdentifier: $identifier) { bulkOperation { id status } userErrors { message } } }",
      { mutation: batches[0].mutation, path: key, identifier: job.id },
    );
    if (data.bulkOperationRunMutation.userErrors.length)
      throw new Error(data.bulkOperationRunMutation.userErrors[0].message);
    payload = {
      ...payload,
      bulkOperationId: data.bulkOperationRunMutation.bulkOperation.id,
    };
    await db.job.update({ where: { id: job.id }, data: { payload } });
    return false;
  }
  const data = await gql(
    admin,
    "query BulkStatus($id: ID!) { node(id: $id) { ... on BulkOperation { id status url partialDataUrl errorCode } } }",
    { id: payload.bulkOperationId },
  );
  const op = data.node;
  if (!["COMPLETED", "FAILED", "CANCELED", "EXPIRED"].includes(op.status))
    return false;
  if (op.status !== "COMPLETED")
    throw new Error(
      "Bulk operation " +
        op.status +
        ". Reconcile partial results before resuming.",
    );
  if (op.url) {
    const response = await fetch(op.url);
    if (!response.ok) throw new Error("Could not download bulk results.");
    const text = await response.text();
    for (const line of text.split("\n").filter(Boolean)) {
      const result = JSON.parse(line);
      const batch = batches[result.__lineNumber];
      if (!batch || batch.status !== "pending") continue;
      if (result.errors) throw new Error(JSON.stringify(result.errors));
      await record(batch, result.data, job.type === "undo");
    }
  }
  if (
    await db.writeBatch.count({ where: { jobId: job.id, status: "pending" } })
  )
    throw new Error("Bulk output is incomplete. Retry downloading results.");
  return true;
}
export async function runJob(shop: string, admin: Admin, id?: string) {
  const job = await db.job.findFirst({
    where: {
      shopId: shop,
      ...(id ? { id } : {}),
      OR: [
        { status: "queued" },
        { status: "running", leaseUntil: { lt: new Date() } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;
  const claimed = await db.job.updateMany({
    where: {
      id: job.id,
      OR: [
        { status: "queued" },
        { status: "running", leaseUntil: { lt: new Date() } },
      ],
    },
    data: {
      status: "running",
      leaseUntil: new Date(Date.now() + 10 * 60 * 1000),
      attempts: { increment: 1 },
      error: null,
    },
  });
  if (!claimed.count) return null;
  try {
    if (job.type === "refreshProduct") {
      await refreshProduct(shop, admin, (job.payload as any).productId);
      await db.job.update({
        where: { id: job.id },
        data: { status: "completed", progress: 100, leaseUntil: null },
      });
      return job.id;
    }
    if (!(job.payload as any).prepared) await prepare(job, admin);
    const fresh = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    const payload = fresh.payload as any;
    if (payload.bulk) {
      if (!(await bulk(fresh, admin))) {
        await db.job.update({
          where: { id: job.id },
          data: { status: "queued", leaseUntil: null },
        });
        return job.id;
      }
    } else {
      const batches = await db.writeBatch.findMany({
        where: { jobId: job.id, status: "pending" },
        orderBy: { id: "asc" },
        take: 4,
      });
      for (const batch of batches) {
        retryWindow(batch);
        if (!batch.firstSentAt)
          await db.writeBatch.update({
            where: { id: batch.id },
            data: { firstSentAt: new Date() },
          });
        const upload = await db.upload.findUniqueOrThrow({
          where: { id: job.uploadId! },
        });
        const plugin =
          job.type === "undo"
            ? actions.setQuantity
            : actions[upload.action as ActionKind];
        const changes = await db.uploadRow.findMany({
          where: { id: { in: batch.rowIds as string[] } },
        });
        const [result] = await plugin.apply(
          changes as unknown as PlannedChange[],
          async () => [
            await gql(
              admin,
              batch.mutation,
              batch.variables as Record<string, unknown>,
            ),
          ],
        );
        await record(batch, result, job.type === "undo");
      }
    }
    const all = await db.writeBatch.count({ where: { jobId: job.id } });
    const pending = await db.writeBatch.count({
      where: { jobId: job.id, status: "pending" },
    });
    const progress = all ? Math.round(((all - pending) / all) * 100) : 100;
    if (pending) {
      await db.job.update({
        where: { id: job.id },
        data: { status: "queued", leaseUntil: null, progress },
      });
      return job.id;
    }
    const rows = await db.uploadRow.findMany({
      where: { uploadId: job.uploadId! },
    });
    const errors = rows.filter(
      (r) => r.status === "error" || r.status === "undo_conflict",
    ).length;
    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: { status: "completed", leaseUntil: null, progress: 100 },
      }),
      db.upload.update({
        where: { id: job.uploadId! },
        data:
          job.type === "undo"
            ? {
                status: errors ? "partial_undo" : "undone",
                undoneAt: new Date(),
              }
            : {
                status: errors ? "partial" : "completed",
                appliedAt: new Date(),
              },
      }),
    ]);
    return job.id;
  } catch (e) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "retryable",
        leaseUntil: null,
        error: (e as Error).message,
      },
    });
    return job.id;
  }
}
export async function retryJob(shop: string, id: string) {
  const job = await db.job.findFirst({
    where: { id, shopId: shop, status: "retryable" },
  });
  if (!job) throw new Error("No paused job found.");
  const expired = await db.writeBatch.count({
    where: {
      jobId: id,
      status: "pending",
      firstSentAt: { lt: new Date(Date.now() - 23 * 60 * 60 * 1000) },
    },
  });
  if (expired)
    throw new Error(
      "Automatic retry expired. Reconcile live quantities first.",
    );
  if (job.error?.includes("Reconcile")) throw new Error(job.error);
  return db.job.update({
    where: { id },
    data: { status: "queued", error: null },
  });
}
