import { RouterPolarisProvider } from "../components/RouterPolarisProvider";
import { useState, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Box, InlineStack, Button, Text, ProgressBar } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { context } from "../services/context.server";
import { readGuide } from "../services/guide.server";
import { GettingStarted } from "../components/GettingStarted";
export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, userId } = await context(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    guide: await readGuide(shop, userId),
  };
}
export default function App() {
  const { apiKey, guide } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [guideOpen, setGuideOpen] = useState(guide.status === "in_progress");
  const close = useCallback(() => setGuideOpen(false), []);
  return (
    <AppProvider apiKey={apiKey}>
      <RouterPolarisProvider>
        <NavMenu>
          <Link to="/app" rel="home">
            StockSheet
          </Link>
          <Link to="/app/upload">Upload a sheet</Link>
          <Link to="/app/templates">Templates</Link>
          <Link to="/app/history">History</Link>
          <Link to="/app/export">Export inventory</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/help">Help and support</Link>
        </NavMenu>
        <Box paddingInline="500" paddingBlockStart="300">
          <InlineStack align="end" gap="300" blockAlign="center">
            <Text as="span" tone="subdued">
              Need a hand?
            </Text>
            <Button variant="plain" onClick={() => setGuideOpen(true)}>
              Getting started
            </Button>
          </InlineStack>
        </Box>
        {navigation.state !== "idle" && (
          <div role="status" aria-label="Loading page">
            <ProgressBar progress={75} size="small" />
          </div>
        )}
        <div aria-busy={navigation.state !== "idle"}>
          <Outlet />
        </div>
        <GettingStarted
          open={guideOpen}
          onClose={close}
          initialStep={guide.status === "completed" ? 0 : guide.step}
        />
      </RouterPolarisProvider>
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
