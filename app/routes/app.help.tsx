import type { LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Button, List } from "@shopify/polaris";
import { context } from "../services/context.server";
export async function loader({ request }: LoaderFunctionArgs) {
  await context(request);
  return null;
}
export { headers } from "../utils/shopify-headers.server";
export default function Help() {
  return (
    <Page
      title="Help and support"
      subtitle="A clear path from your spreadsheet to updated stock."
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Start your first update
            </Text>
            <Text as="p">
              Open Getting started at the top of any page for the six-step
              guide. Download the sample and replace the example SKUs with
              products from your store.
            </Text>
            <Button url="/app/upload">Upload a sheet</Button>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Common questions
            </Text>
            <List>
              <List.Item>
                Excel .xlsx, .xls and CSV files are supported, up to 10 MB and
                100,000 rows. Only the first worksheet is processed.
              </List.Item>
              <List.Item>
                Keep SKU and barcode columns as text to preserve leading zeros.
              </List.Item>
              <List.Item>
                Nothing changes until you review the preview and confirm Apply
                changes.
              </List.Item>
              <List.Item>
                In History, select View upload and Download original sheet.
                Older uploads offer a rebuilt workbook.
              </List.Item>
              <List.Item>
                Undo restores inventory quantities only where later orders or
                updates have not changed the stock. Price changes cannot be
                undone automatically.
              </List.Item>
              <List.Item>
                If a download fails, reopen StockSheet from Shopify Apps and try
                again.
              </List.Item>
            </List>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Contact StockSheet
            </Text>
            <Text as="p">
              Email dkaustubh85@gmail.com with your shop domain, the upload
              date, and the error message. Do not send passwords, access tokens
              or customer personal information.
            </Text>
            <Button url="mailto:dkaustubh85@gmail.com" external>
              Email support
            </Button>
            <Text as="p" tone="subdued">
              StockSheet is free at launch.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
