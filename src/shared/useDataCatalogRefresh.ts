import { useEffect, useRef } from "react";
import { subscribeDataCatalogChanged, type DataCatalogKind } from "./dataCatalog";

// Re-runs `refresh` whenever another screen changes one of the given lists.
export function useDataCatalogRefresh(kinds: readonly DataCatalogKind[], refresh: (kind: DataCatalogKind) => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const kindsKey = kinds.join(",");

  useEffect(() => {
    const unsubscribers = (kindsKey ? kindsKey.split(",") as DataCatalogKind[] : [])
      .map((kind) => subscribeDataCatalogChanged(kind, () => refreshRef.current(kind)));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [kindsKey]);
}
