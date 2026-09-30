import { useState, type ReactNode } from "react";
import { AvatarBadge } from "../../../components/AvatarBadge";
import { EmptyState, PanelTitle } from "../../../components/Panels";
import { resolveApiAssetUrl } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { CharacterDetail, WriterCharacterAdvancedOptions, WriterCharacterEditField } from "../../../shared/types/contracts";
import { CHARACTER_AI_EDIT_FIELDS } from "../constants";
import type { CharacterEditDraft, CharacterEditStatus } from "../types";

type EditorSection = "core" | "voice" | "meta";

const sparkIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3zm6 11l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
  </svg>
);

const ADVANCED_FIELDS: Array<[keyof WriterCharacterAdvancedOptions, string, boolean]> = [
  ["name", "writing.characterNameHint", false],
  ["role", "writing.characterRoleHint", false],
  ["personality", "writing.characterPersonalityHint", false],
  ["scenario", "writing.characterScenarioHint", false],
  ["greetingStyle", "writing.characterGreetingHint", false],
  ["systemPrompt", "writing.characterSystemHint", false],
  ["tags", "writing.characterTagsHint", true],
  ["notes", "writing.characterNotesHint", true]
];

/**
 * Character Forge laid out like Characters: library, editor, and an inspector that holds
 * the AI tools. Creating a character is the editor's other mode, not a banner above it.
 */
export function CharacterForgeWorkspace({
  modeSwitch, simpleMode, characters, visibleCharacters, query, onQuery, selected, onSelect,
  generator, editor, aiEdit
}: {
  modeSwitch: ReactNode;
  simpleMode: boolean;
  characters: CharacterDetail[];
  visibleCharacters: CharacterDetail[];
  query: string;
  onQuery: (value: string) => void;
  selected: CharacterDetail | null;
  onSelect: (id: string) => void;
  generator: {
    prompt: string;
    onPrompt: (value: string) => void;
    advancedOpen: boolean;
    onToggleAdvanced: () => void;
    advanced: WriterCharacterAdvancedOptions;
    onAdvanced: (key: keyof WriterCharacterAdvancedOptions, value: string) => void;
    busy: boolean;
    error: string;
    onGenerate: () => void;
    onReset: () => void;
  };
  editor: {
    section: EditorSection;
    onSection: (section: EditorSection) => void;
    draft: CharacterEditDraft;
    onDraft: (update: (previous: CharacterEditDraft) => CharacterEditDraft) => void;
    status: CharacterEditStatus | null;
    busy: boolean;
    onSave: () => void;
  };
  aiEdit: {
    instruction: string;
    onInstruction: (value: string) => void;
    fields: WriterCharacterEditField[];
    onToggleField: (field: WriterCharacterEditField) => void;
    fieldLabel: (field: WriterCharacterEditField) => string;
    busy: boolean;
    onApply: () => void;
    onClear: () => void;
  };
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const showGenerator = createOpen || !selected;

  const editorFields: Record<EditorSection, Array<[keyof CharacterEditDraft, string, number]>> = {
    core: [["description", t("chars.description"), 5], ["personality", t("chars.personality"), 4], ["scenario", t("chars.scenario"), 4]],
    voice: [["greeting", t("chars.firstMessage"), 6], ["systemPrompt", t("chars.systemPrompt"), 5], ["mesExample", t("chars.exampleMessages"), 6]],
    meta: [["creatorNotes", t("chars.creatorNotes"), 7]]
  };

  return (
    <section className={`charforge-shell charforge-layout ${simpleMode ? "writing-simple-character-shell" : ""}`}>
      <aside className="panel-shell ui-panel-shell charforge-panel charforge-library" aria-label={t("chars.characters")}>
        <PanelTitle action={modeSwitch}>{t("chars.characters")}</PanelTitle>
        <button type="button" className={`charforge-create-entry${showGenerator ? " is-active" : ""}`}
          onClick={() => setCreateOpen(true)} aria-pressed={showGenerator}>
          {sparkIcon}
          <span>{t("writing.characterGenerate")}</span>
        </button>
        <label className="characters-library-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z" />
          </svg>
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("writing.searchCharacters")} />
          <span className="charforge-count">{visibleCharacters.length}/{characters.length}</span>
        </label>
        <div className="charforge-list-scroll">
          {characters.length === 0 ? (
            <EmptyState title={t("chars.noChars")} description={t("chars.noCharsDesc")} />
          ) : visibleCharacters.length === 0 ? (
            <EmptyState title={t("chat.noSearchResults")} description={t("chat.noSearchResultsDesc")} />
          ) : visibleCharacters.map((character) => {
            const active = !showGenerator && selected?.id === character.id;
            return (
              <button key={character.id} type="button" className={`character-library-item${active ? " is-active" : ""}`}
                onClick={() => { setCreateOpen(false); onSelect(character.id); }}>
                <AvatarBadge name={character.name} src={resolveApiAssetUrl(character.avatarUrl)} className="h-8 w-8 flex-shrink-0 rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{character.name}</span>
                  {character.tags.length ? <span className="block truncate text-[11px] text-text-tertiary">{character.tags.join(", ")}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="panel-shell ui-panel-shell charforge-panel charforge-editor-panel">
        {showGenerator ? (
          <div className="charforge-generator">
            <div className="char-editor-header mb-4">
              <div className="char-editor-header-top">
                <span className="charforge-generator-mark">{sparkIcon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-text-primary">{t("writing.characterGenerate")}</div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{t("writing.characterGenerateHint")}</div>
                </div>
              </div>
            </div>
            <label>
              <span className="char-editor-label">{t("writing.characterPromptLabel")}</span>
              <textarea className="char-editor-textarea" rows={6} value={generator.prompt}
                onChange={(event) => generator.onPrompt(event.target.value)} placeholder={t("writing.characterPromptPlaceholder")} />
            </label>
            <button type="button" className="charforge-disclosure" onClick={generator.onToggleAdvanced} aria-expanded={generator.advancedOpen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={generator.advancedOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></svg>
              {t("writing.characterAdvanced")}
            </button>
            {generator.advancedOpen ? (
              <div className="charforge-advanced-grid">
                {ADVANCED_FIELDS.map(([key, hint, wide]) => (
                  <input key={key} className={`char-editor-input${wide ? " is-wide" : ""}`} value={generator.advanced[key] || ""}
                    placeholder={t(hint as Parameters<typeof t>[0])} onChange={(event) => generator.onAdvanced(key, event.target.value)} />
                ))}
              </div>
            ) : null}
            {generator.error ? <p className="charforge-error" role="alert">{generator.error}</p> : null}
            <div className="char-editor-actions">
              <button type="button" className="char-editor-btn is-primary" onClick={generator.onGenerate} disabled={generator.busy}>
                {sparkIcon}
                {generator.busy ? t("writing.characterGenerating") : t("writing.characterGenerate")}
              </button>
              <button type="button" className="char-editor-btn" onClick={generator.onReset} disabled={generator.busy}>{t("writing.characterReset")}</button>
              {selected ? (
                <button type="button" className="char-editor-btn" onClick={() => setCreateOpen(false)}>{t("chat.cancel")}</button>
              ) : null}
            </div>
          </div>
        ) : selected ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="char-editor-header mb-4">
              <div className="char-editor-header-top">
                <AvatarBadge name={selected.name} src={resolveApiAssetUrl(selected.avatarUrl)} className="h-14 w-14 flex-shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-text-primary">{editor.draft.name || selected.name}</div>
                  {editor.status ? (
                    <div className={`mt-0.5 text-[11px] ${editor.status.tone === "success" ? "text-success" : "text-danger"}`}>{editor.status.text}</div>
                  ) : selected.tags.length ? (
                    <div className="mt-0.5 truncate text-[11px] text-text-tertiary">{selected.tags.join(", ")}</div>
                  ) : null}
                </div>
              </div>
              <div className="char-editor-actions">
                <button type="button" className="char-editor-btn is-primary" onClick={editor.onSave} disabled={editor.busy || aiEdit.busy}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 4h12l2 2v14H5V4zm3 0v6h8V4M8 20v-6h8v6" /></svg>
                  {editor.busy ? t("writing.working") : t("chat.save")}
                </button>
              </div>
            </div>
            <div className="char-editor-tabs" role="tablist" aria-label={t("writing.characterForge")}>
              {([["core", t("writing.characterSectionCore")], ["voice", t("writing.characterSectionVoice")], ["meta", t("writing.characterSectionMeta")]] as const).map(([section, label]) => (
                <button key={section} type="button" role="tab" aria-selected={editor.section === section}
                  className={editor.section === section ? "is-active" : ""} onClick={() => editor.onSection(section)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="charforge-fields" role="tabpanel">
              {editor.section === "core" ? (
                <label>
                  <span className="char-editor-label">{t("chars.name")}</span>
                  <input className="char-editor-input" value={editor.draft.name}
                    onChange={(event) => editor.onDraft((previous) => ({ ...previous, name: event.target.value }))} />
                </label>
              ) : null}
              {editorFields[editor.section].map(([field, label, rows]) => (
                <label key={field}>
                  <span className="char-editor-label">{label}</span>
                  <textarea className="char-editor-textarea" rows={rows} value={editor.draft[field]}
                    onChange={(event) => editor.onDraft((previous) => ({ ...previous, [field]: event.target.value }))} />
                </label>
              ))}
              {editor.section === "meta" ? (
                <label>
                  <span className="char-editor-label">{t("chars.tagsPlaceholder")}</span>
                  <input className="char-editor-input" value={editor.draft.tagsText}
                    onChange={(event) => editor.onDraft((previous) => ({ ...previous, tagsText: event.target.value }))} />
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <aside className="panel-shell ui-panel-shell charforge-panel charforge-inspector" aria-label={t("writing.characterAiEdit")}>
        <div className="characters-inspector-tabs" role="group">
          <button type="button" className="is-active" aria-pressed="true">{t("writing.characterAiEdit")}</button>
        </div>
        {selected && !showGenerator ? (
          <div className="charforge-ai">
            <label>
              <span className="char-editor-label">{t("writing.characterAiInstructionLabel")}</span>
              <textarea className="char-editor-textarea" rows={5} value={aiEdit.instruction}
                onChange={(event) => aiEdit.onInstruction(event.target.value)} placeholder={t("writing.characterAiInstructionPlaceholder")} />
            </label>
            <div>
              <span className="char-editor-label">
                {aiEdit.fields.length > 0 ? `${t("writing.characterAiScope")}: ${aiEdit.fields.length}` : t("writing.characterAiScopeAuto")}
              </span>
              <div className="charforge-chips">
                {CHARACTER_AI_EDIT_FIELDS.map((field) => (
                  <button key={field} type="button" className={aiEdit.fields.includes(field) ? "is-active" : ""}
                    aria-pressed={aiEdit.fields.includes(field)} onClick={() => aiEdit.onToggleField(field)}>
                    {aiEdit.fieldLabel(field)}
                  </button>
                ))}
              </div>
            </div>
            <div className="charforge-ai-actions">
              <button type="button" className="char-editor-btn is-primary" onClick={aiEdit.onApply} disabled={aiEdit.busy || editor.busy}>
                {sparkIcon}
                {aiEdit.busy ? t("writing.characterAiEditing") : t("writing.characterAiApply")}
              </button>
              <button type="button" className="char-editor-btn" onClick={aiEdit.onClear} disabled={aiEdit.busy}>{t("writing.characterAiClear")}</button>
            </div>
          </div>
        ) : (
          <p className="characters-preview-description">{t("writing.characterAiEditHint")}</p>
        )}
      </aside>
    </section>
  );
}
