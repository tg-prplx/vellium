/** Local file paths are connection details; provider model IDs stay intact. */
export function modelDisplayName(label: string): string {
  const value = label.trim();
  if (/^(?:[a-z]:[\\/]|\/)/i.test(value)) return value.split(/[\\/]/).filter(Boolean).pop() || value;
  return value;
}
