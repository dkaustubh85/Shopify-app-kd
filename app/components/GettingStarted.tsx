import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  ProgressBar,
  Button,
  Banner,
  Box,
  List,
  DataTable,
  Thumbnail,
} from "@shopify/polaris";
import { useDownload } from "./useDownload";
const steps = [
  {
    title: "Start with a simple spreadsheet",
    body: "StockSheet matches rows in your sheet to products in your store. Start with SKU and Quantity columns. Keep SKUs and barcodes as text so leading zeros stay intact.",
    tip: "The sample contains example identifiers. Replace them with your own product SKUs before uploading.",
  },
  {
    title: "Upload your sheet",
    body: "Open Upload a sheet and drop your Excel or CSV file into the box. We will show the file name, number of rows, and detected columns.",
    tip: "Use .xlsx, .xls, or .csv, up to 10 MB. Only the first worksheet is used for inventory updates.",
  },
  {
    title: "Match columns and choose an action",
    body: "Match your SKU, Barcode, or Handle column to our fields. Choose Mark as sold out, Set exact quantity, Adjust quantity, or Update price, then select the location.",
    tip: "Save a named template when you reuse the same supplier format. Adjust quantity accepts positive or negative whole numbers.",
  },
  {
    title: "Review the preview",
    body: "Check the before and after quantities. Unmatched, ambiguous, and error rows are skipped. Use the filters and download problem rows to correct them.",
    tip: "Nothing changes in Shopify on this screen. More than 80% of tracked variants becoming sold out needs an extra acknowledgement.",
  },
  {
    title: "Confirm and apply",
    body: "Click Apply changes and confirm the number of variants. Follow the progress and live results while StockSheet saves snapshots and updates inventory.",
    tip: "If an upload pauses, read its message and use Resume safely. If inventory changed after preview, prepare a fresh preview.",
  },
  {
    title: "Download files and undo from History",
    body: "Open History, then View upload. Download your original sheet, a results CSV, or unmatched rows. Use Undo this upload to restore saved inventory quantities.",
    tip: "Undo skips stock changed by later orders or updates. Price changes cannot be undone automatically. Older uploads offer a rebuilt sheet because their original files were not retained.",
  },
];
export function GettingStarted({
  open,
  onClose,
  initialStep,
}: {
  open: boolean;
  onClose: () => void;
  initialStep: number;
}) {
  const [step, setStep] = useState(initialStep);
  const pending = useRef<"close" | "start" | null>(null);
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const navigate = useNavigate();
  const files = useDownload();
  const busy = fetcher.state !== "idle";
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setStep(initialStep);
    wasOpen.current = open;
  }, [open, initialStep]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && pending.current) {
      const action = pending.current;
      pending.current = null;
      onClose();
      if (action === "start") navigate("/app/upload");
    }
  }, [fetcher.state, fetcher.data, onClose, navigate]);
  function save(
    next: number,
    status: string,
    after: "close" | "start" | null = null,
  ) {
    pending.current = after;
    setStep(next);
    fetcher.submit(
      { step: String(next), status },
      { method: "POST", action: "/app/guide" },
    );
  }
  const current = steps[step] || steps[0];
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) save(step, "dismissed", "close");
      }}
      title="Your first upload, step by step"
      primaryAction={{
        content: step === 5 ? "Start my first upload" : "Next",
        loading: busy,
        onAction: () =>
          step === 5
            ? save(5, "completed", "start")
            : save(step + 1, "in_progress"),
      }}
      secondaryActions={[
        ...(step > 0
          ? [
              {
                content: "Back",
                disabled: busy,
                onAction: () => save(step - 1, "in_progress"),
              },
            ]
          : []),
        {
          content: "Skip for now",
          disabled: busy,
          onAction: () => save(step, "dismissed", "close"),
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="500">
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail
              source="/brand/stocksheet-icon.png"
              alt="StockSheet"
              size="small"
            />
            <Badge tone="info">
              {"Step " + (step + 1) + " of " + steps.length}
            </Badge>
          </InlineStack>
          <ProgressBar progress={((step + 1) / steps.length) * 100} />
          <BlockStack gap="300">
            <Text as="h2" variant="headingLg">
              {current.title}
            </Text>
            <Text as="p">{current.body}</Text>
          </BlockStack>
          {step === 0 && (
            <>
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["SKU", "Quantity"]}
                rows={[
                  ["YOUR-SKU-001", 12],
                  ["YOUR-SKU-002", 0],
                ]}
              />
              <Button
                loading={files.busy}
                onClick={() => files.download("/app/download?kind=sample")}
              >
                Download sample Excel
              </Button>
            </>
          )}
          {step === 2 && (
            <List>
              <List.Item>Mark as sold out: set stock to 0.</List.Item>
              <List.Item>Set exact quantity: replace current stock.</List.Item>
              <List.Item>Adjust quantity: add or subtract stock.</List.Item>
              <List.Item>
                Update price: change the base variant price.
              </List.Item>
            </List>
          )}
          {step === 3 && (
            <InlineStack gap="200">
              <Badge tone="success">Matched</Badge>
              <Badge tone="warning">Unmatched</Badge>
              <Badge>No change</Badge>
              <Badge tone="critical">Error</Badge>
            </InlineStack>
          )}
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
          >
            <Text as="p">{current.tip}</Text>
          </Box>
          <Text as="p" tone="subdued">
            You can reopen this guide from Getting started at the top of any
            page. Progress is saved for your Shopify user.
          </Text>
          {files.error && (
            <Banner tone="critical" onDismiss={files.clearError}>
              {files.error}
            </Banner>
          )}
          {fetcher.data?.error && (
            <Banner tone="critical">{fetcher.data.error}</Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
