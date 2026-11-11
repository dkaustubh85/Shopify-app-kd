import type { ActionPlugin } from "../types.ts";
import { delegateApply } from "./helpers.ts";

const mutation = "productVariantsBulkUpdate";
export const setPrice: ActionPlugin = {
  label: "Update price",
  mutation,
  preview: (row, mapping) => {
    const raw = mapping.price ? row[mapping.price] : "";
    if (!/^\d+(\.\d{1,2})?$/.test(raw ?? "") || Number(raw) > 1000000000)
      throw new Error(
        "Price must be a non-negative amount with up to two decimals.",
      );
    return { price: Number(raw).toFixed(2) };
  },
  apply: delegateApply(mutation),
};
