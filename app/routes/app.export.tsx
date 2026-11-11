import { activeLocation } from "../utils/input";
import { useDownload } from "../components/useDownload";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  Select,
  Button,
  Text,
  Banner,
} from "@shopify/polaris";
import { context, settings } from "../services/context.server";
import { locations } from "../services/graphql.server";
import db from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, store, admin } = await context(request);
  return {
    templates: await db.template.findMany({
      where: { shopId: shop },
      orderBy: { name: "asc" },
    }),
    locations: await locations(admin),
    config: settings(store.settings),
    ready: store.syncStatus === "ready",
  };
}
export default function Export() {
  const files = useDownload();
  const data = useLoaderData<typeof loader>();
  const [template, setTemplate] = useState("");
  const [location, setLocation] = useState(
    activeLocation(data.config.locationId, data.locations),
  );
  return (
    <Page
      title="Export inventory"
      subtitle="Download stock in the same format you upload."
    >
      <Card>
        <BlockStack gap="400">
          {files.error && (
            <Banner tone="critical" onDismiss={files.clearError}>
              {files.error}
            </Banner>
          )}
          <Text as="h2" variant="headingMd">
            Your inventory, ready for Excel
          </Text>
          <Text as="p">
            Exports use your synced inventory cache. Sync from the dashboard for
            the latest values.
          </Text>
          {!data.ready && (
            <Banner tone="warning">
              Wait for the initial inventory sync to finish.
            </Banner>
          )}
          <Select
            label="Column format"
            options={[
              { label: "Standard StockSheet columns", value: "" },
              ...data.templates.map((t) => ({ label: t.name, value: t.id })),
            ]}
            value={template}
            onChange={setTemplate}
          />
          <Select
            label="Location"
            options={data.locations.map((l) => ({
              label: l.name,
              value: l.id,
            }))}
            value={location}
            onChange={setLocation}
          />
          <Button
            variant="primary"
            disabled={!data.ready || !location}
            loading={files.busy}
            onClick={() =>
              files.download(
                "/app/download?kind=export&template=" +
                  encodeURIComponent(template) +
                  "&location=" +
                  encodeURIComponent(location),
              )
            }
          >
            Download Excel
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
