import { activeLocation } from "../utils/input";
import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  Select,
  TextField,
  Button,
  Banner,
  Text,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { context, message, settings } from "../services/context.server";
import { locations } from "../services/graphql.server";
import db from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, store } = await context(request);
  return {
    config: settings(store.settings),
    locations: await locations(admin),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop, admin } = await context(request);
  try {
    const f = await request.formData();
    const locationId = String(f.get("locationId"));
    const matchKey = String(f.get("matchKey"));
    const lowStockThreshold = Number(f.get("lowStockThreshold"));
    const notificationEmail = String(f.get("notificationEmail") || "").trim();
    if (!(await locations(admin)).some((l) => l.id === locationId))
      throw new Error("Choose an active location.");
    if (!["sku", "barcode", "handle"].includes(matchKey))
      throw new Error("Choose a valid match key.");
    if (
      !Number.isInteger(lowStockThreshold) ||
      lowStockThreshold < 0 ||
      lowStockThreshold > 1000000000
    )
      throw new Error("Use a non-negative whole-number threshold.");
    if (
      notificationEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)
    )
      throw new Error("Enter a valid email address.");
    await db.shop.update({
      where: { id: shop },
      data: {
        settings: {
          locationId,
          matchKey,
          lowStockThreshold,
          notificationEmail,
        },
      },
    });
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
export default function Settings() {
  const { config, locations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const bridge = useAppBridge();
  const [locationId, setLocation] = useState(
    activeLocation(config.locationId, locations),
  );
  const [matchKey, setKey] = useState(config.matchKey);
  const [threshold, setThreshold] = useState(String(config.lowStockThreshold));
  const [email, setEmail] = useState(config.notificationEmail);
  useEffect(() => {
    if (fetcher.data?.ok) bridge.toast.show("Settings saved");
  }, [fetcher.data, bridge]);
  return (
    <Page title="Settings" subtitle="Set the defaults for your next upload.">
      <Card>
        <BlockStack gap="400">
          {fetcher.data?.error && (
            <Banner tone="critical">{fetcher.data.error}</Banner>
          )}
          <Select
            label="Default location"
            options={locations.map((l) => ({ label: l.name, value: l.id }))}
            value={locationId}
            onChange={setLocation}
          />
          <Select
            label="Try this match key first"
            options={[
              { label: "SKU", value: "sku" },
              { label: "Barcode", value: "barcode" },
              { label: "Handle and options", value: "handle" },
            ]}
            value={matchKey}
            onChange={setKey}
            helpText="We fall back to other mapped identifiers when there is no match. Ambiguous rows are always skipped."
          />
          <TextField
            label="Low-stock threshold"
            type="number"
            value={threshold}
            onChange={setThreshold}
            autoComplete="off"
            min={0}
          />
          <TextField
            label="Notification email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            helpText="Saved for future notification support. This version does not send email."
          />
          <Text as="p" tone="subdued">
            Every upload requires a preview and confirmation before changing
            Shopify.
          </Text>
          <Button
            variant="primary"
            loading={fetcher.state !== "idle"}
            onClick={() =>
              fetcher.submit(
                {
                  locationId,
                  matchKey,
                  lowStockThreshold: threshold,
                  notificationEmail: email,
                },
                { method: "POST" },
              )
            }
          >
            Save settings
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
