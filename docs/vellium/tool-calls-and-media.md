# Tool Calls and Generated Images

Vellium can display both ordinary text tool results and images returned by MCP tools. Generated images are treated as chat artifacts: they stay attached to the tool trace, show a stable preview state, and can be opened in the same preview modal as uploaded images.

## What the user sees

During generation, the response contains a collapsible `Tool Call` section.

Each call shows:

- the tool name
- `running` or `done` state
- the arguments sent to the tool
- a text result, or a generated-media preview

An image result has four UI states:

1. `Loading` — the thumbnail keeps its final size and shows a skeleton.
2. `Ready` — the image appears with its label and preview affordance.
3. `Preview` — clicking it opens Vellium's image viewer rather than a raw browser tab.
4. `Unavailable` — a stable error surface replaces a broken image icon.

This means a slow or expired image URL does not resize the surrounding message or make the conversation jump.

## Uploaded images versus tool-generated images

| Source | How it enters Chat | Where it appears | Click behavior |
| --- | --- | --- | --- |
| User attachment | File picker or paste | Composer and sent message | Opens the attachment preview |
| Tool-generated image | MCP structured result | Tool result inside the assistant response | Opens the same image preview |
| Markdown image | Assistant message Markdown | Message content | Uses the normal safe Markdown image policy |

Tool-generated media and uploaded attachments share the same visual language, but they remain separate data types. An MCP result is not silently added to the user's upload list.

## MCP response contract

An MCP tool should return image metadata through `structuredContent`. Vellium checks these fields in order:

1. `structuredContent.vellium.media`
2. `structuredContent.media`
3. `structuredContent.images`

Recommended payload:

```json
{
  "structuredContent": {
    "vellium": {
      "summary": "Two portrait variants were created.",
      "media": [
        {
          "type": "image",
          "url": "http://127.0.0.1:8188/view?filename=portrait-1.png&type=output",
          "markdown": "![Portrait variant 1](http://127.0.0.1:8188/view?filename=portrait-1.png&type=output)",
          "alt": "Portrait variant 1"
        }
      ]
    }
  }
}
```

Field behavior:

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | Yes | Currently only `image` is rendered as media |
| `url` | Yes | Image URL used by the thumbnail and preview |
| `alt` | Recommended | Accessible label and visible image name |
| `markdown` | Recommended | Markdown that may be appended to the assistant response when the model omitted the image |
| `summary` | Optional | Short human-readable status shown above the media grid |

Items without a URL, and media types other than `image`, are ignored by the generated-media renderer. A result without recognized media remains a normal text/JSON tool result.

## Internal normalized trace

Vellium converts a recognized MCP result into a stable trace before storing and rendering it:

```json
{
  "kind": "vellium_media_result",
  "summary": "Image created and shown to the user.",
  "media": [
    {
      "type": "image",
      "url": "http://127.0.0.1:8188/view?filename=output.png&type=output",
      "markdown": "![Generated image](http://127.0.0.1:8188/view?filename=output.png&type=output)",
      "alt": "Generated image"
    }
  ]
}
```

The model receives the short `summary`; the full structured trace is kept for the chat UI. This prevents large tool payloads from being dumped into the visible assistant text. If Vellium appends display-only image Markdown to the saved assistant response, links confirmed by that message's media trace are removed from later provider context while remaining visible in the chat and export.

If the tool supplies `markdown`, Vellium also checks the final assistant response. Missing image Markdown is appended once, while duplicate URLs are suppressed.

## URL and security considerations

- Image requests use `referrerPolicy="no-referrer"`.
- The preview does not upload or copy the image elsewhere.
- Local ComfyUI-style URLs such as `127.0.0.1` work while that image server is reachable.
- Remote or temporary URLs can expire; the chat then shows `Image unavailable` without breaking the message layout.
- Markdown images still follow the separate `Allow remote images` security setting.
- SVG attachments are not rendered as image previews.

## Troubleshooting

### The tool ran, but only JSON is visible

Confirm that the result uses `structuredContent` and that one of the supported media arrays contains `{ "type": "image", "url": "..." }`.

### The card says Image unavailable

Open the image server directly and verify that the URL is still reachable from the machine running Vellium. For local generators, confirm the host, port, filename and output type.

### The image appears twice

Use the same exact URL in `media.url` and `media.markdown`. Vellium deduplicates by URL; differing query parameters are treated as different images.

### Tool calling is not available

Use an OpenAI-compatible chat/completions provider, enable `Tool Calling`, and configure the MCP server under `Settings → Tools & MCP`. KoboldCpp does not support this tool-calling path.
