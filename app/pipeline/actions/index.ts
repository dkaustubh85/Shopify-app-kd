import type { ActionKind, ActionPlugin } from "../types.ts";
import { soldOut } from "./soldOut.ts";
import { setQuantity } from "./setQuantity.ts";
import { adjust } from "./adjust.ts";
import { setPrice } from "./setPrice.ts";

export { soldOut, setQuantity, adjust, setPrice };
export const actions: Record<ActionKind, ActionPlugin> = {
  soldOut,
  setQuantity,
  adjust,
  setPrice,
};
