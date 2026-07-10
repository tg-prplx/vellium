import type { DesktopPetConfig } from "./types";

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildDesktopPetHtml(config: DesktopPetConfig) {
  const cfg = safeScriptJson(config);
  const themeVars = config.theme?.variables || {};
  const cssValue = (value: string, fallback: string) => {
    const next = String(value || "").replace(/[;{}<>]/g, "").trim().slice(0, 220);
    return next || fallback;
  };
  const theme = {
    accent: cssValue(themeVars["--color-accent"], "#d97757"),
    accentHover: cssValue(themeVars["--color-accent-hover"] || themeVars["--color-accent"], "#c4664a"),
    accentSubtle: cssValue(themeVars["--color-accent-subtle"], "rgba(217, 119, 87, 0.12)"),
    accentBorder: cssValue(themeVars["--color-accent-border"], "rgba(217, 119, 87, 0.3)"),
    ink: cssValue(themeVars["--color-text-primary"], "#f7efe9"),
    muted: cssValue(themeVars["--color-text-secondary"], "rgba(247, 239, 233, 0.68)"),
    panel: cssValue(themeVars["--color-bg-secondary"], "#171419"),
    field: cssValue(themeVars["--color-bg-tertiary"], "#231f26"),
    hover: cssValue(themeVars["--color-bg-hover"], "#302a33"),
    line: cssValue(themeVars["--color-border"], "#343039"),
    subtleLine: cssValue(themeVars["--color-border-subtle"] || themeVars["--color-border"], "#2a2730")
  };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: file:; media-src data: http: https: file: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root {
      color-scheme: ${config.theme?.mode === "light" ? "light" : "dark"};
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --accent: ${theme.accent};
      --accent-hover: ${theme.accentHover};
      --accent-subtle: ${theme.accentSubtle};
      --accent-border: ${theme.accentBorder};
      --ink: ${theme.ink};
      --muted: ${theme.muted};
      --panel: ${theme.panel};
      --field: ${theme.field};
      --hover: ${theme.hover};
      --line: ${theme.line};
      --line-subtle: ${theme.subtleLine};
      --pet-scale: ${config.scale};
      --root-pad: calc(6px * var(--pet-scale));
      --ui-side: calc(10px * var(--pet-scale));
      --stage-size: calc(178px * var(--pet-scale));
      --sprite-size: calc(164px * var(--pet-scale));
      --ui-offset: calc(var(--stage-size) + (16px * var(--pet-scale)));
      --ui-space: calc(100vh - var(--ui-offset) - (18px * var(--pet-scale)));
      --bubble-max: clamp(52px, calc(var(--ui-space) - 62px), calc(150px * var(--pet-scale)));
    }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      user-select: none;
    }
    body {
      display: grid;
      place-items: end center;
    }
    .pet-root {
      position: relative;
      width: 100%;
      height: 100%;
      display: grid;
      place-items: end center;
      padding: var(--root-pad);
      box-sizing: border-box;
    }
    .pet-root.ui-open.ui-below {
      place-items: start center;
    }
    .pet-ui {
      position: absolute;
      left: var(--ui-side);
      right: var(--ui-side);
      bottom: var(--ui-offset);
      z-index: 3;
      display: grid;
      gap: 7px;
      max-height: var(--ui-space);
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px) scale(0.98);
      transform-origin: 50% 100%;
      transition: opacity 160ms ease, transform 180ms ease, visibility 0s linear 180ms;
    }
    .pet-root.ui-below .pet-ui {
      top: var(--ui-offset);
      bottom: auto;
      transform: translateY(-8px) scale(0.98);
      transform-origin: 50% 0;
    }
    .pet-root.ui-open .pet-ui,
    .pet-ui:focus-within {
      visibility: visible;
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
      transition-delay: 0s;
    }
    .bubble {
      min-height: 28px;
      max-height: var(--bubble-max);
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 8px 11px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      color: var(--ink);
      font-size: 12px;
      line-height: 1.35;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
      transform-origin: 50% 100%;
      animation: bubbleIn 180ms ease-out both;
      user-select: text;
      scrollbar-width: thin;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .chatbar {
      display: none;
      grid-template-columns: 1fr auto;
      gap: 6px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
    }
    .stage {
      position: relative;
      width: var(--stage-size);
      height: var(--stage-size);
      display: grid;
      place-items: center;
      cursor: grab;
      z-index: 2;
    }
    .stage:active {
      cursor: grabbing;
    }
    .sprite {
      max-width: var(--sprite-size);
      max-height: var(--sprite-size);
      object-fit: contain;
      animation: idleFloat 2.2s ease-in-out infinite;
      pointer-events: none;
      border-radius: 18px;
    }
    .sheet-sprite {
      width: calc(var(--sprite-size) * 0.923);
      height: var(--sprite-size);
      background-repeat: no-repeat;
      background-size: 800% 900%;
      background-position: 0 0;
      animation: idleFloat 2.2s ease-in-out infinite;
      pointer-events: none;
    }
    .css-pet {
      position: relative;
      width: 132px;
      height: 132px;
      zoom: var(--pet-scale);
      animation: idleFloat 2.2s ease-in-out infinite;
      pointer-events: none;
    }
    .ear {
      position: absolute;
      top: 12px;
      width: 44px;
      height: 52px;
      border-radius: 12px 28px 10px 28px;
      background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 38%, var(--field)), var(--accent) 72%);
      border: 2px solid var(--accent-border);
    }
    .ear.left { left: 18px; transform: rotate(-28deg); }
    .ear.right { right: 18px; transform: rotate(28deg) scaleX(-1); }
    .head {
      position: absolute;
      inset: 26px 8px 6px;
      border-radius: 44% 44% 38% 38%;
      background: radial-gradient(circle at 36% 28%, color-mix(in srgb, var(--ink) 72%, transparent) 0 18%, transparent 19%),
        linear-gradient(145deg, color-mix(in srgb, var(--accent) 36%, var(--panel)), var(--accent) 58%, color-mix(in srgb, var(--field) 72%, var(--accent)));
      border: 2px solid var(--accent-border);
      box-shadow: inset -14px -16px 24px rgba(0, 0, 0, 0.18);
    }
    .eye {
      position: absolute;
      top: 72px;
      width: 12px;
      height: 18px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ink) 82%, #000);
      animation: blink 5.4s infinite;
    }
    .eye.left { left: 46px; }
    .eye.right { right: 46px; }
    .mouth {
      position: absolute;
      left: 60px;
      top: 94px;
      width: 12px;
      height: 7px;
      border-bottom: 2px solid color-mix(in srgb, var(--ink) 72%, #000);
      border-radius: 0 0 999px 999px;
    }
    .paw {
      position: absolute;
      bottom: 0;
      width: 34px;
      height: 22px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 72%, var(--field));
      border: 2px solid var(--accent-border);
    }
    .paw.left { left: 28px; }
    .paw.right { right: 28px; }
    .stage.is-happy .css-pet,
    .stage.is-happy .sprite,
    .stage.is-happy .sheet-sprite { animation: happyHop 650ms ease-in-out 1; }
    .stage.is-sleepy .css-pet,
    .stage.is-sleepy .sprite,
    .stage.is-sleepy .sheet-sprite { animation: sleepySway 2.8s ease-in-out infinite; filter: saturate(0.8); }
    .stage.is-alert .css-pet,
    .stage.is-alert .sprite,
    .stage.is-alert .sheet-sprite { animation: alertPop 520ms ease-out 1; }
    .stage.anim-hop .css-pet,
    .stage.anim-hop .sprite,
    .stage.anim-hop .sheet-sprite { animation: happyHop 650ms ease-in-out 1; }
    .stage.anim-sway .css-pet,
    .stage.anim-sway .sprite,
    .stage.anim-sway .sheet-sprite { animation: sleepySway 2.8s ease-in-out infinite; filter: saturate(0.8); }
    .stage.anim-pop .css-pet,
    .stage.anim-pop .sprite,
    .stage.anim-pop .sheet-sprite { animation: alertPop 520ms ease-out 1; }
    .stage.anim-spin .css-pet,
    .stage.anim-spin .sprite,
    .stage.anim-spin .sheet-sprite { animation: petSpin 720ms ease-in-out 1; }
    .stage.anim-shake .css-pet,
    .stage.anim-shake .sprite,
    .stage.anim-shake .sheet-sprite { animation: petShake 480ms ease-in-out 1; }
    .stage.anim-bounce .css-pet,
    .stage.anim-bounce .sprite,
    .stage.anim-bounce .sheet-sprite { animation: petBounce 900ms ease-in-out 1; }
    .stage.is-present .css-pet,
    .stage.is-present .sprite,
    .stage.is-present .sheet-sprite { animation: attentiveShift 1.3s ease-in-out 1; }
    .stage.is-listening .css-pet,
    .stage.is-listening .sprite,
    .stage.is-listening .sheet-sprite { animation: listeningTilt 1.15s ease-in-out 1; }
    .stage.is-resting .css-pet,
    .stage.is-resting .sprite,
    .stage.is-resting .sheet-sprite { animation: quietRest 3.6s ease-in-out infinite; filter: saturate(0.9) brightness(0.96); }
    .pet-root.emotion-happy .bubble { border-color: #6ee7b7; }
    .pet-root.emotion-excited .bubble { border-color: #fbbf24; }
    .pet-root.emotion-sleepy .bubble { border-color: #93c5fd; }
    .pet-root.emotion-curious .bubble { border-color: #c4b5fd; }
    .controls {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 6px;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.26);
    }
    input,
    select {
      min-width: 0;
      border: 0;
      outline: 0;
      border-radius: 9px;
      background: var(--field);
      color: var(--ink);
      padding: 8px 9px;
      font-size: 12px;
    }
    button {
      border: 1px solid var(--line-subtle);
      border-radius: 9px;
      background: var(--field);
      color: var(--ink);
      height: 32px;
      padding: 0 9px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover {
      background: var(--accent-subtle);
      border-color: var(--accent-border);
    }
    .close {
      position: absolute;
      top: 8px;
      right: 9px;
      width: 28px;
      padding: 0;
      opacity: 0.62;
      display: none;
    }
    @keyframes idleFloat {
      0%, 100% { transform: translateY(0) rotate(-1deg); }
      50% { transform: translateY(-7px) rotate(1deg); }
    }
    @keyframes blink {
      0%, 93%, 100% { transform: scaleY(1); }
      95%, 97% { transform: scaleY(0.1); }
    }
    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(8px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes happyHop {
      0%, 100% { transform: translateY(0) scale(1); }
      35% { transform: translateY(-20px) scale(1.04, 0.96); }
      70% { transform: translateY(2px) scale(0.97, 1.05); }
    }
    @keyframes sleepySway {
      0%, 100% { transform: translateY(0) rotate(-4deg); }
      50% { transform: translateY(-5px) rotate(4deg); }
    }
    @keyframes alertPop {
      0% { transform: scale(0.94); }
      45% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    @keyframes petSpin {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.08); }
      100% { transform: rotate(360deg) scale(1); }
    }
    @keyframes petShake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-8px) rotate(-4deg); }
      40% { transform: translateX(7px) rotate(4deg); }
      60% { transform: translateX(-5px) rotate(-3deg); }
      80% { transform: translateX(4px) rotate(2deg); }
    }
    @keyframes petBounce {
      0%, 100% { transform: translateY(0) scale(1); }
      25% { transform: translateY(-18px) scale(1.03, 0.97); }
      50% { transform: translateY(2px) scale(0.98, 1.04); }
      75% { transform: translateY(-10px) scale(1.02, 0.98); }
    }
    @keyframes attentiveShift {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      35% { transform: translateY(-5px) rotate(-3deg); }
      70% { transform: translateY(-3px) rotate(2deg); }
    }
    @keyframes listeningTilt {
      0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
      45% { transform: translateY(-4px) rotate(4deg) scale(1.02); }
    }
    @keyframes quietRest {
      0%, 100% { transform: translateY(2px) rotate(-2deg) scale(0.99); }
      50% { transform: translateY(-3px) rotate(2deg) scale(1); }
    }
  </style>
</head>
<body>
  <main class="pet-root">
    <div class="stage" id="stage">
      <img class="sprite" id="imageSprite" alt="" hidden />
      <video class="sprite" id="videoSprite" muted loop playsinline autoplay hidden></video>
      <div class="sheet-sprite" id="sheetSprite" aria-hidden="true" hidden></div>
      <audio id="stateSound" preload="auto"></audio>
      <div class="css-pet" id="cssPet" aria-hidden="true">
        <div class="ear left"></div>
        <div class="ear right"></div>
        <div class="head"></div>
        <div class="eye left"></div>
        <div class="eye right"></div>
        <div class="mouth"></div>
        <div class="paw left"></div>
        <div class="paw right"></div>
      </div>
    </div>
    <section class="pet-ui" id="petUi">
      <button class="close" title="Hide">&times;</button>
      <div class="chatbar">
        <select id="chatSelect" title="Pet chat"></select>
        <button type="button" id="newChat" title="New chat">+</button>
      </div>
      <div class="bubble" id="bubble"></div>
      <form class="controls" id="form">
        <input id="input" placeholder="Say something..." autocomplete="off" />
        <button type="button" id="play">Pet</button>
        <button type="button" id="look" title="Send screen context">Look</button>
        <button type="submit">Send</button>
      </form>
    </section>
  </main>
  <script>
    const config = ${cfg};
    const bubble = document.getElementById("bubble");
    const root = document.querySelector(".pet-root");
    const petUi = document.getElementById("petUi");
    const stage = document.getElementById("stage");
    const imageSprite = document.getElementById("imageSprite");
    const videoSprite = document.getElementById("videoSprite");
    const sheetSprite = document.getElementById("sheetSprite");
    const stateSound = document.getElementById("stateSound");
    const cssPet = document.getElementById("cssPet");
    const input = document.getElementById("input");
    const chatSelect = document.getElementById("chatSelect");
    const newChat = document.getElementById("newChat");
    const form = document.getElementById("form");
    const play = document.getElementById("play");
    const look = document.getElementById("look");
    const close = document.querySelector(".close");
    const lines = {
      soft: ["I'm here.", "I noticed you.", "Still with you.", "I'm listening."],
      playful: ["I'm here.", "That got my attention.", "Ready when you are.", "I saw you."],
      quiet: ["Still here.", "I'm listening.", "No rush.", "I'll stay nearby."]
    };
    const idleLines = ["I drifted off for a moment.", "Still here if you need me.", "I'll stay close."];
    const touchLines = ["I'm here.", "That got my attention.", "I felt that.", "Still with you."];
    let moodTimer = 0;
    let hideTimer = 0;
    let autonomyTimer = 0;
    let presenceTimer = 0;
    let lastInteractionAt = Date.now();
    let lastWanderAt = Date.now();
    let lastPresenceAt = Date.now();
    let lastIdleMoodAt = 0;
    let lastSpokenAt = 0;
    let nextWanderDelay = 22000 + Math.random() * 18000;
    let nextPresenceDelay = 6000 + Math.random() * 9000;
    function clean(value, max = 120) {
      return String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
    }
    function safeId(value, fallback = "alert") {
      const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      return id || fallback;
    }
    const voice = lines[config.voice] ? config.voice : "soft";
    const autonomyEnabled = config.autonomyEnabled === true;
    const actionPresets = new Map((Array.isArray(config.actions) ? config.actions : []).map((preset) => [safeId(preset.id, ""), preset]));
    const emotionPresets = new Map((Array.isArray(config.emotions) ? config.emotions : []).map((preset) => [safeId(preset.id, ""), preset]));
    const baseSpriteUrl = clean(config.spriteUrl, 4000);
    const baseSpriteSheetUrl = clean(config.spriteSheetUrl, 4000);
    const ttsEnabled = config.ttsEnabled === true;
    const sheetStates = {
      idle: { row: 0, frames: [280, 110, 110, 140, 140, 320] },
      "running-right": { row: 1, frames: [120, 120, 120, 120, 120, 120, 120, 220] },
      "running-left": { row: 2, frames: [120, 120, 120, 120, 120, 120, 120, 220] },
      waving: { row: 3, frames: [140, 140, 140, 280] },
      jumping: { row: 4, frames: [140, 140, 140, 140, 280] },
      failed: { row: 5, frames: [140, 140, 140, 140, 140, 140, 140, 240] },
      waiting: { row: 6, frames: [150, 150, 150, 150, 150, 260] },
      running: { row: 7, frames: [120, 120, 120, 120, 120, 220] },
      review: { row: 8, frames: [150, 150, 150, 150, 150, 280] }
    };
    let uiRequestId = 0;
    let sheetAnimationTimer = 0;
    let activeSheetState = "";
    function isVideoUrl(url) {
      return /^data:video\\//i.test(url) || /\\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url);
    }
    function hideMedia() {
      imageSprite.hidden = true;
      videoSprite.hidden = true;
      videoSprite.pause();
      sheetSprite.hidden = true;
      window.clearTimeout(sheetAnimationTimer);
      cssPet.hidden = false;
    }
    function positionSheetFrame(row, frame) {
      const x = frame <= 0 ? 0 : (frame / 7) * 100;
      const y = row <= 0 ? 0 : (row / 8) * 100;
      sheetSprite.style.backgroundPosition = x + "% " + y + "%";
    }
    function setSheetState(url, state = "idle") {
      const nextUrl = clean(url, 4000);
      if (!nextUrl) return false;
      const spec = sheetStates[state] || sheetStates.idle;
      activeSheetState = sheetStates[state] ? state : "idle";
      imageSprite.hidden = true;
      videoSprite.hidden = true;
      videoSprite.pause();
      cssPet.hidden = true;
      sheetSprite.hidden = false;
      if (sheetSprite.dataset.src !== nextUrl) {
        sheetSprite.dataset.src = nextUrl;
        sheetSprite.style.backgroundImage = "url(" + JSON.stringify(nextUrl) + ")";
      }
      window.clearTimeout(sheetAnimationTimer);
      let frame = 0;
      const tick = () => {
        positionSheetFrame(spec.row, frame);
        const delay = spec.frames[frame] || 140;
        frame = (frame + 1) % spec.frames.length;
        sheetAnimationTimer = window.setTimeout(tick, delay);
      };
      tick();
      return true;
    }
    function setSpriteUrl(url) {
      const nextUrl = clean(url, 4000);
      if (nextUrl) {
        window.clearTimeout(sheetAnimationTimer);
        sheetSprite.hidden = true;
        if (isVideoUrl(nextUrl)) {
          if (videoSprite.src !== nextUrl) {
            videoSprite.src = nextUrl;
            videoSprite.load();
          }
          videoSprite.hidden = false;
          imageSprite.hidden = true;
          cssPet.hidden = true;
          void videoSprite.play().catch(() => {});
          return;
        }
        if (imageSprite.src !== nextUrl) imageSprite.src = nextUrl;
        imageSprite.hidden = false;
        videoSprite.hidden = true;
        videoSprite.pause();
        cssPet.hidden = true;
      } else {
        hideMedia();
      }
    }
    function resolveSheetState(stateId, animation, preset) {
      const presetCodexState = safeId(preset?.codexState || "", "");
      if (sheetStates[presetCodexState]) return presetCodexState;
      const id = safeId(stateId || "", "");
      const anim = safeId(animation || "", "");
      if (/sleep|sad|failed|fail|tired/.test(id)) return "failed";
      if (/alert|curious|think|focus|review/.test(id)) return "review";
      if (/happy|joy|excited|play|wave/.test(id)) return anim === "bounce" || anim === "hop" ? "jumping" : "waving";
      if (/walk|wander|move/.test(id)) return "running-right";
      if (anim === "hop" || anim === "bounce") return "jumping";
      if (anim === "pop") return "review";
      if (anim === "sway") return "waiting";
      return sheetStates[id] ? id : "idle";
    }
    imageSprite.addEventListener("error", hideMedia);
    videoSprite.addEventListener("error", hideMedia);
    function playStateSound(url) {
      const nextUrl = clean(url, 4000);
      if (!nextUrl) return;
      if (stateSound.src !== nextUrl) stateSound.src = nextUrl;
      stateSound.currentTime = 0;
      void stateSound.play().catch(() => {});
    }
    function markInteraction() {
      lastInteractionAt = Date.now();
    }
    function clearPresenceClasses() {
      stage.classList.remove("is-present", "is-listening", "is-resting");
    }
    function pulsePresence(className = "is-present", state = "review", duration = 1300) {
      window.clearTimeout(presenceTimer);
      clearPresenceClasses();
      stage.classList.add(className);
      if (baseSpriteSheetUrl && state) setSheetState(baseSpriteSheetUrl, state);
      presenceTimer = window.setTimeout(() => {
        clearPresenceClasses();
        if (baseSpriteSheetUrl && !root.classList.contains("ui-open") && !dragging) setSheetState(baseSpriteSheetUrl, "idle");
      }, duration);
    }
    function acknowledgePresence() {
      const now = Date.now();
      pulsePresence("is-listening", "waving", 1100);
      if (now - lastSpokenAt > 8500) say(randomLine(), "idle", "calm");
    }
    function applyUiPlacement(placement) {
      root.classList.toggle("ui-below", placement === "below");
    }
    async function showUi() {
      markInteraction();
      clearTimeout(hideTimer);
      const requestId = ++uiRequestId;
      const result = await window.electronAPI?.resizeDesktopPetUi?.(true);
      if (requestId !== uiRequestId) return;
      applyUiPlacement(result?.placement || "above");
      root.classList.add("ui-open");
      pulsePresence("is-listening", "review", 900);
    }
    function queueHideUi() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (petUi.matches(":hover") || stage.matches(":hover") || document.activeElement === input) return;
        uiRequestId += 1;
        root.classList.remove("ui-open");
        void window.electronAPI?.resizeDesktopPetUi?.(false);
      }, 500);
    }
    function findPresetForId(id) {
      const candidates = [emotionPresets.get(id), actionPresets.get(id)].filter(Boolean);
      return candidates.find((preset) => clean(preset.assetUrl, 4000)) || candidates[0] || null;
    }
    function resolvePetPreset(actionId, emotionId) {
      const ids = [];
      if (emotionId) ids.push(emotionId);
      if (actionId && actionId !== emotionId) ids.push(actionId);
      for (const id of ids) {
        const preset = findPresetForId(id);
        if (preset && clean(preset.assetUrl, 4000)) return preset;
      }
      for (const id of ids) {
        const preset = findPresetForId(id);
        if (preset) return preset;
      }
      return null;
    }
    function applyPetState(action = "", emotion = "") {
      const actionId = action ? safeId(action, "") : "";
      const emotionId = emotion ? safeId(emotion, "") : "";
      if (!actionId && !emotionId) return;
      const visualStateId = emotionId || actionId;
      const preset = resolvePetPreset(actionId, emotionId);
      const animation = safeId(preset?.animation || "", "idle");
      const presetAsset = clean(preset?.assetUrl || "", 4000);
      const presetSound = clean(preset?.soundUrl || "", 4000);
      [...stage.classList].forEach((name) => {
        if (name.startsWith("anim-") || name === "is-happy" || name === "is-sleepy" || name === "is-alert") {
          stage.classList.remove(name);
        }
      });
      [...root.classList].forEach((name) => {
        if (name.startsWith("emotion-")) root.classList.remove(name);
      });
      if (animation !== "idle" && animation !== "none") stage.classList.add("anim-" + animation);
      if (presetAsset) {
        setSpriteUrl(presetAsset);
      } else if (baseSpriteSheetUrl) {
        setSheetState(baseSpriteSheetUrl, resolveSheetState(visualStateId, animation, preset));
      } else {
        setSpriteUrl(baseSpriteUrl);
      }
      playStateSound(presetSound);
      if (visualStateId) root.classList.add("emotion-" + visualStateId);
    }
    function parsePetTool(raw) {
      const text = String(raw || "");
      const toolBlocks = [...text.matchAll(/<PET_TOOL>([\\s\\S]*?)<\\/PET_TOOL>/gi)];
      const visibleText = text.replace(/<PET_TOOL>[\\s\\S]*?<\\/PET_TOOL>/gi, "").trim();
      if (!toolBlocks.length) return { message: text.trim(), action: "", emotion: "" };
      const tool = {};
      for (const match of toolBlocks) {
        try {
          const parsed = JSON.parse(match[1]);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
          Object.assign(tool, parsed);
        } catch {}
      }
      const state = tool.state || tool.emotion || tool.action || tool.animation || "";
      return {
        message: visibleText || clean(tool.message, 180) || "...",
        action: tool.action || state,
        emotion: tool.emotion || state
      };
    }
    function say(text, mood = "", emotion = "") {
      bubble.textContent = text;
      bubble.scrollTop = 0;
      lastSpokenAt = Date.now();
      if (mood || emotion) applyPetState(mood, emotion);
      clearTimeout(moodTimer);
      moodTimer = setTimeout(() => {
        [...stage.classList].forEach((name) => {
          if (name.startsWith("anim-")) stage.classList.remove(name);
        });
      }, 1800);
    }
    let ttsAudio = null;
    async function speak(text) {
      if (!ttsEnabled) return;
      const inputText = String(text || "").trim();
      if (!inputText) return;
      try {
        const result = await window.electronAPI?.speakDesktopPetText?.(inputText);
        if (!result?.ok || !result.base64) return;
        if (ttsAudio) {
          ttsAudio.pause();
          ttsAudio = null;
        }
        ttsAudio = new Audio("data:" + (result.contentType || "audio/mpeg") + ";base64," + result.base64);
        await ttsAudio.play();
      } catch {}
    }
    function randomLine() {
      const list = lines[voice] || lines.soft;
      return list[Math.floor(Math.random() * list.length)];
    }
    async function sendMessageWithOptionalScreen(text, includeScreen = false) {
      const messageText = clean(text, 4000);
      if (!messageText) return say(randomLine());
      showUi();
      say(includeScreen ? "Looking..." : "...", "running", "running");
      try {
        const screenContext = includeScreen
          ? await window.electronAPI?.captureDesktopPetScreenContext?.()
          : undefined;
        const result = await window.electronAPI?.sendDesktopPetMessage?.(messageText, screenContext?.ok ? screenContext : undefined);
        void refreshChats();
        const parsed = parsePetTool(result?.reply || "");
        say(parsed.message || "...", parsed.action, parsed.emotion);
        void speak(parsed.message || "");
      } catch (error) {
        say(clean(error?.message || error, 160) || "LLM is unavailable.", "sleepy", "sleepy");
      }
    }
    function renderChats(payload) {
      const chats = Array.isArray(payload?.chats) ? payload.chats : [];
      const active = payload?.activeChatId || "";
      chatSelect.replaceChildren(...chats.map((chat) => {
        const option = document.createElement("option");
        option.value = chat.id;
        option.textContent = (chat.title || "New chat") + (chat.count ? " (" + chat.count + ")" : "");
        option.selected = chat.id === active;
        return option;
      }));
      chatSelect.hidden = chats.length === 0;
    }
    async function refreshChats() {
      try {
        const payload = await window.electronAPI?.listDesktopPetChats?.();
        renderChats(payload);
      } catch {}
    }
    if (baseSpriteSheetUrl) {
      setSheetState(baseSpriteSheetUrl, "idle");
    } else {
      setSpriteUrl(baseSpriteUrl);
    }
    void refreshChats();
    const offPeerNear = window.electronAPI?.onDesktopPetPeerNear?.((payload) => {
      if (dragging || document.activeElement === input) return;
      const name = clean(payload?.name || "", 32);
      pulsePresence("is-present", "waving", 1500);
      if (!root.classList.contains("ui-open") && Date.now() - lastSpokenAt > 16000) {
        say(name ? "I noticed " + name + "." : "I noticed someone nearby.", "happy", "happy");
      }
    });
    window.addEventListener("beforeunload", () => offPeerNear?.(), { once: true });
    say(clean(config.greeting, 140) || ("Hi, I'm " + clean(config.name, 32) + "."));
    function runAutonomyTick() {
      if (!autonomyEnabled || dragging || root.classList.contains("ui-open") || document.activeElement === input) return;
      const now = Date.now();
      if (now - lastPresenceAt > nextPresenceDelay) {
        lastPresenceAt = now;
        nextPresenceDelay = 6500 + Math.random() * 12000;
        if (now - lastInteractionAt > 45000) {
          pulsePresence("is-resting", "waiting", 2500);
        } else {
          pulsePresence("is-present", "review", 1200);
        }
      }
      if (now - lastInteractionAt > 180000 && now - lastIdleMoodAt > 90000) {
        lastIdleMoodAt = now;
        const line = idleLines[Math.floor(Math.random() * idleLines.length)];
        say(line, "sleepy", "sleepy");
      } else if (now - lastInteractionAt > 90000 && now - lastIdleMoodAt > 90000) {
        lastIdleMoodAt = now;
        pulsePresence("is-resting", "waiting", 2600);
      }
      if (now - lastWanderAt > nextWanderDelay && now - lastInteractionAt > 10000) {
        lastWanderAt = now;
        nextWanderDelay = 22000 + Math.random() * 22000;
        const dx = Math.round((Math.random() - 0.5) * 120);
        const dy = Math.round((Math.random() - 0.5) * 42);
        const direction = dx < 0 ? "running-left" : "running-right";
        if (baseSpriteSheetUrl && activeSheetState !== direction) setSheetState(baseSpriteSheetUrl, direction);
        void Promise.resolve(window.electronAPI?.autonomyDesktopPetStep?.({ dx, dy }))
          .finally(() => {
            window.setTimeout(() => {
              if (!dragging && !root.classList.contains("ui-open")) {
                if (baseSpriteSheetUrl) setSheetState(baseSpriteSheetUrl, "idle");
              }
            }, 650);
          });
      }
    }
    if (autonomyEnabled) {
      autonomyTimer = window.setInterval(runAutonomyTick, 3000);
      window.addEventListener("beforeunload", () => window.clearInterval(autonomyTimer), { once: true });
    }
    stage.addEventListener("mouseenter", showUi);
    stage.addEventListener("mouseleave", queueHideUi);
    petUi.addEventListener("mouseenter", showUi);
    petUi.addEventListener("mouseleave", queueHideUi);
    stage.addEventListener("click", () => { markInteraction(); showUi(); acknowledgePresence(); });
    play.addEventListener("click", () => {
      markInteraction();
      pulsePresence("is-present", "waving", 1200);
      say(touchLines[Math.floor(Math.random() * touchLines.length)], "happy", "happy");
    });
    look.addEventListener("click", () => {
      markInteraction();
      const text = input.value.trim() || "Look at my screen and tell me what you notice.";
      input.value = "";
      void sendMessageWithOptionalScreen(text, true);
    });
    newChat.addEventListener("click", async () => {
      markInteraction();
      const payload = await window.electronAPI?.createDesktopPetChat?.("New chat");
      renderChats(payload);
      say("We can start fresh.", "happy", "happy");
      input.focus();
    });
    chatSelect.addEventListener("change", async () => {
      markInteraction();
      const payload = await window.electronAPI?.selectDesktopPetChat?.(chatSelect.value);
      renderChats(payload);
      say("I remember this thread.", "idle", "calm");
      input.focus();
    });
    close.addEventListener("click", () => window.electronAPI?.hideDesktopPet?.());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      markInteraction();
      const text = input.value.trim();
      if (!text) return say(randomLine());
      input.value = "";
      void sendMessageWithOptionalScreen(text, false);
    });
    let dragging = false;
    stage.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0) return;
      if (event.target?.closest?.("button,input,select,textarea,a")) return;
      markInteraction();
      dragging = true;
      stage.setPointerCapture(event.pointerId);
      await window.electronAPI?.startDesktopPetDrag?.({ screenX: event.screenX, screenY: event.screenY });
    });
    stage.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      void window.electronAPI?.moveDesktopPetDrag?.({ screenX: event.screenX, screenY: event.screenY })
        .then((result) => {
          if (dragging && result?.placement) applyUiPlacement(result.placement);
        });
    });
    stage.addEventListener("pointerup", () => { dragging = false; });
    stage.addEventListener("pointercancel", () => { dragging = false; });
  </script>
</body>
</html>`;
}
