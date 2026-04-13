# Plugins and Security

Vellium supports local plugins, plugin tabs, slot widgets, inline actions, plugin settings, and themes. This is one of the most powerful parts of the app, but it also requires discipline around trust and permissions.

## What plugins can do in Vellium

Plugins can add:

- separate tabs in the top navigation
- widgets in supported slots
- actions in the toolbar, composer, messages, or writing areas
- their own settings
- their own permissions
- interface themes

In other words, a plugin in Vellium is not just a button. It is a real local extension of the app.

## Where plugin management lives

Main entry point:

- `Settings -> Plugins`

There you can:

- inspect the plugin catalog
- install a `Pluginfile`
- export an existing plugin
- reload the catalog
- view the plugins directory path
- open plugin settings
- grant or revoke permissions
- enable or disable a plugin

## Pluginfile

`Pluginfile` is the portable single-file format for plugin distribution.

In practice that means:

- a plugin can be packed into one JSON file
- installed directly from the UI
- exported again without rebuilding a folder structure by hand

For end users, this is the easiest way to move local plugins around.

## Plugin permissions

Vellium stores requested permissions and granted permissions separately. That is a critical safety mechanism.

From both code and UI, the permissions include at least:

- `api.read`
- `api.write`
- `pluginSettings.read`
- `pluginSettings.write`
- `host.resize`

### How to think about permissions

`api.read`

- the plugin can read Vellium data

`api.write`

- the plugin can change Vellium data

`pluginSettings.read / write`

- the plugin can read or update its own configuration

`host.resize`

- the plugin can resize its embedded iframe host

## When not to grant write-level access

Do not grant write access if:

- you do not understand what the plugin does
- the plugin came from an untrusted source
- you only need a read-only or visual workflow
- the plugin is only rendering or displaying information

If a plugin asks for `api.write`, treat it like a local script that can change your data.

## Bundled vs user plugins

Vellium distinguishes between:

- `bundled` plugins
- `user` plugins

Bundled plugins ship with the app. User plugins live in the user plugin directory and are usually managed by you manually or through Pluginfile import.

## Plugin settings

If a plugin registers its own settings fields, you can:

- open a dedicated settings form
- save values under that plugin's namespace
- configure the plugin without editing files manually

This matters for plugins that use external endpoints, custom UI behavior, or workflow-specific rules.

## Plugin tabs, slots, and actions

Plugins can appear in several places:

- as a new top-level tab
- as a slot widget inside chat, writing, or settings
- as an action in the toolbar, composer, message UI, or editor

For the user this means a plugin may look like:

- a whole extra workspace
- a compact embedded panel
- a context-sensitive action inside existing UI

## Themes

Vellium supports plugin-provided themes. That means a plugin can add its own visual theme to the available theme list.

Use this if:

- you want a shared visual package for a team
- you install a domain-specific UI plugin
- you want interface customization without patching CSS manually

## Plugin Dev Auto-Refresh

`Plugin Dev Auto-Refresh` exists in Settings for plugin development. It is useful when you edit local plugin files and want faster feedback without restarting the whole app.

For normal end users this toggle is often optional.

## How to use plugins safely

Recommended process:

1. Install the plugin.
2. Read its description, version, and source type.
3. Check its requested permissions.
4. Grant only the minimum permissions needed.
5. Enable the plugin.
6. If the plugin behaves unexpectedly, revoke permissions first and disable it second.

## How this relates to the app's security settings

Even if the plugin itself is well-behaved, Vellium's overall safety still depends on:

- Markdown sanitization
- external link policy
- remote image policy
- upload policy
- local-only and runtime restrictions

A plugin should never be treated as a replacement for the base security model.

## For plugin authors

If you need documentation about the manifest structure, SDK, slot IDs, or plugin layout, see:

- [../plugins/README.md](../plugins/README.md)

This page in the Vellium guide is focused on using plugins safely, not on authoring them.
