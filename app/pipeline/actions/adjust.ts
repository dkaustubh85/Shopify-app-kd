import type { ActionPlugin } from "../types.ts";
import { delegateApply, quantity } from "./helpers.ts";

const mutation = "inventoryAdjustQuantities";
export const adjust: ActionPlugin = {
  label: "Adjust quantity",
  mutation,
  preview: (row, mapping, _variant, current) => ({
    quantity: current + quantity(row, mapping),
  }),
  apply: delegateApply(mutation),
};
