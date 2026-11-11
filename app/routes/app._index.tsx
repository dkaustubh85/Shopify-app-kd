import { useDownload } from "../components/useDownload";
import { useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  InlineGrid,
  Box,
} from "@shopify/polaris";
import { context, message, settings } from "../services/context.server";
import { startSync, pollSync } from "../services/cache.server";
import db from "../db.server";
import { SheetDrop } from "../components/SheetDrop";
import { UploadList } from "../components/UploadList";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, admin, store } = await context(request);
  let error = "";
  try {
    if (store.syncStatus === "pending") await startSync(shop, admin);
    await pollSync(shop, admin);
  } catch (e) {
    error = message(e);
  }
  const current = await db.shop.findUniqueOrThrow({ where: { id: shop } });
  const config = settings(current.settings);
  const [uploads, variants, applied, all] = await Promise.all([
    db.upload.findMany({
      where: { shopId: shop },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.variantCache.count({ where: { shopId: shop } }),
    db.uploadRow.count({ where: { upload: { shopId: shop }, applied: true } }),
    db.variantCache.findMany({
      where: { shopId: shop, tracked: true },
      select: { quantities: true },
    }),
  ]);
  const low = all.filter((v) =>
    Object.values(v.quantities as object).some(
      (q) => typeof q === "number" && q <= config.lowStockThreshold,
    ),
  ).length;
  return {
    uploads,
    variants,
    applied,
    low,
    status: current.syncStatus,
    error: error || current.syncError,
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop, admin } = await context(request);
  try {
    await startSync(shop, admin);
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
export default function Dashboard() {
  const files = useDownload();
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (data.status === "running") {
      const id = setInterval(() => revalidator.revalidate(), 3000);
      return () => clearInterval(id);
    }
  }, [data.status, revalidator]);
  return (
    <Page
      title="StockSheet"
      subtitle="From spreadsheet to updated stock. Safely."
      secondaryActions={[
        {
          content: "Download sample Excel",
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
        {(data.error || fetcher.data?.error) && (
          <Banner title="Inventory sync needs attention" tone="critical">
            {data.error || fetcher.data?.error} Try syncing again.
          </Banner>
        )}
        {data.status !== "ready" && (
          <Banner
            title={
              data.status === "running"
                ? "Getting your inventory ready"
                : "Connect your inventory"
            }
            tone="info"
          >
            <p>
              {data.status === "running"
                ? "Your products are syncing in the background. You can upload a sheet while you wait."
                : "Sync your products before previewing changes."}
            </p>
          </Banner>
        )}
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          {[
            [data.variants, "Variants in your store"],
            [data.applied, "Changes applied"],
            [data.low, "At or below low-stock threshold"],
          ].map(([value, label]) => (
            <Card key={String(label)}>
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  {label}
                </Text>
                <Text as="h2" variant="heading2xl">
                  {value}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">
                    Update inventory from a sheet
                  </Text>
                  <Text as="span" tone="subdued">
                    A quick review. Complete control.
                  </Text>
                </InlineStack>
                <SheetDrop />
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Box
                  background="bg-surface-success"
                  padding="400"
                  borderRadius="300"
                >
                  <Text as="h2" variant="headingMd">
                    Review first. Apply second.
                  </Text>
                </Box>
                <Text as="p">
                  Match your products, see exactly what will change, and keep a
                  snapshot for undo.
                </Text>
                <Text as="p" tone="subdued">
                  Start with SKU and Quantity columns. Saved templates make
                  repeat uploads faster.
                </Text>
                <Button url="/app/templates">Manage templates</Button>
                <Button
                  loading={
                    fetcher.state !== "idle" || data.status === "running"
                  }
                  onClick={() => fetcher.submit({}, { method: "POST" })}
                >
                  Sync inventory
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Recent uploads
              </Text>
              <Button variant="plain" url="/app/history">
                View all history
              </Button>
            </InlineStack>
          </Box>
          <UploadList uploads={data.uploads} />
        </Card>
      </BlockStack>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
