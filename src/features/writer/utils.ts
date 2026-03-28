export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read export blob"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.readAsDataURL(blob);
  });
}

export async function triggerBlobDownload(blob: Blob, filename: string) {
  if (window.electronAPI?.saveFile) {
    const base64Data = await blobToBase64(blob);
    const saved = await window.electronAPI.saveFile(filename, base64Data);
    if (!saved.canceled && saved.ok) return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
