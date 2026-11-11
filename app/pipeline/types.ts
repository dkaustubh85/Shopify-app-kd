export type ActionKind = "soldOut" | "setQuantity" | "adjust" | "setPrice";
export type Mapping = Partial<
  Record<
    | "sku"
    | "barcode"
    | "handle"
    | "option1"
    | "option2"
    | "option3"
    | "quantity"
    | "price",
    string
  >
>;
export type SheetRow = Record<string, string>;
export interface Variant {
  variantId: string;
  productId: string;
  inventoryItemId: string;
  productTitle: string;
  variantTitle: string;
  handle: string;
  options: unknown;
  sku: string;
  barcode: string;
  imageUrl: string | null;
  tracked: boolean;
  price: string;
  quantities: unknown;
}
export interface PlannedChange {
  rowIndex: number;
  source: SheetRow;
  matchKey: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  variantId: string | null;
  productId: string | null;
  inventoryItemId: string | null;
  previousQty: number | null;
  newQty: number | null;
  previousPrice: string | null;
  newPrice: string | null;
  status: string;
  errorMessage: string | null;
}
export type ActionMutation =
  | "inventorySetQuantities"
  | "inventoryAdjustQuantities"
  | "productVariantsBulkUpdate";

export type ActionWriter<Result> = (
  mutation: ActionMutation,
  changes: readonly PlannedChange[],
) => Promise<Result[]>;

export interface ActionPlugin {
  label: string;
  mutation: ActionMutation;
  preview(
    row: SheetRow,
    mapping: Mapping,
    variant: Variant,
    quantity: number,
  ): { quantity?: number; price?: string };
  apply<Result>(
    changes: readonly PlannedChange[],
    writer: ActionWriter<Result>,
  ): Promise<Result[]>;
}
