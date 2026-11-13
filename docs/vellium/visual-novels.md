# Visual novels

Open **Work → Novels** to create or resume a visual novel. The workspace fills
the window without an outer frame. Move the cursor to the top edge to reveal
Vellium navigation; keyboard focus also reveals it. On touchscreens, tap the
small top handle. Stories, scene text,
illustrations, reading bookmarks and generation memory are stored in the active
local Vellium data profile.

## Create a story

A short navigation hint appears on the first visit. It can be shown again with
**Where is the navigation?** in the story library. Creation follows four steps:
Idea, Narrator, Illustrations, and Start. A draft is kept while Vellium stays open,
including when the creation window is closed or provider settings are opened.


1. Enter a premise and optionally a protagonist, tone and creative direction.
2. Optionally select characters from the Vellium library. Their cards are copied
   into the new story: later library edits or deletions do not rewrite its cast.
   Without a selection, the narrator creates characters as it writes.
3. In **Narrator**, select a saved Vellium provider and model. This selection is
   independent of the active chat model. You can enter a model ID manually.
4. Select first, second, third or dynamic point of view. An optional viewpoint
   character fixes the focus; dynamic mode can change focus between scenes.
5. Set the maximum scenes per generation and reader-question frequency.
6. Review the summary and choose **Create and write opening**. This saves the new
   story and immediately asks the selected model to generate its first scenes.

Only the premise and a narrator model are required. The title, detailed
protagonist and imported cast are optional. Advanced token limits, workflow
node IDs and image dimensions live in expandable sections.

Questions are model-driven. Rare allows a question no sooner than every fourth
scene; balanced every second scene; frequent allows one in any scene. These are
minimum intervals, not a command to force questions. A question ends the current
batch and the next request includes the reader's choice or custom answer. Off
suppresses questions entirely.

## Illustrations

Enable illustrations in the Visuals tab and import a ComfyUI workflow in **API
format**. The ComfyUI endpoint must be reachable from Vellium's server. Workflow
model files and custom nodes must already be installed in ComfyUI. Authentication
at the ComfyUI endpoint is not configured by this screen.

The model can propose up to four frames per scene and place them at different
lines. Prompts combine the art style, the participating characters' appearance
and current state, and the shot description. Sampler parameters and model loaders
from the imported workflow are preserved; prompt text, seed and latent resolution
are updated. Blank positive/negative node IDs use conditioning-link detection.

Text is saved before rendering starts. Each completed frame is saved separately.
Failed frames can be retried individually; successful frames and story text stay
intact. Redrawing a frame preserves its seed. Stopping generation cancels Vellium's
wait, but does not interrupt other users' ComfyUI jobs. Pending prompt IDs are
saved, so resuming can retrieve an accepted job rather than duplicating it.

## Reading and memory

Click anywhere on the scene or dialogue, press Space/Enter/Right Arrow, or use Next to advance. The first click reveals an animating line; the next advances it. Left Arrow
returns to the previous line. The scene strip jumps between already-written
scenes. Move over the top story controls or focus them with Tab to reveal them; the lower toolbar appears over the dialogue. The compact dialogue panel leaves the artwork visible and long lines scroll inside it. Auto reads until a question; H hides the interface and Escape shows it.
The reading position is saved automatically; Bookmark saves it immediately. All generated scenes and
frames are saved automatically; no browser storage export is needed.

Story Memory keeps character identities, stable visual descriptions and concise current state (location, knowledge, injuries and relevant relationship changes). Recent scenes provide plot context. There are no per-scene plot summaries, fact lists or thread lists. A separate short checkpoint summarizes older events only when context reaches its budget. Legacy stored bookkeeping is preserved for compatibility but excluded from model context, including historical turns.

Image prompts combine only the visible cast's fixed appearance, scene setting, art style and shot description. Mental state and off-screen cast are excluded. This is text-only continuity: no reference-image integration is assumed, and identical faces are not guaranteed. The configured novel width and height (default 1344×768) are applied to the primary sampler's latent; auxiliary latents are preserved. Imported negative conditioning is preserved unless its override is enabled. Secondary sampler settings remain intact. The first shot belongs to line zero, and each finished image is published before waiting for the rest of the queue.

## Prompt caching

The system prefix contains the stable world, initial cast and output contract.
New request/response turns are reused unchanged; legacy memory-heavy turns are projected deterministically to remove old plot bookkeeping. Character state,
reader input and question policy follow at the end. Image rendering never rewrites
those text turns. When the context budget is exceeded, the oldest complete turns
are replaced only after a summary checkpoint has been successfully saved; current character identities and visual state remain separate.

This layout makes automatic provider prefix caching possible. It does not add a
local answer cache, replay old generations, or promise a provider cache hit. The
memory panel displays cached/input token counts when the provider reports them;
missing usage is not presented as a confirmed zero. Output and reasoning token counts are shown separately when reported. OpenRouter novel requests use a stable session ID, with automatic cache control for Anthropic models; OpenAI requests use a stable prompt cache key. Other compatible endpoints receive no unsupported hints. Changing story
settings changes the prefix and can invalidate previously cached tokens.

The model emits only new characters or changed character state, once per batch. Reply token limits are unchanged. Shot prompts omit appearance/style already supplied by the renderer. Malformed JSON is repaired locally where boundaries are unambiguous: missing/repeated/trailing commas, single-quoted strings, unquoted keys, Markdown wrappers and missing closing delimiters are tolerated. Completed scenes, lines, image plans and character profiles survive; an unfinished string is discarded rather than invented. Unrecoverable responses or responses with no complete story text fail without a second automatic paid model call. The original assistant response is retained byte-for-byte for prompt caching. Rendering or redrawing images uses ComfyUI only and never makes a text-model request. Prompt caching reduces eligible input work, not the cost of newly generated output.


Anima prompting follows the [model authors' guide](https://huggingface.co/circlestone-labs/Anima): descriptive English captions, clear subject/action and spatial relationships; short action/composition captions, without invented artist or score tags; the assembled prompt supplies the stable visual description. Style is prepended once from story settings.

Visual continuity stores a location description and current outfits only. A location reuses its initial description when revisited; outfits retain color, pattern, cut and straps until a scene explicitly changes them. These snapshots belong to individual scenes, so later wardrobe changes do not alter earlier frames. This is not plot-summary memory.

In first-person image-camera mode, the camera is the viewpoint character's eyes, independently of narrative person. The viewpoint ID is separate from visible character IDs. Their face/body is excluded from external portraits; only action-relevant hands may enter the foreground. Dynamic mode can mark individual frames as subjective; third-person frames use an external camera. Text-only conditioning improves the supplied constraints but cannot guarantee identical faces across diffusion samples.


## Discovery and deletion

On the first launch containing Novels, a one-time announcement links directly to Work → Novels and explains the hidden top navigation. It waits until the welcome tour closes. Closing it, pressing Escape or opening Novels acknowledges it for future launches.

Each book in the library has a separate delete button on its cover. Confirmation names the selected book; cancellation leaves it untouched. Successful deletion removes it immediately without reload. Errors remain in the confirmation dialog for retry. Deletion is disabled during active work. Story Settings also provides deletion for the currently open novel.


Visual changes are explicit events. A new location label or a repeated outfit does not replace the current anchors. To move location, the model supplies `locationChange: lineIndex` referencing the complete scene line describing the move. Outfit changes use `outfitChanges: {characterId: lineIndex}` separately. The legacy `{line, quote}` forms are also accepted. Invalid references are ignored. Current visual snapshots override older clothing data in context. Free-form shot sentences that introduce competing outfits, appearance or setting are filtered from image prompts. Each scene and shot has a distinct deterministic noise seed, retained on retries; continuity is supplied by explicit visual anchors rather than identical noise.

## Optional automatic speech

The reading toolbar has **Auto TTS**, off by default. Its preference is saved separately for each novel on this device. It uses the endpoint, model, voice and realtime option from Settings → Voice, including the existing local TeraTTS path. Only the current dialogue/narration line is sent for speech; enabling it does not generate new story text or images.

Changing lines cancels the previous speech request and stops playback. Opening the journal, story settings or another screen also stops speech. **Play this line** starts or repeats the current line; **Stop speech** pauses it, and Escape stops both automatic reading and speech. Closing a panel does not silently synthesize the interrupted line again: use Play this line to resume. Recent non-streaming audio is cached in memory (at most four clips, up to 4 MB each); streaming speech is not cached.

With both Auto and Auto TTS enabled, automatic reading waits for speech to finish and pauses at reader choices. TTS failures stop automatic advancement and offer an explicit retry or a link to TTS settings. No automatic paid retries are made. When speech begins, the complete current line is revealed immediately; long dialogue scroll resets when moving to a different line.


Illustration settings provide a segmented style switch: Cinematic (default), Painterly, Anime key visual, Manga and Custom. Cinematic uses polished game key art, refined layered shading, rich jewel-tone color harmony and detailed environmental illustration. Painterly uses gouache textures; Anime uses fine lineart and layered cel shading; Manga uses monochrome ink and screentones. The selected prompt is saved in the existing artStyle field. Custom text survives switching to another preset and back while the editor stays open. Both exact previous factory styles (the earlier flat cel-shaded preset and "hand-painted visual novel, cinematic lighting, detailed scenery, no text") and missing values upgrade to it; customized styles remain unchanged. This upgrade is also applied when reading older novels and composing image prompts. Shot-level media/style/lighting directions are filtered so they cannot compete with the style and set anchors. Existing English wardrobe descriptions embedded in legacy appearance fields are extracted as fixed clothing; they are not regenerated. An old location with only a display name can establish its detailed visual description once on continuation, then retains it.


## Automatic context compaction

Before continuing a novel, Vellium measures the remaining history against the configured context character budget, reserving space for the system prompt, current state and a compact checkpoint. Near the limit, older turns are summarized and recent turns are retained verbatim when they fit. The model uses the checkpoint plus the remaining full turns; the journal and saved original scenes/turns are never deleted.

Compaction is a separate bounded request (up to 512 output tokens per pass), not another field generated on every scene. It uses the configured compression provider/model, falling back to the novel provider/model. Full Local Mode and parameter policies still apply. Large old histories are processed in bounded slices. Each successful slice checkpoints its position before continuing, so cancellation or a later generation failure does not cause completed slices to be summarized again. An empty or failed summary stops continuation without silently discarding history or making an automatic retry. The existing task's Stop button cancels compaction too.

Earlier events are visible in Story Memory after compaction. This checkpoint records plot continuity only. Current character state, appearance, clothes, location design and art style remain authoritative in their existing separate anchors; compaction cannot update them. The prompt cache stays stable between compaction checkpoints and warms again when a checkpoint changes.


### Shot planning and in-reader settings

Frames per scene is a per-scene maximum. The narrator is instructed to use at least two shots for a developed scene (six or more lines) when the maximum allows it, and to cover important actions, reactions, reveals and changes of camera subject even in shorter scenes. Brief single-beat scenes and a maximum of one can still use one shot. This is a generation instruction, not a server-created extra image or an automatic paid retry. The model selects visual beats after writing the lines, anchors the opening at line zero, and attaches each later cut to the first line showing its action/reveal. The current frame persists between cuts. Duplicate line indices are dropped, never moved to arbitrary following lines. Each frame specifies only the visible subject IDs: a speaker may remain off screen, a solo close-up excludes the rest of the cast, and object/environment frames use an empty list. A locally recovered opening with no model plan is environment-only rather than guessing that all speakers are visible.

Story Settings is available from the reading toolbar and with **S**, as well as the top controls. Text settings apply to subsequent generation; style, workflow and image parameters apply on the next image render. Save settings and use Redraw frame to update the current picture without regenerating story prose. Settings remain blocked during active generation to prevent revision races.


Novel generation accepts 1–20 scenes per request (6 by default for newly created novels). Existing chosen batch sizes remain unchanged. The reply-token budget is not raised automatically; the model may complete fewer scenes or stop at a reader choice. Every scene gets its own image plan. A fixed location does not require identical framing: shots use independent seeds while retaining the same place, clothes and style. ComfyUI final SaveImage output takes precedence over preview outputs.

**Reset history** in Story Settings clears generated scenes and image references, reading progress, generated cast, usage statistics and context checkpoints. It retains the novel ID, title, configuration, workflow and original cast snapshot. The reset has a named confirmation, rejects stale revisions and is blocked during generation. It makes no model calls. Start a new opening afterward in the same novel. Existing uploaded image files are not deleted as part of this reset.

### Editable generation system prompt

Story Settings → Narrator → Generation system prompt displays the actual server default, without making a model call. Editing replaces these instructions for that novel; world, cast, POV settings, current state, reader input and compacted context are still attached separately. Preserve the scenes JSON contract when customizing. An empty value or Restore default prompt returns to the current standard instructions. Changes affect the next generation and survive history reset. Preview loading errors offer retry without overwriting a custom prompt.

### Cards containing several people

A duo, family, team or universe card remains a shared source. The narrator declares individual visual profiles once, linked to the original card through sourceCharacterId. Each person has their own stable ID, appearance and outfit. Existing library cards are not rewritten, and splitting adds no separate model request.

Illustrations list only visible people through individual characterIds and subjectNames. A shared card ID can resolve to a named member after profiles exist; individual profiles are preferred for solo frames. Older or partially split cards do not block image generation: named passages are used where available; otherwise shared context is sent with instructions to follow the shot and keep unrelated members off screen. This fallback does not create permanent profiles or make another text-model request. Separate profiles from subsequent narration provide stronger identity anchors; custom prompts should include these declarations too.

### Scene metadata deltas

The default narrator prompt requests lines and image plans rather than a full scene header every time. Omitted location, setting and viewpoint inherit the current state across scenes and turns. A new place gets one compact visual anchor (the prompt asks for at most 240 characters); returning to a known place reuses its saved anchor. Actual moves still require the existing locationChange evidence. This does not shorten previously saved descriptions.

Scene titles are optional; missing titles use the first line's opening text locally for the journal. Fixed first-person images inherit the camera and viewpoint, while dynamic subjective shots still identify their viewpoint explicitly. Older complete scene JSON and custom prompts remain supported. Original model responses are retained for prefix caching, not rewritten to remove repeated fields after they have already cost output tokens.

Other output fields follow the same rule: omit fixed-camera fields, opening atLine=0, duplicate subjectNames when individual IDs are sufficient, empty question/choices/characters, and unchanged character state or wardrobe. Later cuts retain explicit atLine; dynamic subjective shots retain camera/viewpoint. Narration can be plain strings; dialogue retains speaker/text. Shot captions describe only new action/framing in one or two short sentences. IDs for stored scenes/images, seeds, URLs, timestamps and workflow data are server-owned and are not requested from the narrator.

New move/clothing events cite zero-based narrative line indices (`locationChange: 3`, `outfitChanges: {"person-id": 4}`), avoiding a second copy of the full prose line. The cited line must exist and be complete (at least 12 characters). Legacy `{line, quote}` events remain supported and still require an exact text match. Location changes need their event with illustrations disabled too.

### Opening prose and exposition

Compact metadata does not mean compacted story prose. The current request explicitly identifies opening versus continuation. The standard prompt asks the first opening to begin with 2–4 readable narration passages establishing surroundings, atmosphere, present characters, relevant background and the immediate situation before developing dialogue/action. Narrative description belongs in lines; location/setting fields do not substitute for it. A new story also establishes its initial visual anchors once, because nothing is available to inherit yet. Continuations develop reactions and consequences and introduce changed surroundings/newcomers without repeating the entire opening. These are narrator instructions; parsing does not fabricate missing exposition or make automatic paid retries.

### Structured output (LM Studio)

Narrator → Advanced generation → Structured output offers Auto (default), JSON schema and Off. Auto recognizes LM Studio provider names/IDs or its default port 1234, including LAN endpoints. For a renamed profile on a custom port, choose JSON schema explicitly. Only OpenAI-compatible transports receive response_format; normal chat, compression, KoboldCpp and custom adapters are unchanged.

The novel request uses LM Studio's response_format: json_schema contract. The schema requires a nonempty scenes/lines structure and typed image plans/cast, while keeping unchanged metadata optional. Narration strings, dialogue objects, compound-card members and compact change indices remain supported. Schema limits follow the chosen scene/frame maxima. The schema is sent as a transport parameter, not duplicated inside the prompt.

If the server explicitly rejects the schema/structured-output format (400, 422, 500 or 501 with a format/schema/grammar error), Vellium retries once with identical messages and sampling but no response_format. No second downgrade is made; authentication, unknown-model errors, connection failures and successful malformed replies do not trigger this fallback. Successful unstructured responses still use the local JSON recovery path. An incomplete answer can still exhaust its reply budget; the schema does not guarantee story quality or recover unwritten text.

Protocol reference: https://lmstudio.ai/docs/developer/openai-compat/structured-output

### Image POV is independent of prose

Illustrations → Image camera controls pictures independently of Narrator → Narrative perspective. Modes: First person (through a chosen character’s eyes), External camera, Over the shoulder, and Dynamic (default). The optional camera viewpoint character is separate from the prose viewpoint. Existing novels without an imagePov setting now use dynamic image framing rather than inheriting first-person prose.

Dynamic mode requires a camera on every shot in both instructions and JSON schema; values are external, first-person and over-shoulder. Subjective shots identify their own viewpointCharacterId. Fixed camera settings override old per-frame camera flags when redrawing; narration remains unchanged. Over-shoulder framing includes the viewpoint’s back/shoulder identity and clothing, while first-person framing excludes their visible body. Saving camera settings and redrawing applies them to existing images without generating new prose.

### Reliable decisions and free-form input

Question frequency now schedules a decision: Frequent every scene, Balanced every two, Rare every four; Off leaves continuation autonomous. The next generation stops at the upcoming decision boundary, within the chosen scene maximum. When that boundary fits the batch, the structured schema requires root-level question and 2–4 choices, emitted once for the final scene. With small batches, intermediate continuations omit the decision until its scene is reached. Legacy per-scene questions are still accepted. If a truncated or unstructured reply lacks choices, prose survives without fabricated options or another model call.

A free-form reply/action field is available at the end of every generated fragment, including with questions off or missing. It is not restricted to the suggested buttons. Typing pauses auto-reading, submissions are protected against duplicates, and a failed send preserves the draft. New actions extend the current generated timeline; browsing earlier scenes does not submit an action into a different point in history.

### Cards as a complete story foundation

Story → Story foundation from cards selects up to three library cards. A single source can define the world, characters, relationships and starting situation together; its characters do not need to be selected again in the separate cast picker. Cards may also describe a world alone or one character. Additional premise text is optional when a selected source has story content; the user may add directions or additional cast independently.

The server snapshots description (up to 12000 characters), scenario (8000), personality (2000), system instructions (4000), continuation instructions (2000), opening sample (3000) and example dialogue (2000). The snapshots appear once in the stable system SETTINGS.storySources as story/tone data. {{char}}/{{user}} resolve from the source name and configured protagonist/viewpoint when composing the request. These fields guide the fiction, while the novel output contract remains authoritative. There is no separate paid extraction request.

On normal generation the narrator extracts individual cast profiles from the same source, linked through sourceCharacterId; a source title that describes a world does not become a person. Reused source IDs are split into stable individual IDs locally. Source snapshots themselves are not added as visual people or copied into character memory.

Settings can add/remove source cards for future generation. Retained selections keep their existing snapshots even after library edits/deletion; newly selected IDs load from the library. Reset history keeps the selected sources and starts fresh generated character memory. Sources and cast have independent selections, and old novels without source cards keep their existing behavior. Snapshots are server-owned; sending custom snapshot objects through the API cannot replace library content.

### Lite generation mode (small local models)

Settings › Narrator › Generation mode offers **Lite — plain text** alongside the
original **Structured — single JSON reply**. Existing stories stay structured;
new stories default to structured until lite mode has been checked on real
local models.

- The model writes ordinary story lines: narration as plain prose,
  `Name: words` for speech, `## Place` when the place changes and, only when a
  decision is due, `? question` followed by 2-4 `> option` lines. Vellium builds
  scenes from these lines. Any line that matches no rule becomes narration, so
  a reply cannot be lost to broken JSON; only an empty reply is rejected.
- Text streams into the reader: completed lines appear while the model is still
  writing, and the saved scenes keep the same IDs, so speech playback is not
  interrupted when the turn is stored.
- The system prompt is about 1 KB instead of about 8 KB. History contains prose
  only, without image plans, IDs or metadata.
- **Prompt cache.** Every request extends the previous one byte for byte: the
  user message is stored exactly as it was sent and a reply is replayed with its
  original bytes when it already follows the format (otherwise in canonical
  form). Everything that changes per turn — line count, whether a choice is due,
  world notes — is in the last user message, never in the system message.
- **Director follow-up.** When illustrations are enabled, or a scheduled choice
  is missing from the text, one short technical turn is appended to the same
  conversation: the model lists new people, places, shots, outfit changes and,
  if needed, the question and options. It has no system prompt of its own, so
  the cached prefix is reused and the story's own instructions still apply. The
  exchange is not added to history. With structured output (explicit JSON
  schema or LM Studio in auto mode) it uses a small schema; otherwise a
  `PERSON | …`, `SHOT | …` line format. Shots point at lines by copying their
  first words, and people are named rather than given IDs; the server resolves
  both. If the follow-up fails, the turn is kept and each scene gets an
  establishing shot. Without the line format a camera cannot be chosen per shot.
- **Compaction.** Without a separate compression model, old turns are
  summarised by appending a summary request to the cached conversation instead
  of sending a separate prompt. A configured compression model keeps the
  original separate request.
- Reply token limits and request timeouts allow up to 20 minutes per turn for
  slow local models; Stop cancels at any time.

Measured on a synthetic five-turn story with identical prose (sixth request):
system message 8167 → 1030 characters, whole request 20 924 → 7 229
characters, model reply per turn 1 942 → 1 106 characters (plus a director
reply of a few hundred characters when pictures or a choice are needed).

### Backgrounds and sprites (layers mode)

Settings › Visuals › Picture layout offers **Full frames** (unchanged: every
scene gets its own illustrations) and **Backgrounds and sprites**, available
with the Lite generation mode.

- **One background per place**, keyed by the scene's place name, and **one
  sprite per character and outfit**. Both are rendered once and reused across
  scenes; a new background or sprite is queued only for a new place, a new
  person or a changed outfit. Backgrounds render first, so the stage is usable
  soonest, then sprites, then full frames.
- **Who is on screen** is derived from the prose by the server, without a model
  call: speakers and people named in narration, in order of appearance, at most
  three. A first- or second-person narrator stays behind the camera. The reader
  places one sprite in the centre, two left and right, three left, centre and
  right; while someone speaks the others are dimmed.
- **Full pictures are kept for action.** The director lists an `events` picture
  for each moment standing sprites cannot show — physical action, a hug, a kiss
  or a fight, something done to the narrator, a reveal — at most one per scene,
  none for scenes that are only talking. It starts at the line where the moment
  happens and covers the background and sprites from there to the end of the
  scene.
- **Background removal runs in Vellium, without a neural model.** Sprites are
  drawn on a chroma-key backdrop the character does not wear: `vivid green`,
  else `vivid blue` (green in the description), else `magenta`. Measured on
  Anima 1.1 turbo, plain `green`/`blue` come out muted or near grey and merge
  with pale hair, while the `vivid …` and `magenta` phrasings come out
  saturated. The backdrop colour is measured from the image border and grown
  inward through small colour steps, so gradients, vignettes and drop shadows
  are removed too; enclosed gaps of backdrop colour are cleared, and edge
  colour is pulled toward the figure. If the measured backdrop is washed out,
  the cut-out runs in a cautious mode that never clears enclosed areas.
  Removing a backdrop takes about 0.1 s per sprite. A result that does not look
  like one figure on a backdrop is rejected; the sprite is drawn once more with
  a new seed, and if that also fails the plain image is shown as a framed card.
  PNG output is required; other formats are shown uncut.
- Sprites are rendered at 832 × 1216 regardless of the configured image size;
  backgrounds and full frames use the configured size.

### Picture tools in the reader

All picture actions start only from a click; nothing is redrawn automatically.

- **Redraw frame** renders the picture on screen again with a new seed (a full
  frame, or in layers mode the place's background).
- **Edit picture** changes its description and redraws it. For a frame the
  description is what the camera sees; style, appearance and place are still
  added automatically. For a background or sprite it is the full prompt.
- **Picture for this line** adds a full frame starting at the current line, or
  replaces the one already starting there. An empty description draws what the
  line says. No language model is involved.
- **Check connection** on the Visuals step contacts ComfyUI and dry-runs the
  imported workflow, reporting the prompt node it found. No job is queued.

### Persona as the protagonist

The Story step has a **Protagonist** choice: a user persona from the library or
a manual description. A new story starts with the default persona. The persona
is snapshotted into the story (name, description, personality), so editing or
deleting it in the library does not change a running story; choosing another
persona or the manual field takes a new snapshot. The persona's name and
description fill the protagonist line of the prompt, `{{user}}` in source cards
becomes its name, and its name is recognised as a speaker. Changing the
protagonist of a started story changes the cached system prefix, so the model
re-reads the whole context once; the setup screen says so.

### Chat ↔ novel

- **Chat › To novel** (the More actions menu in the simple layout, the toolbar in
  the full layout) creates a Lite novel from the active branch: the chat's
  characters in chat order, the chat summary — or else the first scenario found
  on their cards — as the premise, the active provider and model, and the
  default persona. The newest messages (at most 30 and about 12 000 characters,
  deleted ones and other branches excluded, reasoning removed) become the opening
  scenes: assistant paragraphs as narration, user messages as the protagonist's
  lines. The novel opens immediately; the chat is not changed.
- **Reader › Continue in chat** creates an ordinary chat with the same
  characters. The latest scenes (about 6 000 characters) become its first
  message as plain paragraphs, and the earlier-story summary plus the premise
  become the chat's context summary. The chat opens immediately; the novel is
  not changed.

### Knowledge (RAG)

The Story step can select up to five knowledge collections (Lite mode). Each
turn searches them with the reader's action and the last two lines of the
story, through the regular RAG service and its provider and Full Local Mode
checks, and adds up to 1 500 characters of matches to that turn's message as
reference notes. They are never put into the cached system prefix. A failed or
empty search does not block the turn.

### Export to Writer

**Reader › To Writer** copies the story's prose into a new Writer project: one
chapter per five scenes, named after its first scene, and one Writer scene per
novel scene in story order, with narration as paragraphs and speech as
`Name: line`. The project gets the novel's characters and premise. The Writer
project list refreshes even if that screen is already open; the novel is not
changed.

LoreBook support for novels is planned separately and not part of this release.

### Clothing changes and picture wording

- The director follow-up is shown what the people in the new scenes currently
  wear and gives a changed outfit as the **complete** clothing right after the
  change ("no clothing" when nothing is worn), not a fragment such as "without
  the jacket". If its quoted line cannot be found, the change still applies from
  the first full line of the last new scene.
- When an outfit is known, clothing is removed from the appearance text clause
  by clause (hair, face and build stay), so clothing written into a character
  card is never drawn on top of the current outfit. Sprites use the same rule.
- Shot descriptions keep actions that involve clothing or the place ("pulls her
  swimsuit strap down", "sits on the towel"); only static descriptions that
  would compete with the anchors ("she wears…", "the background is…", bare
  noun lists) are dropped.
- Framing is written in plain picture terms. Anima takes text literally: "camera
  view" produced a lens vignette and "other speakers" produced loudspeakers, so
  neither word is sent; "looks at the camera" becomes "looks at the viewer".

### Picture lines inside the story (hybrid)

Settings › Visuals › **Mark pictures inside the story text** (Lite mode, on for
new stories) lets the narrator describe pictures while it writes, in the same
reply, so a second request is usually not needed:

```
## Harbour cafe
[place: small wooden cafe, warm lamps, rain on the windows]
[pic: Mira | Mira stands in the doorway, shaking rain off her hood.]
Mira steps in from the rain.
[new: Mira | young woman, short silver hair, grey eyes | dark green raincoat]
[wear: Mira | white knit sweater, black boots]
```

- `[pic: visible people | what is seen]` starts a frame at the following line
  (in layers mode only for action standing sprites cannot show);
  `[new: …]` describes a person the first time they appear, before any picture
  of them; `[wear: …]` gives everything someone wears after a change;
  `[place: …]` describes a new place after its `##` line. These lines are never
  shown to the reader and stay in the replayed history, so later turns see the
  format in use and the prompt cache keeps extending byte for byte.
- Names in picture lines are written exactly as in the story (a Russian story
  writes `[new: Мира | …]`); only descriptions are in English, so lines and
  speakers match.
- The separate follow-up still runs, but only for gaps: a scheduled choice the
  text forgot, no picture lines at all in full-frames mode, or someone shown in
  a picture (in layers mode: anyone who speaks, for their sprite) who was never
  described. Speakers who appear in no picture need no description. Picture
  lines written by the narrator win over the follow-up. While the follow-up
  runs, the reader status and the task list say why (for example "Follow-up
  request: the text has no choice"); the reason is also kept on the turn.
- The option is on for every Lite story unless switched off, including stories
  created before it existed.
- **Picture density.** The rules ask for a `[pic]` line at the start of every
  scene and then about every 4 story lines. A scene that gets fewer than one
  picture per 5 lines (capped by Frames per scene) counts as a gap: the
  follow-up plans pictures and only those landing more than a line away from
  the narrator's own are added ("Follow-up request: the text has too few [pic]
  lines"). When a scene has more cuts than Frames per scene allows, the opening
  is kept and the rest are spread evenly over the scene instead of keeping the
  first few.
- **Teaching the format.** The prompt's format example itself contains
  `[place]`, `[pic]`, `[new]` and `[wear]` lines (small models copy examples far
  more reliably than rules), and each turn ends with a concrete reminder ("Start
  with a [pic: names | what is seen] line…"). When the follow-up had to fill
  gaps, the turn is replayed in history as finally drawn — with the picture
  lines and any choice it added — so the next turn sees the format in use rather
  than a reply without it. That costs one re-read of that reply on the next
  request, and only after a follow-up ran.
- **Rendering during the stream.** When ComfyUI and the language model run on
  different machines, each `[pic]` frame is queued in ComfyUI as soon as its
  line is complete, once everyone in it has been described. The saved frame
  adopts that job only if its final prompt and seed are identical; otherwise it
  renders normally afterwards. On one machine nothing is queued early, so the
  two never compete for the same GPU.
- Outfits are still stored per scene, but a frame before a mid-scene clothing
  change keeps the clothes worn at its own line.

Measured live (synthetic model on this machine, ComfyUI on another): ComfyUI
was busy 2.4 s into a 5.2 s reply, both frames were adopted from the early
queue, and the second frame showed the clothing change while the first kept the
earlier outfit.

### The protagonist in pictures

- The protagonist (the chosen persona, or the protagonist field) is a drawable
  person for pictures even without a story character entry: the persona's
  description is used as their looks.
- In first- and second-person stories picture lines name the narrator `me`,
  and may end with a camera hint: `| pov` (through the narrator's eyes),
  `| wide`, or `| over-shoulder`. The director's line format accepts the same
  hint. Without a hint, in dynamic camera mode a picture that involves the
  narrator ("from my hand", `me` among the names) is drawn through their eyes;
  others are drawn from outside. The same inference applies when any mode's
  model leaves the camera out.
- Through the narrator's eyes, a picture about "my hand/palm/fingers/arm" adds
  `pov hands`, so their hands appear in the action while they stay off screen.
- From outside, a picture about the narrator includes the protagonist, and
  "my"/"me" in its description become their name, since an outside view has no
  "my". Multi-person pictures add head-count tags such as `1girl, 1boy` when
  everyone's sex is clear from their description; Anima follows these better
  than "only 2 people". It can still duplicate a person on some seeds — use
  Redraw for a new seed.

### Consistent looks and clothes for every drawn person

- Each person can carry a short English **picture look** (age, skin tone, face,
  hair, eyes, build). Pictures and sprites use it instead of the character
  card's prose, which is often long, not English and silent on skin tone and
  build, so the image model guessed anew on every frame.
- When someone appears in a picture (in layers mode: anyone who speaks) without
  a picture look or without known clothes — typically a character from a card —
  the follow-up describes them once ("Follow-up request: describe Мика"). The
  look and clothes are stored on the person and reused in every later picture;
  the card text itself is never rewritten. People introduced with `[new: …]`
  get their look and clothes from that line. The narrator seen through their own
  eyes is not drawn and needs no description.
- In Structured (JSON) mode there is no follow-up, so the same request asks
  for it: each turn's message lists known people still missing a look or
  clothes (`describeForPictures`, at most eight, never in the cached system
  prefix), and the model adds `{"id", "look", "outfit"}` to `characters` the
  first time one of them appears. The strict schema accepts `look`.
- Even with identical descriptions the image model varies proportions somewhat
  between seeds; a more specific build in the look reduces it.
