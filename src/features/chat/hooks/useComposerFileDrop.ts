import { useCallback, useEffect, useRef, useState, type DragEventHandler } from "react";

export function transferContainsFiles(types: ArrayLike<string> | null | undefined): boolean {
  return Array.from(types || []).includes("Files");
}

interface ComposerFileDropOptions {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

export function useComposerFileDrop({ disabled = false, onFiles }: ComposerFileDropOptions) {
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const onFilesRef = useRef(onFiles);

  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (!disabled) return;
    dragDepthRef.current = 0;
    setIsFileDropActive(false);
  }, [disabled]);

  const onDragEnter = useCallback<DragEventHandler<HTMLElement>>((event) => {
    if (disabled || !transferContainsFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsFileDropActive(true);
  }, [disabled]);

  const onDragOver = useCallback<DragEventHandler<HTMLElement>>((event) => {
    if (disabled || !transferContainsFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDropActive(true);
  }, [disabled]);

  const onDragLeave = useCallback<DragEventHandler<HTMLElement>>((event) => {
    if (!transferContainsFiles(event.dataTransfer.types)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsFileDropActive(false);
  }, []);

  const onDrop = useCallback<DragEventHandler<HTMLElement>>((event) => {
    if (!transferContainsFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsFileDropActive(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) onFilesRef.current(files);
  }, [disabled]);

  return {
    isFileDropActive,
    composerFileDropProps: { onDragEnter, onDragOver, onDragLeave, onDrop }
  };
}
