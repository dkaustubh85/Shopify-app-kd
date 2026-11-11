import type {
  ActionMutation,
  ActionPlugin,
  Mapping,
  SheetRow,
} from "../types.ts";

export function quantity(row: SheetRow, mapping: Mapping): number {
  const raw = mapping.quantity ? row[mapping.quantity] : "";
  if (!/^[+-]?\d+$/.test(raw ?? ""))
    throw new Error("Quantity must be a whole number.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1000000000)
    throw new Error("Quantity is outside the supported range.");
  return value;
}

export function delegateApply(mutation: ActionMutation): ActionPlugin["apply"] {
  return async (changes, writer) => writer(mutation, changes);
}
