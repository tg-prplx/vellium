# Legacy and Agents

Vellium keeps two compatibility features under `Settings → Legacy`:

1. the deprecated Agents workspace;
2. the older non-Simple Chat and Writing interface.

Neither is part of the default navigation or the recommended setup for a new
user.

## Agents deprecation status

Agents is **deprecated, disabled by default, and retained for compatibility**.
Deprecation currently means:

- there is no primary top-level Agents tab;
- onboarding does not enable it;
- existing agent threads are not deleted or migrated silently;
- the `/api/agents` routes and stored thread data remain available;
- security checks for workspace, command, network, destructive file, shell, and
  git-write tools remain enforced;
- critical regressions may still be fixed, but new product work should not assume
  Agents is a first-class workspace.

Deprecation does **not** mean that Vellium may erase old threads or weaken their
tool permissions.

## Open an existing Agents thread

1. Open `Settings`.
2. Select `Legacy`.
3. Enable `Agents` explicitly.
4. Choose `Open Agents`.

The toggle is intentionally an opt-in. If Agents is disabled again, its stored
threads remain in the local database.

## What to use for new work

| Need | Supported surface |
| --- | --- |
| Character dialogue or RP | `Chat` |
| Voice conversation | `Live` |
| Long-form drafting and revision | `Writing` |
| Model-callable external functions | MCP tools in `Chat` or `Live` |
| A custom workflow or interface | Local plugin tabs, widgets, and actions |
| Retrieval over documents | `Knowledge` collections bound to Chat or Writing |

MCP and plugins are not automatic replacements for arbitrary shell access. They
have their own permission and trust boundaries; enable only what the workflow
requires.

## Legacy interface

Simple Mode is the supported Chat and Writing interface. The older interface can
be enabled separately under `Settings → Legacy`. This compatibility toggle is
independent of Agents: enabling one does not need to enable the other.

If a problem appears only in the old interface, reproduce it in Simple Mode
before changing shared chat data. Both layouts can read the same persistent
conversations, so interface compatibility must not mutate or reset them.

## Backups and removal expectations

Vellium has no automatic destructive migration for legacy Agents data. Before
manually altering the application data directory, back up the complete SQLite
database while Vellium is closed. Do not delete individual rows to “disable” the
feature; use the Legacy toggle.

If Agents is removed in a future major version, that change should include an
explicit migration/export path and release notes. The current deprecation notice
is not such a removal announcement.
