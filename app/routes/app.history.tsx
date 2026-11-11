import { pageNumber } from "../utils/input";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useSearchParams,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Pagination } from "@shopify/polaris";
import { context } from "../services/context.server";
import db from "../db.server";
import { UploadList } from "../components/UploadList";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await context(request);
  const page = pageNumber(new URL(request.url).searchParams.get("page"));
  return {
    uploads: await db.upload.findMany({
      where: { shopId: shop },
      orderBy: { createdAt: "desc" },
      take: 25,
      skip: (page - 1) * 25,
    }),
    count: await db.upload.count({ where: { shopId: shop } }),
    page,
  };
}
export default function History() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const [, setParams] = useSearchParams();
  if (location.pathname !== "/app/history") return <Outlet />;
  return (
    <Page
      title="Upload history"
      subtitle="Every upload, every change, and who made it."
      primaryAction={{ content: "Upload a sheet", url: "/app/upload" }}
    >
      <BlockStack gap="400">
        <Card padding="0">
          <UploadList uploads={data.uploads} />
        </Card>
        <Pagination
          hasPrevious={data.page > 1}
          hasNext={data.page * 25 < data.count}
          onPrevious={() => setParams({ page: String(data.page - 1) })}
          onNext={() => setParams({ page: String(data.page + 1) })}
          label={"Page " + data.page}
        />
      </BlockStack>
    </Page>
  );
}

export { headers } from "../utils/shopify-headers.server";
