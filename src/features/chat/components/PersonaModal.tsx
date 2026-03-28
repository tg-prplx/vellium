import type { UserPersona } from "../../../shared/types/contracts";

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
    <div className="overlay-animate fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="modal-pop w-full max-w-lg rounded-xl border border-border bg-bg-secondary p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">{t("chat.personas")}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {editingPersona ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaName")}</label>
              <input
                value={editingPersona.name}
                onChange={(event) => onEditChange({ ...editingPersona, name: event.target.value })}
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaDesc")}</label>
              <textarea
                value={editingPersona.description}
                onChange={(event) => onEditChange({ ...editingPersona, description: event.target.value })}
                className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("chat.personaPersonality")}</label>
              <textarea
                value={editingPersona.personality}
                onChange={(event) => onEditChange({ ...editingPersona, personality: event.target.value })}
                className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  void onSave();
                }}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
              >
                {t("chat.save")}
              </button>
              <button
                onClick={() => onEditChange(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs text-text-secondary hover:bg-bg-hover"
              >
                {t("chat.cancel")}
              </button>
              {editingPersona.id && (
                <button
                  onClick={() => {
                    void onDelete(editingPersona.id);
                  }}
                  className="ml-auto rounded-lg px-4 py-2 text-xs text-danger/70 hover:bg-danger-subtle hover:text-danger"
                >
                  {t("chat.deletePersona")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  activePersona?.id === persona.id ? "border-accent bg-accent-subtle" : "border-border bg-bg-primary"
                }`}
              >
                <button
                  onClick={() => onSelect(persona)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium text-text-primary">
                    {persona.name} {persona.isDefault && <span className="text-[10px] text-accent">★ {t("chat.default")}</span>}
                  </div>
                  {persona.description && <div className="mt-0.5 truncate text-xs text-text-tertiary">{persona.description}</div>}
                </button>
                <div className="ml-2 flex gap-1">
                  {!persona.isDefault && (
                    <button
                      onClick={() => {
                        void onSetDefault(persona.id);
                      }}
                      className="rounded-md px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-accent"
                    >
                      {t("chat.setDefault")}
                    </button>
                  )}
                  <button
                    onClick={() => onStartEdit(persona)}
                    className="rounded-md px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
                  >
                    {t("chat.edit")}
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={onCreateNew}
              className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
            >
              + {t("chat.newPersona")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
