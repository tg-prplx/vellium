# Characters and LoreBooks

`Characters` and `LoreBooks` are two different but closely related layers of context.

- a `Character` describes one specific persona
- a `LoreBook` describes the world, facts, rules, terminology, and trigger-based context inserts

If you use RP, you will usually configure them together.

## Characters: why there is a dedicated screen

The separate `Characters` screen exists so you can:

- import ready-made character cards
- create new characters from scratch
- edit them through both GUI fields and raw JSON
- upload an avatar
- export the card back to JSON
- create translated copies

## Ways to create a character

Vellium supports several paths:

- import from a `.json` file
- paste JSON manually
- create a blank character
- load a sample character

This is useful if you:

- migrate cards from another RP tool
- want to build the character entirely inside Vellium
- just need sample data to test the UI quickly

## What a character card stores

The `Characters` screen exposes fields such as:

- `Name`
- `Description`
- `Personality`
- `Scenario`
- `First Message`
- `System Prompt`
- `Example Messages`
- `Creator Notes`
- `Tags`
- `Creator`
- `Character Version`
- `Post-History Instructions`
- `Alternate Greetings`
- `Creator Notes (Multilingual JSON)`
- `Extensions (JSON)`

This covers both basic RP cards and more advanced `chara_card_v2`-style cards.

## GUI and Raw JSON

The character editor in Vellium is bidirectional:

- GUI fields for normal editing
- a raw JSON panel for exact manual control

This is useful in two common cases:

- you want a fast visual editor
- you need to edit low-level fields or verify the exact card structure

Recommended practice:

- start in the GUI
- move to raw JSON only for fine-tuning, imports, or diagnostics

## Alternate Greetings

Vellium supports alternate greetings for one character. You can enter them:

- with the `---` separator
- as a JSON array

This is useful if you want several starting tones for the same character card.

## Avatar, Preview, and Export

Inside the character card you can:

- upload an avatar
- view the preview
- export the character JSON

Export is useful for:

- backups
- card sharing
- migration between machines or tools

## Translate Copy

Each character supports `Translate Copy`. This creates a separate translated version of the card.

Use it when:

- you have an English card and want a localized version
- you want several language-specific variants of the same character
- you want to preserve the original card unchanged

## LoreBooks: why they are separate

The `LoreBooks` screen is for world info and background context that should not live inside one character card.

Typical use cases:

- setting history
- social rules
- cities, factions, magic, technology
- terminology
- background facts that should be injected by trigger keys

## What you can do with a LoreBook

- create a new LoreBook
- import world info JSON
- edit the book and each entry
- export back to world info format
- create translated copies of trigger keys

## Entry structure

Each LoreBook entry contains at least:

- `Name`
- `Keys`
- `Content`
- `Enabled`
- `Constant`
- `Position`
- `Insertion Order`

### What the important fields mean

`Keys`

- the trigger words or phrases that activate the entry

`Constant`

- if enabled, the entry is treated as always active

`Position`

- defines where the entry is inserted relative to other parts of the prompt stack

Supported positions include:

- `after_char`
- `before_char`
- `after_scene`
- `before_scene`
- `after_system`
- `before_system`
- `after_jailbreak`
- `before_jailbreak`

`Insertion Order`

- gives you fine priority control when several entries land in the same area

## SillyTavern / World Info compatibility

Vellium explicitly supports:

- world info import and export
- compatibility with SillyTavern-like world info structures

That makes `LoreBooks` a practical migration target for existing RP material.

## When to use a character card vs a LoreBook

Use a `Character` when the information belongs to one character:

- personality
- speaking style
- greeting
- personal behavior
- a character-specific system prompt

Use a `LoreBook` when the information belongs to the world:

- setting canon
- terminology
- historical facts
- rules and restrictions

## Recommended workflow

1. Create or import the character.
2. Fill in the identity and speaking fields.
3. If the setting is complex, create a separate LoreBook.
4. Move shared world facts into the LoreBook instead of stuffing them into the character card.
5. In `Chat`, attach the correct character and LoreBook together.

## Practical Advice

- Do not turn the character card into an encyclopedia. That is what LoreBooks and knowledge collections are for.
- If the card structure becomes complex, keep the GUI as the main layer and raw JSON as the technical layer.
- For large worldbuilding sets, several focused entries work better than one giant blob.
- If you import many cards, use `Tags` and previews for navigation.
