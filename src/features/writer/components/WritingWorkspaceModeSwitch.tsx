interface WritingWorkspaceModeSwitchProps {
  workspaceMode: "books" | "characters";
  booksLabel: string;
  charactersLabel: string;
  onChange: (mode: "books" | "characters") => void;
}

export function WritingWorkspaceModeSwitch({
  workspaceMode,
  booksLabel,
  charactersLabel,
  onChange
}: WritingWorkspaceModeSwitchProps) {
  return (
    <div className="inline-flex items-center rounded-md border border-border-subtle bg-bg-primary p-[2px]">
      <button
        type="button"
        onClick={() => onChange("books")}
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4 transition-colors ${
          workspaceMode === "books"
            ? "bg-accent text-text-inverse"
            : "text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {booksLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("characters")}
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4 transition-colors ${
          workspaceMode === "characters"
            ? "bg-accent text-text-inverse"
            : "text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {charactersLabel}
      </button>
    </div>
  );
}
