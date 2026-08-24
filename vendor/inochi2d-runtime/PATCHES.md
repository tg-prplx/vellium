# Vellium runtime patch

This directory vendors the browser runtime from `inochi2d-web` at commit
`ab24c2bc627ef5acde6685ee20096cef0128baaa` and its reproducible official
Inochi2D SDK WebAssembly build at commit
`f4b4917a59419e64f2704ac7b806e2bf09bca752`.

Vellium adds one renderer correction in `src/official/renderer.ts`: resolving a
nested mask changes the active framebuffer and shader program, so the caller
must restore the model output target and its drawing program before sampling
the combined mask. Without that restoration Chromium reports invalid uniform
locations and a framebuffer/texture feedback loop on affected models.

`dist/official/renderer.js` is compiled from that patched source. The remaining
runtime files are unchanged upstream build output.
