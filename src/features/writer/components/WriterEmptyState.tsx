import { EmptyState } from "../../../components/Panels";
import type { TranslationKey } from "../../../shared/i18n";
import { WriterEmptyProjectActions } from "./WriterEmptyProjectActions";

export function WriterEmptyState({
  t,
  hasProject,
  chapterCount,
  busy,
  onCreateProject,
  onImportDocxAsBook,
  onCreateChapter
}: {
  t: (key: TranslationKey) => string;
  hasProject: boolean;
  chapterCount: number;
  busy: boolean;
  onCreateProject: () => void;
  onImportDocxAsBook: () => void;
  onCreateChapter: () => void;
}) {
  const projectMissing = !hasProject;
  const noChapters = hasProject && chapterCount === 0;
  return (
    <EmptyState
      title={projectMissing ? t("writing.selectProject") : noChapters ? t("writing.noChapters") : t("writing.selectScene")}
      description={projectMissing ? t("writing.noProjectDesc") : noChapters ? t("writing.noChaptersDesc") : undefined}
      action={projectMissing ? (
        <WriterEmptyProjectActions
          busy={busy}
          createLabel={t("writing.createProject")}
          importLabel={t("writing.importDocxAsBook")}
          onCreate={onCreateProject}
          onImport={onImportDocxAsBook}
        />
      ) : noChapters ? (
        <button
          type="button"
          onClick={onCreateChapter}
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
        >
          {t("writing.createChapter")}
        </button>
      ) : undefined}
    />
  );
}

export function WriterCastEmptyState({
  description,
  actionLabel,
  onOpen
}: {
  description: string;
  actionLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-2 text-[11px] text-text-tertiary">
      <p>{description}</p>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent-subtle"
      >
        {actionLabel}
      </button>
    </div>
  );
}
