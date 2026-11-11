import { activeLocation, pageNumber } from "../utils/input";

import { useDownload } from "../components/useDownload";
import { createHash } from "node:crypto";
import { fileType } from "../services/downloads.server";
import { readUploadForm } from "../pipeline/sources/upload.server";
import { useState, useEffect } from "react";
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useSearchParams,
} from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Select,
  TextField,
  Button,
  Banner,
  RadioButton,
  Checkbox,
  Modal,
  ProgressBar,
  IndexTable,
  Thumbnail,
  Pagination,
  InlineGrid,
  Box,
} from "@shopify/polaris";
import { context, message, settings } from "../services/context.server";
import db from "../db.server";
import { locations } from "../services/graphql.server";
import { parseSheet } from "../pipeline/parsers/sheet";
import {
  preview,
  totals,
  requiresZeroAcknowledgement,
} from "../pipeline/preview";
import type { Mapping, ActionKind, SheetRow } from "../pipeline/types";
import { actions } from "../pipeline/actions";
import { enqueueUpload, runJob, retryJob } from "../services/jobs.server";
import { SheetDrop } from "../components/SheetDrop";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, admin, store } = await context(request);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const filter = url.searchParams.get("filter") || "all";
  const page = pageNumber(url.searchParams.get("page"));
  const upload = id
    ? await db.upload.findFirst({ where: { id, shopId: shop } })
    : null;
  if (id && !upload) throw new Response("Upload not found", { status: 404 });
  const status =
    filter === "changing"
      ? "matched"
      : filter === "unmatched"
        ? "unmatched"
        : filter === "errors"
          ? "error"
          : undefined;
  const where = { uploadId: upload?.id || "", ...(status ? { status } : {}) };
  const [rows, count, templates, locs, tracked, job] = await Promise.all([
    upload
      ? db.uploadRow.findMany({
          where,
          orderBy: { rowIndex: "asc" },
          skip: (page - 1) * 50,
          take: 50,
        })
      : Promise.resolve([] as import("@prisma/client").UploadRow[]),
    upload ? db.uploadRow.count({ where }) : 0,
    db.template.findMany({
      where: { shopId: shop },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    locations(admin),
    db.variantCache.count({ where: { shopId: shop, tracked: true } }),
    upload
      ? db.job.findFirst({
          where: { uploadId: upload.id },
          orderBy: { createdAt: "desc" },
        })
      : null,
  ]);
  const first = upload
    ? await db.uploadRow.findFirst({
        where: { uploadId: upload.id },
        orderBy: { rowIndex: "asc" },
      })
    : null;
  const [appliedRows, errorRows] = await Promise.all([
    db.uploadRow.count({
      where: { uploadId: upload?.id || "", applied: true },
    }),
    db.uploadRow.count({
      where: {
        uploadId: upload?.id || "",
        status: { in: ["error", "undo_conflict"] },
      },
    }),
  ]);
  return data({
    live: { applied: appliedRows, errors: errorRows },
    upload,
    rows,
    count,
    templates,
    locations: locs,
    config: settings(store.settings),
    cacheReady: store.syncStatus === "ready",
    headers: first ? Object.keys(first.source as object) : [],
    tracked,
    job,
    page,
    filter,
  });
}
export async function action({ request }: ActionFunctionArgs) {
  const ctx = await context(request);
  try {
    const body = await readUploadForm(request);
    const intent = String(body.get("intent"));
    if (intent === "upload") {
      const file = body.get("file");
      if (!file || typeof file === "string")
        throw new Error("Choose a sheet to upload.");
      const contents = new Uint8Array(await file.arrayBuffer());
      const parsed = parseSheet(contents, file.name);
      const template = await db.template.findFirst({
        where: { shopId: ctx.shop, isDefault: true },
      });
      const mapping = template?.mapping || parsed.mapping;
      const upload = await db.upload.create({
        data: {
          shopId: ctx.shop,
          fileName: file.name,
          staffName: ctx.staff,
          action: "soldOut",
          locationId: "",
          mapping,
          templateId: template?.id,
          totals: { rows: parsed.rows.length },
          file: {
            create: {
              contents,
              mimeType: fileType(file.name),
              sha256: createHash("sha256").update(contents).digest("hex"),
            },
          },
          rows: {
            create: parsed.rows.map((source, i) => ({
              rowIndex: i + 2,
              source,
              matchKey: "",
              status: "draft",
            })),
          },
        },
      });
      return data({ id: upload.id, error: "" });
    }
    const id = String(body.get("id"));
    const upload = await db.upload.findFirst({
      where: { id, shopId: ctx.shop },
    });
    if (!upload) throw new Error("Upload not found.");
    if (intent === "preview") {
      if (!["draft", "preview"].includes(upload.status))
        throw new Error("This upload has already been applied.");
      if (ctx.store.syncStatus !== "ready")
        throw new Error("Wait for inventory sync to finish on the dashboard.");
      const mapping = JSON.parse(String(body.get("mapping"))) as Mapping;
      const kind = String(body.get("action")) as ActionKind;
      if (!Object.hasOwn(actions, kind))
        throw new Error("Choose a valid action.");
      const sourceRows = await db.uploadRow.findMany({
        where: { uploadId: id },
        orderBy: { rowIndex: "asc" },
      });
      const headers = Object.keys(sourceRows[0].source as object);
      for (const [key, column] of Object.entries(mapping)) {
        if (
          ![
            "sku",
            "barcode",
            "handle",
            "option1",
            "option2",
            "option3",
            "quantity",
            "price",
          ].includes(key) ||
          typeof column !== "string" ||
          (column && !headers.includes(column))
        )
          throw new Error("Choose columns from this sheet.");
      }
      if (!mapping.sku && !mapping.barcode && !mapping.handle)
        throw new Error(
          "Map at least one identifier: SKU, barcode, or handle.",
        );
      const locationId = String(body.get("location"));
      if (!(await locations(ctx.admin)).some((l) => l.id === locationId))
        throw new Error("Choose an active location.");
      const config = settings(ctx.store.settings);
      const priority = [
        config.matchKey,
        ...["sku", "barcode", "handle"].filter((k) => k !== config.matchKey),
      ];
      const variants = await db.variantCache.findMany({
        where: { shopId: ctx.shop },
      });
      const planned = preview(
        sourceRows.map((r) => r.source as SheetRow),
        mapping,
        kind,
        variants,
        locationId,
        priority,
      );
      const summary = totals(planned);
      await db.$transaction(
        async (tx) => {
          const changed = await tx.upload.updateMany({
            where: {
              id,
              shopId: ctx.shop,
              status: { in: ["draft", "preview"] },
            },
            data: {
              mapping,
              action: kind,
              locationId,
              status: "preview",
              totals: summary,
            },
          });
          if (!changed.count)
            throw new Error("This upload changed in another tab. Reload it.");
          await tx.uploadRow.deleteMany({ where: { uploadId: id } });
          await tx.uploadRow.createMany({
            data: planned.map((r) => ({ ...r, uploadId: id })),
          });
        },
        { timeout: 60000 },
      );
      const templateName = String(body.get("templateName") || "").trim();
      if (templateName)
        await db.template.create({
          data: { shopId: ctx.shop, name: templateName.slice(0, 100), mapping },
        });
      return data({ id, error: "" });
    }
    if (intent === "apply") {
      await enqueueUpload(
        ctx.shop,
        id,
        "apply",
        body.get("ack") === "true",
        body.get("confirmed") === "true",
      );
      return data({ id, error: "" });
    }
    if (intent === "work") {
      await runJob(ctx.shop, ctx.admin);
      return data({ id, error: "" });
    }
    if (intent === "retry") {
      await retryJob(ctx.shop, String(body.get("jobId")));
      return data({ id, error: "" });
    }
    if (intent === "edit") {
      await db.upload.updateMany({
        where: { id, shopId: ctx.shop, status: "preview" },
        data: { status: "draft" },
      });
      return data({ id, error: "" });
    }
    throw new Error("Unknown action.");
  } catch (e) {
    return data({ id: undefined, error: message(e) }, { status: 400 });
  }
}
const fields = [
  "sku",
  "barcode",
  "handle",
  "option1",
  "option2",
  "option3",
  "quantity",
  "price",
] as const;
export default function Upload() {
  const files = useDownload();
  const data = useLoaderData<typeof loader>();
  const { upload } = data;
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [mapping, setMapping] = useState<Mapping>(
    (upload?.mapping || {}) as Mapping,
  );
  const [kind, setKind] = useState<ActionKind>(
    (upload?.action as ActionKind) || "soldOut",
  );
  const [location, setLocation] = useState(
    activeLocation(
      upload?.locationId || data.config.locationId,
      data.locations,
    ),
  );
  const [template, setTemplate] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [ack, setAck] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setMapping((upload?.mapping || {}) as Mapping);
    setKind((upload?.action as ActionKind) || "soldOut");
    setLocation(
      activeLocation(
        upload?.locationId || data.config.locationId,
        data.locations,
      ),
    );
  }, [upload?.id, upload?.mapping, upload?.action]);
  const running = !!upload && ["queued", "undo_queued"].includes(upload.status);
  const done =
    !!upload &&
    ["completed", "partial", "undone", "partial_undo"].includes(upload.status);
  useEffect(() => {
    if (!running || data.job?.status === "retryable") return;
    const timer = setInterval(() => {
      if (fetcher.state === "idle")
        fetcher.submit({ intent: "work", id: upload!.id }, { method: "POST" });
    }, 2500);
    return () => clearInterval(timer);
  }, [running, fetcher, upload, data.job?.status]);
  const summary = (upload?.totals || {}) as any;
  const step = !upload
    ? 0
    : upload.status === "draft"
      ? 1
      : upload.status === "preview"
        ? 3
        : done
          ? 5
          : 4;
  const options = [
    { label: "Do not use", value: "" },
    ...data.headers.map((h) => ({ label: h, value: h })),
  ];
  const dangerous = requiresZeroAcknowledgement(
    summary.soldOut || 0,
    data.tracked,
  );
  const busy = fetcher.state !== "idle";
  const send = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, id: upload!.id, ...extra }, { method: "POST" });
  return (
    <Page
      title="Upload a sheet"
      backAction={{ url: "/app" }}
      subtitle="A few simple steps. Every change reviewed."
      secondaryActions={[
        {
          content: "Sample Excel",
          onAction: () => files.download("/app/download?kind=sample"),
          loading: files.busy,
        },
      ]}
    >
      <BlockStack gap="500">
        {files.error && (
          <Banner tone="critical" onDismiss={files.clearError}>
            {files.error}
          </Banner>
        )}
        <Card>
          <InlineStack gap="400" align="space-between">
            {[
              "Upload",
              "Map columns",
              "Choose action",
              "Preview",
              "Apply",
              "Done",
            ].map((label, i) => (
              <InlineStack gap="200" key={label}>
                <Badge tone={i <= step ? "success" : undefined}>
                  {String(i + 1)}
                </Badge>
                <Text
                  as="span"
                  fontWeight={i === step ? "semibold" : "regular"}
                  tone={i > step ? "subdued" : undefined}
                >
                  {label}
                </Text>
              </InlineStack>
            ))}
          </InlineStack>
        </Card>
        {fetcher.data?.error && (
          <Banner tone="critical" title="Changes were not completed">
            {fetcher.data.error}
          </Banner>
        )}
        {!upload ? (
          <Card>
            <SheetDrop />
          </Card>
        ) : (
          <>
            <InlineStack gap="300">
              <Text as="h2" variant="headingMd">
                {upload.fileName}
              </Text>
              <Badge>{String(summary.rows || data.count) + " rows"}</Badge>
            </InlineStack>
            {upload.status === "draft" && (
              <>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      Match your columns
                    </Text>
                    <Text as="p" tone="subdued">
                      We found {data.headers.length} columns. Check the
                      suggestions below. Use a unique SKU whenever possible.
                    </Text>
                    <Select
                      label="Saved template"
                      options={[
                        { label: "Choose a template", value: "" },
                        ...data.templates.map((t) => ({
                          label: t.name,
                          value: t.id,
                        })),
                      ]}
                      value={template}
                      onChange={(value) => {
                        setTemplate(value);
                        const t = data.templates.find((t) => t.id === value);
                        if (t) setMapping(t.mapping as Mapping);
                      }}
                    />
                    <InlineGrid columns={{ xs: 1, md: 2, lg: 4 }} gap="400">
                      {fields.map((field) => (
                        <Select
                          key={field}
                          label={
                            {
                              sku: "SKU",
                              barcode: "Barcode",
                              handle: "Handle",
                              option1: "Option 1",
                              option2: "Option 2",
                              option3: "Option 3",
                              quantity: "Quantity",
                              price: "Price",
                            }[field]
                          }
                          options={options}
                          value={mapping[field] || ""}
                          onChange={(v) =>
                            setMapping({ ...mapping, [field]: v })
                          }
                          helpText={
                            data.rows[0] && mapping[field]
                              ? "Example: " +
                                String(
                                  (data.rows[0].source as SheetRow)[
                                    mapping[field]!
                                  ] || "blank",
                                )
                              : undefined
                          }
                        />
                      ))}
                    </InlineGrid>
                    <TextField
                      label="Save this mapping as a template (optional)"
                      value={templateName}
                      onChange={setTemplateName}
                      autoComplete="off"
                      placeholder="Supplier A weekly sheet"
                    />
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      What would you like to do?
                    </Text>
                    {(
                      Object.entries(actions) as [
                        ActionKind,
                        { label: string },
                      ][]
                    ).map(([key, value]) => (
                      <Box
                        key={key}
                        padding="300"
                        borderWidth="025"
                        borderColor="border"
                        borderRadius="200"
                      >
                        <RadioButton
                          label={value.label}
                          name="action"
                          checked={kind === key}
                          onChange={() => setKind(key)}
                          helpText={
                            {
                              soldOut:
                                "Set matched variants to zero at the selected location.",
                              setQuantity:
                                "Replace stock with the Quantity column.",
                              adjust:
                                "Add or subtract the Quantity column from current stock.",
                              setPrice:
                                "Set the base price from the Price column. Price changes cannot be safely undone.",
                            }[key]
                          }
                        />
                      </Box>
                    ))}
                    <Select
                      label="Inventory location"
                      options={data.locations.map((l) => ({
                        label: l.name,
                        value: l.id,
                      }))}
                      value={location}
                      onChange={setLocation}
                    />
                    {!data.cacheReady && (
                      <Banner tone="warning">
                        Inventory is syncing. Return to the dashboard to check
                        progress before previewing.
                      </Banner>
                    )}
                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        loading={busy}
                        disabled={!data.cacheReady || !location}
                        onClick={() =>
                          send("preview", {
                            mapping: JSON.stringify(mapping),
                            action: kind,
                            location,
                            templateName,
                          })
                        }
                      >
                        Preview changes
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </>
            )}
            {upload.status === "preview" && (
              <>
                <Banner
                  tone={summary.errors ? "warning" : "info"}
                  title={
                    summary.matched +
                    " matched | " +
                    summary.unmatched +
                    " unmatched | " +
                    summary.soldOut +
                    " will become sold out | " +
                    summary.errors +
                    " errors"
                  }
                >
                  <p>
                    Nothing has changed in Shopify. Unmatched and error rows
                    will be skipped.
                  </p>
                </Banner>
                <Card padding="0">
                  <Box padding="400">
                    <InlineStack align="space-between" gap="300">
                      <Select
                        label="Show rows"
                        labelHidden
                        options={[
                          { label: "All rows", value: "all" },
                          { label: "Only changing", value: "changing" },
                          { label: "Only unmatched", value: "unmatched" },
                          { label: "Only errors", value: "errors" },
                        ]}
                        value={data.filter}
                        onChange={(filter) =>
                          setParams({ id: upload.id, filter, page: "1" })
                        }
                      />
                      <Button
                        onClick={() =>
                          files.download(
                            "/app/download?kind=unmatched&id=" +
                              encodeURIComponent(upload.id),
                          )
                        }
                        loading={files.busy}
                      >
                        Download unmatched CSV
                      </Button>
                    </InlineStack>
                  </Box>
                  <IndexTable
                    resourceName={{ singular: "row", plural: "rows" }}
                    itemCount={data.rows.length}
                    selectable={false}
                    headings={[
                      { title: "Product" },
                      { title: "SKU / match" },
                      { title: kind === "setPrice" ? "Price" : "Quantity" },
                      { title: "Status" },
                    ]}
                  >
                    {data.rows.map((r, i) => (
                      <IndexTable.Row id={r.id} key={r.id} position={i}>
                        <IndexTable.Cell>
                          <InlineStack gap="300" blockAlign="center">
                            {r.imageUrl && (
                              <Thumbnail
                                source={r.imageUrl}
                                alt={r.productTitle}
                                size="small"
                              />
                            )}
                            <BlockStack gap="100">
                              <Text as="span" fontWeight="semibold">
                                {r.productTitle || "Sheet row " + r.rowIndex}
                              </Text>
                              <Text as="span" tone="subdued">
                                {r.variantTitle}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{r.matchKey || "?"}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {kind === "setPrice"
                            ? r.previousPrice
                            : r.previousQty}{" "}
                          to {kind === "setPrice" ? r.newPrice : r.newQty}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Badge
                              tone={
                                r.status === "matched"
                                  ? "success"
                                  : r.status === "error"
                                    ? "critical"
                                    : r.status === "unmatched"
                                      ? "warning"
                                      : undefined
                              }
                            >
                              {r.status.replace("_", " ")}
                            </Badge>
                            {r.errorMessage && (
                              <Text as="span" tone="subdued" breakWord>
                                {r.errorMessage}
                              </Text>
                            )}
                          </BlockStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                  <Box padding="400">
                    <Pagination
                      hasPrevious={data.page > 1}
                      hasNext={data.page * 50 < data.count}
                      onPrevious={() => {
                        params.set("page", String(data.page - 1));
                        setParams(params);
                      }}
                      onNext={() => {
                        params.set("page", String(data.page + 1));
                        setParams(params);
                      }}
                      label={"Page " + data.page + " | " + data.count + " rows"}
                    />
                  </Box>
                </Card>
                {dangerous && (
                  <Banner
                    tone="critical"
                    title="Most of your store will become sold out"
                  >
                    <Checkbox
                      label="I understand: more than 80% of tracked variants will be set to zero."
                      checked={ack}
                      onChange={setAck}
                    />
                  </Banner>
                )}
                <InlineStack align="space-between">
                  <Button onClick={() => send("edit")}>
                    Edit mapping or action
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!summary.changing || (dangerous && !ack)}
                    loading={busy}
                    onClick={() => setConfirm(true)}
                  >
                    Apply {summary.changing} changes
                  </Button>
                </InlineStack>
              </>
            )}
            {running && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    Applying your changes
                  </Text>
                  <ProgressBar progress={data.job?.progress || 0} />
                  <Text as="p">
                    {data.job?.progress || 0}% processed | {data.live.applied}{" "}
                    updated | {data.live.errors} errors. Your snapshots are
                    saved before any write.
                  </Text>
                  {data.job?.status === "retryable" && (
                    <Banner tone="critical" title="This upload is paused">
                      <p>{data.job.error}</p>
                      <Button
                        onClick={() => send("retry", { jobId: data.job!.id })}
                        loading={busy}
                      >
                        Resume safely
                      </Button>
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            )}
            {done && (
              <Card>
                <BlockStack gap="400">
                  <Badge
                    tone={upload.status === "completed" ? "success" : "info"}
                  >
                    {upload.status.replaceAll("_", " ")}
                  </Badge>
                  <Text as="h2" variant="headingLg">
                    Your upload is processed
                  </Text>
                  <Text as="p">
                    {data.live.applied} variants updated | {data.live.errors}{" "}
                    errors. Review every result in the change log. Quantity
                    snapshots are available for undo.
                  </Text>
                  <InlineStack gap="300">
                    <Button variant="primary" url={"/app/history/" + upload.id}>
                      View results and undo
                    </Button>
                    <Button onClick={() => navigate("/app/upload")}>
                      Upload another sheet
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </>
        )}
        <Modal
          open={confirm}
          onClose={() => setConfirm(false)}
          title={"Apply changes to " + summary.changing + " variants?"}
          primaryAction={{
            content: "Apply changes",
            loading: busy,
            onAction: () => {
              setConfirm(false);
              send("apply", { ack: String(ack), confirmed: "true" });
            },
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setConfirm(false) },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              This will update {summary.changing} variants in Shopify. We will
              save their previous quantities first.{" "}
              {kind === "setPrice"
                ? "Price updates cannot be undone automatically."
                : "Undo will protect any newer inventory changes."}
            </Text>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
