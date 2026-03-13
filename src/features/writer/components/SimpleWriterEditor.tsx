import { EmptyState } from "../../../components/Panels";
import type { Chapter, Scene } from "../../../shared/types/contracts";
import type { TranslationKey } from "../../../shared/i18n";

interface SimpleWriterEditorProps {
  t: (key: TranslationKey) => string;
  chapters: Chapter[];
  selectedChapter: Chapter | null;
  selectedChapterId: string | null;
  selectedScene: Scene | null;
  selectedSceneId: string | null;
  selectedChapterScenes: Scene[];
  simpleSceneDraftContent: string;
  simpleSceneDraftDirty: boolean;
  simpleSceneDraftSaving: boolean;
  onSelectChapter: (value: string | null) => void;
  onSelectScene: (value: string | null) => void;
  onDeleteScene: (scene: Scene) => void;
  onChangeDraft: (value: string) => void;
  onResetDraft: () => void;
  onSaveDraft: () => void;
}

export function SimpleWriterEditor({
  t,
  chapters,
  selectedChapter,
  selectedChapterId,
  selectedScene,
  selectedSceneId,
  selectedChapterScenes,
  simpleSceneDraftContent,
  simpleSceneDraftDirty,
  simpleSceneDraftSaving,
  onSelectChapter,
  onSelectScene,
  onDeleteScene,
  onChangeDraft,
  onResetDraft,
  onSaveDraft
}: SimpleWriterEditorProps) {
  return (
    <div className="writing-simple-editor-shell">
      <div className="writing-simple-editor-main float-card rounded-lg border border-border-subtle bg-bg-primary p-2.5">
        {selectedScene ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 md:grid-cols-2">
                <select
                  value={selectedChapterId || ""}
                  onChange={(e) => onSelectChapter(e.target.value || null)}
                  className="min-w-0 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                >
                  <option value="">{t("writing.selectChapter")}</option>
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                  ))}
                </select>
                <select
                  value={selectedSceneId || ""}
                  onChange={(e) => onSelectScene(e.target.value || null)}
                  className="min-w-0 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                >
                  <option value="">{t("writing.selectScene")}</option>
                  {selectedChapterScenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>{scene.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onDeleteScene(selectedScene)}
                  className="rounded-md border border-danger-border px-2 py-1 text-[10px] text-danger hover:bg-danger-subtle"
                  title={t("chat.delete")}
                >
                  {t("chat.delete")}
                </button>
                {simpleSceneDraftDirty && (
                  <span className="rounded-md border border-warning-border bg-warning-subtle px-1.5 py-0.5 text-[10px] text-warning">
                    *
                  </span>
                )}
                <button
                  type="button"
                  onClick={onResetDraft}
                  disabled={!simpleSceneDraftDirty || simpleSceneDraftSaving}
                  className="rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                >
                  {t("chat.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={!simpleSceneDraftDirty || simpleSceneDraftSaving}
                  className="rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-40"
                >
                  {simpleSceneDraftSaving ? t("writing.working") : t("chat.save")}
                </button>
              </div>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-text-primary">{selectedScene.title}</div>
                <div className="text-[10px] text-text-tertiary">{selectedChapter?.title || t("writing.selectChapter")}</div>
              </div>
            </div>
            <textarea
              value={simpleSceneDraftContent}
              onChange={(e) => onChangeDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  onSaveDraft();
                }
              }}
              placeholder="Start writing..."
              className="writing-simple-editor-textarea w-full resize-none rounded-lg border border-border-subtle bg-bg-secondary px-4 py-3.5 text-[14px] leading-[1.75] tracking-[0.005em] text-text-primary placeholder:text-text-tertiary/50 placeholder:italic focus:border-accent focus:ring-1 focus:ring-accent-subtle"
            />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-2 grid min-w-0 grid-cols-1 gap-1.5 md:grid-cols-2">
              <select
                value={selectedChapterId || ""}
                onChange={(e) => onSelectChapter(e.target.value || null)}
                className="min-w-0 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
              >
                <option value="">{t("writing.selectChapter")}</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
                ))}
              </select>
              <select
                value={selectedSceneId || ""}
                onChange={(e) => onSelectScene(e.target.value || null)}
                className="min-w-0 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary"
              >
                <option value="">{t("writing.selectScene")}</option>
                {selectedChapterScenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>{scene.title}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 rounded-lg border border-border-subtle bg-bg-secondary">
              <EmptyState
                title={t("writing.noChapters")}
                description={chapters.length > 0 ? t("writing.noChaptersDesc") : t("writing.selectProject")}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
