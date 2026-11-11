import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import styles from "./styles.module.css";
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("shop"))
    throw redirect("/app?" + url.searchParams.toString());
  return null;
}
export default function App() {
  return (
    <main className={styles.index}>
      <div className={styles.content}>
        <img
          src="/brand/stocksheet-icon.png"
          alt="StockSheet"
          width="96"
          height="96"
        />
        <h1 className={styles.heading}>StockSheet</h1>
        <p className={styles.text}>
          Bulk inventory updates from Excel. Preview every change before you
          apply.
        </p>
        <p>
          Open StockSheet from Apps in your Shopify admin. Installation starts
          through Shopify.
        </p>
        <a className={styles.button} href="https://admin.shopify.com">
          Open Shopify admin
        </a>
        <ul className={styles.list}>
          <li>
            <strong>Start with your sheet.</strong> Upload Excel or CSV and
            reuse saved column mappings.
          </li>
          <li>
            <strong>Review before you apply.</strong> Check quantities and
            resolve unmatched rows.
          </li>
          <li>
            <strong>Keep your history.</strong> Download original sheets and
            results, with guarded quantity undo.
          </li>
        </ul>
      </div>
    <p>Support: <a href="mailto:dkaustubh85@gmail.com">dkaustubh85@gmail.com</a></p>
    </main>
  );
}
