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

The model emits only new characters or changed character state, once per batch. Reply token limits are unchanged. Shot prompts omit appearance/style already supplied by the renderer. Invalid JSON fails without a second automatic paid model call. Rendering or redrawing images uses ComfyUI only and never makes a text-model request. Prompt caching reduces eligible input work, not the cost of newly generated output.


Anima prompting follows the [model authors' guide](https://huggingface.co/circlestone-labs/Anima): descriptive English captions, clear subject/action and spatial relationships; at least two concrete sentences per shot, without invented artist or score tags. Style is prepended once from story settings.

Visual continuity stores a location description and current outfits only. A location reuses its initial description when revisited; outfits retain color, pattern, cut and straps until a scene explicitly changes them. These snapshots belong to individual scenes, so later wardrobe changes do not alter earlier frames. This is not plot-summary memory.

In first-person mode, the camera is the viewpoint character's eyes. The viewpoint ID is separate from visible character IDs. Their face/body is excluded from external portraits; only action-relevant hands may enter the foreground. Dynamic mode can mark individual frames as subjective; third-person frames use an external camera. Text-only conditioning improves the supplied constraints but cannot guarantee identical faces across diffusion samples.


## Discovery and deletion

On the first launch containing Novels, a one-time announcement links directly to Work → Novels and explains the hidden top navigation. It waits until the welcome tour closes. Closing it, pressing Escape or opening Novels acknowledges it for future launches.

Each book in the library has a separate delete button on its cover. Confirmation names the selected book; cancellation leaves it untouched. Successful deletion removes it immediately without reload. Errors remain in the confirmation dialog for retry. Deletion is disabled during active work. Story Settings also provides deletion for the currently open novel.


Visual changes are explicit events. A new location label or a repeated outfit does not replace the current anchors. To move location, the model supplies `locationChange: {line, quote}` referencing the exact complete scene line describing the move. Outfit changes use `outfitChanges: {characterId: {line, quote}}` separately. Invalid references are ignored. Current visual snapshots override older clothing data in context. Free-form shot sentences that introduce competing outfits, appearance or setting are filtered from image prompts. Related shots at the same established location share a noise seed; this reduces rerolling but is not a guarantee of identical diffusion outputs.

## Optional automatic speech

The reading toolbar has **Auto TTS**, off by default. Its preference is saved separately for each novel on this device. It uses the endpoint, model, voice and realtime option from Settings → Voice, including the existing local TeraTTS path. Only the current dialogue/narration line is sent for speech; enabling it does not generate new story text or images.

Changing lines cancels the previous speech request and stops playback. Opening the journal, story settings or another screen also stops speech. **Play this line** starts or repeats the current line; **Stop speech** pauses it, and Escape stops both automatic reading and speech. Closing a panel does not silently synthesize the interrupted line again: use Play this line to resume. Recent non-streaming audio is cached in memory (at most four clips, up to 4 MB each); streaming speech is not cached.

With both Auto and Auto TTS enabled, automatic reading waits for speech to finish and pauses at reader choices. TTS failures stop automatic advancement and offer an explicit retry or a link to TTS settings. No automatic paid retries are made. When speech begins, the complete current line is revealed immediately; long dialogue scroll resets when moving to a different line.


Illustration settings provide a segmented style switch: Cinematic (default), Painterly, Anime key visual, Manga and Custom. Cinematic uses polished game key art, refined layered shading, rich jewel-tone color harmony and detailed environmental illustration. Painterly uses gouache textures; Anime uses fine lineart and layered cel shading; Manga uses monochrome ink and screentones. The selected prompt is saved in the existing artStyle field. Custom text survives switching to another preset and back while the editor stays open. Both exact previous factory styles (the earlier flat cel-shaded preset and "hand-painted visual novel, cinematic lighting, detailed scenery, no text") and missing values upgrade to it; customized styles remain unchanged. This upgrade is also applied when reading older novels and composing image prompts. Shot-level media/style/lighting directions are filtered so they cannot compete with the style and set anchors. Existing English wardrobe descriptions embedded in legacy appearance fields are extracted as fixed clothing; they are not regenerated. An old location with only a display name can establish its detailed visual description once on continuation, then retains it.


## Automatic context compaction

Before continuing a novel, Vellium measures the remaining history against the configured context character budget, reserving space for the system prompt, current state and a compact checkpoint. Near the limit, older turns are summarized and recent turns are retained verbatim when they fit. The model uses the checkpoint plus the remaining full turns; the journal and saved original scenes/turns are never deleted.

Compaction is a separate bounded request (up to 512 output tokens per pass), not another field generated on every scene. It uses the configured compression provider/model, falling back to the novel provider/model. Full Local Mode and parameter policies still apply. Large old histories are processed in bounded slices. Each successful slice checkpoints its position before continuing, so cancellation or a later generation failure does not cause completed slices to be summarized again. An empty or failed summary stops continuation without silently discarding history or making an automatic retry. The existing task's Stop button cancels compaction too.

Earlier events are visible in Story Memory after compaction. This checkpoint records plot continuity only. Current character state, appearance, clothes, location design and art style remain authoritative in their existing separate anchors; compaction cannot update them. The prompt cache stays stable between compaction checkpoints and warms again when a checkpoint changes.
