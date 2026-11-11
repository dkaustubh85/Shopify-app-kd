import { useState, useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";
import {
  DropZone,
  BlockStack,
  Text,
  Banner,
  Spinner,
  InlineStack,
} from "@shopify/polaris";
export function SheetDrop() {
  const fetcher = useFetcher<{ id?: string; error?: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (fetcher.data?.id) navigate("/app/upload?id=" + fetcher.data.id);
  }, [fetcher.data, navigate]);
  const busy = fetcher.state !== "idle";
  return (
    <BlockStack gap="300">
      <DropZone
        accept=".xlsx,.xls,.csv"
        allowMultiple={false}
        disabled={busy}
        onDrop={(_, accepted, rejected) => {
          setError("");
          if (rejected.length) {
            setError("Choose an Excel or CSV file.");
            return;
          }
          const file = accepted[0];
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            setError("Choose a file smaller than 10 MB.");
            return;
          }
          setName(file.name);
          const body = new FormData();
          body.append("intent", "upload");
          body.append("file", file);
          fetcher.submit(body, {
            method: "POST",
            action: "/app/upload",
            encType: "multipart/form-data",
          });
        }}
      >
        <div style={{ padding: "40px 16px" }}>
          <BlockStack gap="300" inlineAlign="center">
            {busy ? (
              <InlineStack gap="300">
                <Spinner size="small" />
                <Text as="p">Reading {name}...</Text>
              </InlineStack>
            ) : (
              <>
                <DropZone.FileUpload
                  actionTitle="Choose a spreadsheet"
                  actionHint="or drop it here - XLSX, XLS, CSV - up to 10 MB"
                />
                <Text as="p" tone="subdued">
                  Your inventory stays unchanged until you review and apply.
                </Text>
              </>
            )}
          </BlockStack>
        </div>
      </DropZone>
      {(error || fetcher.data?.error) && (
        <Banner tone="critical">{error || fetcher.data?.error}</Banner>
      )}
    </BlockStack>
  );
}
