import { dataCatalogEventName, notifyAfterDataCatalogMutation, notifyDataCatalogChanged, subscribeDataCatalogChanged } from "./dataCatalog";

export const CHARACTER_CATALOG_CHANGED_EVENT = dataCatalogEventName("characters");

export function notifyCharacterCatalogChanged() {
  notifyDataCatalogChanged("characters");
}

export function subscribeCharacterCatalogChanged(listener: () => void) {
  return subscribeDataCatalogChanged("characters", listener);
}

export function notifyAfterCharacterCatalogMutation<T>(request: Promise<T>): Promise<T> {
  return notifyAfterDataCatalogMutation("characters", request);
}
