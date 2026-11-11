export const MAX_PAGE_NUMBER = 10000;

export function pageNumber(raw: string | null): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_PAGE_NUMBER)
    : 1;
}

// Callers supply the active location list returned by Shopify.
export function activeLocation(
  saved: string,
  locations: readonly { id: string }[],
): string {
  return locations.some((location) => location.id === saved)
    ? saved
    : locations[0]?.id || "";
}
