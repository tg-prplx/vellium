export function WriterEmptyProjectActions({
  busy,
  createLabel,
  importLabel,
  onCreate,
  onImport
}: {
  busy: boolean;
  createLabel: string;
  importLabel: string;
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onCreate}
        className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
      >
        {createLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onImport}
        className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-40"
      >
        {importLabel}
      </button>
    </div>
  );
}
