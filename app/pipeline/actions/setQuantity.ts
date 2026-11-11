import type { ActionPlugin } from "../types.ts";
import { delegateApply, quantity } from "./helpers.ts";

const mutation = "inventorySetQuantities";
export const setQuantity: ActionPlugin = {
  label: "Set exact quantity",
  mutation,
  preview: (row, mapping) => ({ quantity: quantity(row, mapping) }),
  apply: delegateApply(mutation),
};
