import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

export function simplePanelDismissal({ modalOpen, inspectorOpen, sidebarOpen, compact }: {
  modalOpen: boolean; inspectorOpen: boolean; sidebarOpen: boolean; compact: boolean;
}): "inspector" | "sidebar" | null {
  if (modalOpen) return null;
  if (inspectorOpen) return "inspector";
  return sidebarOpen && compact ? "sidebar" : null;
}

type UseSimplePanelControllerParams = {
  active: boolean;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  sceneOpen: boolean;
  sceneControlsOpen: boolean;
  modelSelectorOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setInspectorOpen: Dispatch<SetStateAction<boolean>>;
  setSceneOpen: Dispatch<SetStateAction<boolean>>;
  setSceneControlsOpen: Dispatch<SetStateAction<boolean>>;
  setModelSelectorOpen: Dispatch<SetStateAction<boolean>>;
};

export function useSimplePanelController({
  active,
  sidebarOpen,
  inspectorOpen,
  sceneOpen,
  sceneControlsOpen,
  modelSelectorOpen,
  setSidebarOpen,
  setInspectorOpen,
  setSceneOpen,
  setSceneControlsOpen,
  setModelSelectorOpen
}: UseSimplePanelControllerParams) {
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const inspectorWasOpen = useRef(false);
  const openSidebar = useCallback((next?: boolean) => {
    if (!active) return;
    const shouldOpen = typeof next === "boolean" ? next : !sidebarOpen;
    if (shouldOpen && window.matchMedia("(max-width: 1279px)").matches) setInspectorOpen(false);
    if (next !== false) setModelSelectorOpen(false);
    setSidebarOpen(shouldOpen);
  }, [active, setInspectorOpen, setModelSelectorOpen, setSidebarOpen, sidebarOpen]);

  const openInspector = useCallback((next?: boolean) => {
    if (!active) return;
    const shouldOpen = typeof next === "boolean" ? next : !inspectorOpen;
    if (shouldOpen && !inspectorOpen) {
      inspectorTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (shouldOpen && window.matchMedia("(max-width: 1279px)").matches) setSidebarOpen(false);
    if (next !== false) setModelSelectorOpen(false);
    setInspectorOpen(shouldOpen);
  }, [active, inspectorOpen, setInspectorOpen, setModelSelectorOpen, setSidebarOpen]);

  useEffect(() => {
    if (!active) { inspectorWasOpen.current = false; return; }
    if (inspectorOpen && !inspectorWasOpen.current) {
      document.querySelector<HTMLButtonElement>("#chat-simple-inspector-sidebar .simple-panel-close")?.focus({ preventScroll: true });
    } else if (!inspectorOpen && inspectorWasOpen.current && document.documentElement.dataset.modalOpen !== "true") {
      const trigger = inspectorTriggerRef.current;
      const returnTarget = trigger?.isConnected && !trigger.closest("[inert]") ? trigger
        : Array.from(document.querySelectorAll<HTMLElement>('[aria-controls="chat-simple-inspector-sidebar"]'))
          .find((element) => !element.closest("[inert]") && element.getClientRects().length > 0);
      returnTarget?.focus({ preventScroll: true });
    }
    inspectorWasOpen.current = inspectorOpen;
  }, [active, inspectorOpen]);

  useEffect(() => {
    if (!active) return;
    const compact = window.matchMedia("(max-width: 1279px)");
    const onResize = () => { if (compact.matches && inspectorOpen) setSidebarOpen(false); };
    compact.addEventListener("change", onResize);
    return () => compact.removeEventListener("change", onResize);
  }, [active, inspectorOpen, setSidebarOpen]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const modalOpen = modelSelectorOpen || document.documentElement.dataset.modalOpen === "true";
      // ModalShell owns nested dialogs, including saving/disabled close states.
      if (modalOpen) return;
      if (sceneControlsOpen) {
        setSceneControlsOpen(false);
        return;
      }
      if (sceneOpen) {
        setSceneOpen(false);
        return;
      }
      const target = simplePanelDismissal({ modalOpen, inspectorOpen, sidebarOpen, compact: window.matchMedia("(max-width: 1279px)").matches });
      if (target === "inspector") setInspectorOpen(false);
      if (target === "sidebar") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, inspectorOpen, modelSelectorOpen, sceneControlsOpen, sceneOpen, setInspectorOpen, setSceneControlsOpen, setSceneOpen, setSidebarOpen, sidebarOpen]);

  return { openSidebar, openInspector };
}
