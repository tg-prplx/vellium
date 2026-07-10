import type { UserPersona } from "../../../shared/types/contracts";
import { ModalShell } from "../../../components/ModalShell";

interface PersonaModalProps {
  open: boolean;
  personas: UserPersona[];
  activePersona: UserPersona | null;
  editingPersona: UserPersona | null;
  onClose: () => void;
  onSelect: (persona: UserPersona) => void;
  onSetDefault: (personaId: string) => void | Promise<void>;
  onStartEdit: (persona: UserPersona) => void;
  onEditChange: (persona: UserPersona | null) => void;
  onCreateNew: () => void;
  onSave: () => void | Promise<void>;
  onDelete: (personaId: string) => void | Promise<void>;
  t: (key: any) => string;
}

export function PersonaModal({
  open,
  personas,
  activePersona,
  editingPersona,
  onClose,
  onSelect,
  onSetDefault,
  onStartEdit,
  onEditChange,
  onCreateNew,
  onSave,
  onDelete,
  t
}: PersonaModalProps) {
  if (!open) return null;

  return (
    <ModalShell
      title={editingPersona ? (editingPersona.id ? editingPersona.name : t("chat.newPersona")) : t("chat.personas")}
      description={editingPersona ? t("chat.personaEditorDesc") : t("chat.personasDesc")}
      closeLabel={t("chat.cancel")}
      onClose={onClose}
      size="md"
      originId="persona"
      surfaceClassName="persona-modal"
      bodyClassName="persona-modal-body"
      icon={(
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 19a6.5 6.5 0 0 0-13 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7.5-1.5v6m3-3h-6" />
        </svg>
      )}
      footer={editingPersona ? (
        <>
          {editingPersona.id ? (
            <button
              type="button"
              onClick={() => void onDelete(editingPersona.id)}
              className="vellium-button vellium-button-danger mr-auto"
            >
              {t("chat.deletePersona")}
            </button>
          ) : <span />}
          <button type="button" onClick={() => onEditChange(null)} className="vellium-button vellium-button-secondary">
            {t("chat.cancel")}
          </button>
          <button type="button" onClick={() => void onSave()} className="vellium-button vellium-button-primary">
            {t("chat.save")}
          </button>
        </>
      ) : (
        <>
          <span className="vellium-modal-footer-note">{personas.length} {t("chat.personas")}</span>
          <button type="button" onClick={onCreateNew} className="vellium-button vellium-button-primary">
            <span aria-hidden="true">+</span> {t("chat.newPersona")}
          </button>
        </>
      )}
    >
      {editingPersona ? (
        <div className="persona-editor-grid">
          <div className="persona-editor-field is-wide">
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaName")}</label>
              <input
                value={editingPersona.name}
                onChange={(event) => onEditChange({ ...editingPersona, name: event.target.value })}
                className="persona-editor-input"
                autoFocus
                data-modal-autofocus
              />
          </div>
          <div className="persona-editor-field">
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaDesc")}</label>
              <textarea
                value={editingPersona.description}
                onChange={(event) => onEditChange({ ...editingPersona, description: event.target.value })}
                className="persona-editor-input persona-editor-textarea"
              />
          </div>
          <div className="persona-editor-field">
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaPersonality")}</label>
              <textarea
                value={editingPersona.personality}
                onChange={(event) => onEditChange({ ...editingPersona, personality: event.target.value })}
                className="persona-editor-input persona-editor-textarea"
              />
          </div>
        </div>
        ) : (
        <div className="persona-list">
          {personas.length === 0 ? (
            <div className="persona-empty-state">
              <span className="persona-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-3v6m3-3h-6" />
                </svg>
              </span>
              <div className="persona-empty-title">{t("chat.personasEmpty")}</div>
              <div className="persona-empty-copy">{t("chat.personasEmptyDesc")}</div>
            </div>
          ) : personas.map((persona) => (
              <article
                key={persona.id}
                className={`persona-list-item ${activePersona?.id === persona.id ? "is-active" : ""}`}
              >
                <button
                  onClick={() => onSelect(persona)}
                  className="persona-list-main"
                >
                  <span className="persona-list-avatar" aria-hidden="true">{persona.name.trim().charAt(0).toUpperCase() || "P"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="persona-list-name">
                      {persona.name}
                      {persona.isDefault && <span className="persona-default-badge">{t("chat.default")}</span>}
                    </span>
                    <span className="persona-list-description">{persona.description || t("chat.personaNoDescription")}</span>
                  </span>
                  <span className="persona-list-selected" aria-hidden="true" />
                </button>
                <div className="persona-list-actions">
                  {!persona.isDefault && (
                    <button type="button" onClick={() => void onSetDefault(persona.id)} className="persona-text-action">
                      {t("chat.setDefault")}
                    </button>
                  )}
                  <button type="button" onClick={() => onStartEdit(persona)} className="persona-icon-action" aria-label={t("chat.edit")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m15.2 5.2 3.6 3.6M4 20l4.4-1 10.4-10.4a2.55 2.55 0 0 0-3.6-3.6L4.8 15.4 4 20Z" />
                    </svg>
                  </button>
                </div>
              </article>
            ))}
        </div>
        )}
    </ModalShell>
  );
}
