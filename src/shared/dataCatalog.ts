// Screens stay mounted when you switch tabs, so lists loaded once go stale when
// another screen edits the same data. Mutations announce the kind they changed
// and mounted consumers refresh that list in the background.
export type DataCatalogKind = "characters" | "personas" | "lorebooks" | "ragCollections" | "providers";

const EVENT_NAMES: Record<DataCatalogKind, string> = {
  characters: "vellium:character-catalog-changed",
  personas: "vellium:persona-catalog-changed",
  lorebooks: "vellium:lorebook-catalog-changed",
  ragCollections: "vellium:rag-collection-catalog-changed",
  providers: "vellium:provider-catalog-changed"
};

export function dataCatalogEventName(kind: DataCatalogKind) {
  return EVENT_NAMES[kind];
}

export function notifyDataCatalogChanged(kind: DataCatalogKind) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT_NAMES[kind]));
}

export function subscribeDataCatalogChanged(kind: DataCatalogKind, listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAMES[kind], listener);
  return () => window.removeEventListener(EVENT_NAMES[kind], listener);
}

export async function notifyAfterDataCatalogMutation<T>(kind: DataCatalogKind, request: Promise<T>): Promise<T> {
  const result = await request;
  notifyDataCatalogChanged(kind);
  return result;
}

// Keeps the previous object for items whose content did not change, so an
// open editor bound to one of them is not reset by a background refresh.
export function reuseUnchangedItems<T extends { id: string }>(previous: readonly T[], next: readonly T[]): T[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const prior = previousById.get(item.id);
    return prior && JSON.stringify(prior) === JSON.stringify(item) ? prior : item;
  });
}
