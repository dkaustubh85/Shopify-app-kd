import type { ActionPlugin } from "../types.ts";
import { delegateApply } from "./helpers.ts";

const mutation = "inventorySetQuantities";
export const soldOut: ActionPlugin = {
  label: "Mark as sold out",
  mutation,
  preview: () => ({ quantity: 0 }),
  apply: delegateApply(mutation),
};
