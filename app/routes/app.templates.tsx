import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Badge,
  Banner,
  Modal,
  EmptyState,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { context, message } from "../services/context.server";
import db from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await context(request);
  return {
    templates: await db.template.findMany({
      where: { shopId: shop },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await context(request);
  try {
    const body = await request.formData();
    const id = String(body.get("id"));
    const template = await db.template.findFirst({
      where: { id, shopId: shop },
    });
    if (!template) throw new Error("Template not found.");
    const intent = body.get("intent");
    if (intent === "delete") await db.template.delete({ where: { id } });
    else if (intent === "default")
      await db.$transaction([
        db.template.updateMany({
          where: { shopId: shop },
          data: { isDefault: false },
        }),
        db.template.update({ where: { id }, data: { isDefault: true } }),
      ]);
    else if (intent === "rename") {
      const name = String(body.get("name") || "").trim();
      if (!name || name.length > 100)
        throw new Error("Use a name between 1 and 100 characters.");
      await db.template.update({ where: { id }, data: { name } });
    } else throw new Error("Unknown action.");
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
export default function Templates() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const bridge = useAppBridge();
  const [rename, setRename] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [remove, setRemove] = useState<string | null>(null);
  useEffect(() => {
    if (fetcher.data?.ok) bridge.toast.show("Template updated");
  }, [fetcher.data, bridge]);
  const submit = (intent: string, id: string, extra = {}) =>
    fetcher.submit({ intent, id, ...extra }, { method: "POST" });
  return (
    <Page
      title="Column templates"
      subtitle="Map once. Reuse with every supplier sheet."
      primaryAction={{ content: "Upload a sheet", url: "/app/upload" }}
    >
      <BlockStack gap="400">
        {fetcher.data?.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}
        {!templates.length ? (
          <Card>
            <EmptyState
              heading="Save your first column mapping"
              action={{ content: "Upload a sheet", url: "/app/upload" }}
              image=""
            >
              <p>
                Name your mapping during an upload to use it again next time.
              </p>
            </EmptyState>
          </Card>
        ) : (
          templates.map((t) => (
            <Card key={t.id}>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="300">
                    <Text as="h2" variant="headingMd">
                      {t.name}
                    </Text>
                    {t.isDefault && <Badge tone="success">Default</Badge>}
                  </InlineStack>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => {
                        setRename(t.id);
                        setName(t.name);
                      }}
                    >
                      Rename
                    </Button>
                    {!t.isDefault && (
                      <Button onClick={() => submit("default", t.id)}>
                        Set default
                      </Button>
                    )}
                    <Button tone="critical" onClick={() => setRemove(t.id)}>
                      Delete
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Text as="p" tone="subdued">
                  {Object.entries(t.mapping as object)
                    .filter(([, v]) => v)
                    .map(([k, v]) => k + " | " + v)
                    .join(" | ")}
                </Text>
              </BlockStack>
            </Card>
          ))
        )}
        <Modal
          open={!!rename}
          onClose={() => setRename(null)}
          title="Rename template"
          primaryAction={{
            content: "Save",
            onAction: () => {
              submit("rename", rename!, { name });
              setRename(null);
            },
          }}
        >
          <Modal.Section>
            <TextField
              label="Template name"
              value={name}
              onChange={setName}
              autoComplete="off"
            />
          </Modal.Section>
        </Modal>
        <Modal
          open={!!remove}
          onClose={() => setRemove(null)}
          title="Delete this template?"
          primaryAction={{
            content: "Delete template",
            destructive: true,
            onAction: () => {
              submit("delete", remove!);
              setRemove(null);
            },
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setRemove(null) },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              This removes one saved mapping. Existing upload history will stay
              available.
            </Text>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
