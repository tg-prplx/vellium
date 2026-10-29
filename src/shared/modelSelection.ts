// After a model list loads, keep only a selection that really exists in it.
// Silently falling back to the first model made the picker show a model that
// chat was not actually using.
export function pickLoadedModelId(
  models: ReadonlyArray<{ id: string }>,
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (candidate && models.some((model) => model.id === candidate)) return candidate;
  }
  return "";
}
