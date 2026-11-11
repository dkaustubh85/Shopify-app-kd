import { useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { fetchAttachment } from "../utils/download";
export function useDownload() {
  const shopify = useAppBridge();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download(url: string) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const { blob, filename } = await fetchAttachment(url, () =>
        shopify.idToken(),
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The download failed. Please try again.",
      );
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { download, busy, error, clearError: () => setError("") };
}
