export const CHARACTER_CATALOG_CHANGED_EVENT = "vellium:character-catalog-changed";

export function notifyCharacterCatalogChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHARACTER_CATALOG_CHANGED_EVENT));
}

export function subscribeCharacterCatalogChanged(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(CHARACTER_CATALOG_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHARACTER_CATALOG_CHANGED_EVENT, listener);
}

export async function notifyAfterCharacterCatalogMutation<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  notifyCharacterCatalogChanged();
  return result;
}
