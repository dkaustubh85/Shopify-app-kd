import { useDownload } from "./useDownload";

import {
  Banner,
  BlockStack,
  IndexTable,
  Text,
  Badge,
  Button,
  EmptyState,
} from "@shopify/polaris";
export function UploadList({ uploads }: { uploads: any[] }) {
  const files = useDownload();
  if (!uploads.length)
    return (
      <EmptyState
        heading="Your first upload starts here"
        action={{ content: "Upload a sheet", url: "/app/upload" }}
        image=""
      >
        <p>
          Try the sample sheet, review the changes, then apply when you are
          ready.
        </p>
      </EmptyState>
    );
  return (
    <BlockStack gap="300">
      {files.error && (
        <Banner tone="critical" onDismiss={files.clearError}>
          {files.error}
        </Banner>
      )}
      <IndexTable
        resourceName={{ singular: "upload", plural: "uploads" }}
        itemCount={uploads.length}
        selectable={false}
        headings={[
          { title: "File" },
          { title: "Date" },
          { title: "Action" },
          { title: "Variants" },
          { title: "Status" },
          { title: "Details" },
          { title: "Sheet" },
        ]}
      >
        {uploads.map((u, i) => (
          <IndexTable.Row id={u.id} key={u.id} position={i}>
            <IndexTable.Cell>
              <Text as="span" fontWeight="semibold">
                {u.fileName}
              </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
              {new Date(u.createdAt).toLocaleDateString("en-CA", {
                timeZone: "America/Toronto",
              })}
            </IndexTable.Cell>
            <IndexTable.Cell>
              {
                {
                  soldOut: "Mark as sold out",
                  setQuantity: "Set quantity",
                  adjust: "Adjust quantity",
                  setPrice: "Update price",
                }[u.action as string]
              }
            </IndexTable.Cell>
            <IndexTable.Cell>{u.totals?.changing || 0}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge
                tone={
                  u.status === "completed" || u.status === "undone"
                    ? "success"
                    : u.status.includes("partial")
                      ? "warning"
                      : "info"
                }
              >
                {u.status.replaceAll("_", " ")}
              </Badge>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Button url={"/app/history/" + u.id} variant="plain">
                View upload
              </Button>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Button
                variant="plain"
                loading={files.busy}
                onClick={() =>
                  files.download(
                    "/app/download?kind=upload&id=" + encodeURIComponent(u.id),
                  )
                }
              >
                Download sheet
              </Button>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
    </BlockStack>
  );
}
