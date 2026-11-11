import { pageNumber } from "../utils/input";
import { useDownload } from "../components/useDownload";
import { useState, useEffect } from "react";
import {
  data,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Banner,
  Badge,
  IndexTable,
  Button,
  Modal,
  ProgressBar,
  Pagination,
  Checkbox,
} from "@shopify/polaris";
import { context, message } from "../services/context.server";
import { enqueueUpload, runJob, retryJob } from "../services/jobs.server";
import db from "../db.server";
import { requiresZeroAcknowledgement } from "../pipeline/preview";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { shop } = await context(request);
  const page = pageNumber(new URL(request.url).searchParams.get("page"));
  const upload = await db.upload.findFirst({
    where: { id: params.id, shopId: shop },
    include: { file: { select: { uploadId: true } } },
  });
  if (!upload) throw new Response("Upload not found", { status: 404 });
  const [rows, count, eligible, zero, tracked, job, success, errors] =
    await Promise.all([
      db.uploadRow.findMany({
        where: { uploadId: upload.id },
        orderBy: { rowIndex: "asc" },
        take: 50,
        skip: (page - 1) * 50,
      }),
      db.uploadRow.count({ where: { uploadId: upload.id } }),
      db.uploadRow.count({
        where: { uploadId: upload.id, applied: true, undone: false },
      }),
      db.uploadRow.count({
        where: {
          uploadId: upload.id,
          applied: true,
          undone: false,
          previousQty: 0,
          newQty: { not: 0 },
        },
      }),
      db.variantCache.count({ where: { shopId: shop, tracked: true } }),
      db.job.findFirst({
        where: { uploadId: upload.id },
        orderBy: { createdAt: "desc" },
      }),
      db.uploadRow.count({ where: { uploadId: upload.id, applied: true } }),
      db.uploadRow.count({
        where: {
          uploadId: upload.id,
          status: { in: ["error", "undo_conflict"] },
        },
      }),
    ]);
  return data({
    upload,
    rows,
    count,
    eligible,
    ackRequired: requiresZeroAcknowledgement(zero, tracked),
    job,
    page,
    success,
    errors,
  });
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { shop, admin } = await context(request);
  const form = await request.formData();
  try {
    const intent = form.get("intent");
    const upload = await db.upload.findFirst({
      where: { id: params.id, shopId: shop },
    });
    if (!upload) throw new Error("Upload not found.");
    if (intent === "undo")
      await enqueueUpload(
        shop,
        upload.id,
        "undo",
        form.get("ack") === "true",
        form.get("confirmed") === "true",
      );
    else if (intent === "work") await runJob(shop, admin);
    else if (intent === "retry")
      await retryJob(shop, String(form.get("jobId")));
    else throw new Error("Unknown action.");
    return { ok: true, error: "" };
  } catch (e) {
    return data({ ok: false, error: message(e) }, { status: 400 });
  }
}
export default function Detail() {
  const files = useDownload();
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [, setParams] = useSearchParams();
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const running = ["queued", "undo_queued"].includes(data.upload.status);
  useEffect(() => {
    if (!running || data.job?.status === "retryable") return;
    const timer = setInterval(() => {
      if (fetcher.state === "idle")
        fetcher.submit({ intent: "work" }, { method: "POST" });
    }, 2500);
    return () => clearInterval(timer);
  }, [running, fetcher, data.job?.status]);
  return (
    <Page
      title={data.upload.fileName}
      subtitle={
        "Uploaded by " +
        data.upload.staffName +
        " | " +
        new Date(data.upload.createdAt).toLocaleString("en-CA", {
          timeZone: "America/Toronto",
        })
      }
      backAction={{ url: "/app/history" }}
    >
      <BlockStack gap="400">
        {files.error && (
          <Banner tone="critical" onDismiss={files.clearError}>
            {files.error}
          </Banner>
        )}
        <Card>
          <BlockStack gap="400">
            <Badge
              tone={
                data.errors
                  ? "warning"
                  : ["completed", "undone"].includes(data.upload.status)
                    ? "success"
                    : "info"
              }
            >
              {data.upload.status.replaceAll("_", " ")}
            </Badge>
            <Text as="h2" variant="headingMd">
              {data.success} applied | {data.errors} errors | {data.count} sheet
              rows
            </Text>
            <Button
              loading={files.busy}
              onClick={() =>
                files.download(
                  "/app/download?kind=upload&id=" +
                    encodeURIComponent(data.upload.id),
                )
              }
            >
              {data.upload.file
                ? "Download original sheet"
                : "Download rebuilt Excel"}
            </Button>
            <Button
              loading={files.busy}
              onClick={() =>
                files.download(
                  "/app/download?kind=results&id=" +
                    encodeURIComponent(data.upload.id),
                )
              }
            >
              Download results CSV
            </Button>
            {!data.upload.file && (
              <Text as="p" tone="subdued">
                This older upload has saved rows only. The rebuilt workbook
                contains those rows; original formatting and other worksheets
                are unavailable.
              </Text>
            )}
            {["draft", "preview"].includes(data.upload.status) && (
              <Button
                variant="primary"
                url={"/app/upload?id=" + data.upload.id}
              >
                Continue upload
              </Button>
            )}
            {data.eligible > 0 &&
              data.upload.action !== "setPrice" &&
              ["completed", "partial", "failed"].includes(
                data.upload.status,
              ) && (
                <Button tone="critical" onClick={() => setConfirm(true)}>
                  {"Undo this upload (" + data.eligible + " variants)"}
                </Button>
              )}
            {data.upload.action === "setPrice" && (
              <Text as="p" tone="subdued">
                Price snapshots are recorded. Automatic price undo is
                unavailable because Shopify cannot protect against concurrent
                price changes.
              </Text>
            )}
            {running && (
              <>
                <ProgressBar progress={data.job?.progress || 0} />
                <Text as="p">{data.job?.progress || 0}% processed</Text>
              </>
            )}
            {data.job?.status === "retryable" && (
              <Banner tone="critical" title="Job paused">
                <p>{data.job.error}</p>
                <Button
                  loading={fetcher.state !== "idle"}
                  onClick={() =>
                    fetcher.submit(
                      { intent: "retry", jobId: String(data.job!.id) },
                      { method: "POST" },
                    )
                  }
                >
                  Resume safely
                </Button>
              </Banner>
            )}
          </BlockStack>
        </Card>
        {fetcher.data?.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}
        <Card padding="0">
          <IndexTable
            itemCount={data.rows.length}
            selectable={false}
            headings={[
              { title: "Row" },
              { title: "Product / variant" },
              { title: "Match" },
              { title: "Before / after" },
              { title: "Result" },
            ]}
          >
            {data.rows.map((r, i) => (
              <IndexTable.Row key={r.id} id={r.id} position={i}>
                <IndexTable.Cell>{r.rowIndex}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="p" fontWeight="semibold">
                    {r.productTitle ||
                      (r.status === "draft" ? "Not previewed" : "Unmatched")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {r.variantTitle}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{r.matchKey}</IndexTable.Cell>
                <IndexTable.Cell>
                  {r.status === "draft"
                    ? "Not previewed"
                    : data.upload.action === "setPrice"
                      ? `${r.previousPrice ?? "-"} to ${r.newPrice ?? "-"}`
                      : `${r.previousQty ?? "-"} to ${r.newQty ?? "-"}`}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Badge
                      tone={
                        r.status === "success" || r.status === "undone"
                          ? "success"
                          : r.status.includes("error") ||
                              r.status === "undo_conflict"
                            ? "critical"
                            : "info"
                      }
                    >
                      {r.status.replaceAll("_", " ")}
                    </Badge>
                    {r.errorMessage && (
                      <Text as="p" breakWord>
                        {r.errorMessage}
                      </Text>
                    )}
                  </BlockStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>
        <Pagination
          hasPrevious={data.page > 1}
          hasNext={data.page * 50 < data.count}
          onPrevious={() => setParams({ page: String(data.page - 1) })}
          onNext={() => setParams({ page: String(data.page + 1) })}
          label={"Page " + data.page}
        />
        <Modal
          open={confirm}
          onClose={() => setConfirm(false)}
          title={"Restore quantities for " + data.eligible + " variants?"}
          primaryAction={{
            content: "Undo upload",
            destructive: true,
            disabled: data.ackRequired && !ack,
            onAction: () => {
              setConfirm(false);
              fetcher.submit(
                { intent: "undo", ack: String(ack), confirmed: "true" },
                { method: "POST" },
              );
            },
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setConfirm(false) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                We will restore each successful row to its saved quantity. If
                stock has changed since this upload, that row will be skipped.
              </Text>
              {data.ackRequired && (
                <Checkbox
                  label="I understand: this undo will set more than 80% of tracked variants to zero."
                  checked={ack}
                  onChange={setAck}
                />
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
