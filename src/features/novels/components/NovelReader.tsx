import {useNovelSpeech} from "../useNovelSpeech";
import { scheduledNovelFrames } from "../frames";
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../shared/i18n";
import type { NovelStory } from "../../../shared/types/novels";
import { NovelStage } from "./NovelStage";
import { NovelImageTools } from "./NovelImageTools";
import { NovelControl, NovelIcon, NovelMoreMenu } from "./NovelControls";
import { sceneFrames, usesLayers } from "../layers";

export function NovelReader({ story, busy, onGenerate, onSave, onSettings, onLibrary, onCancel, onEditImage, onAddFrame, onToChat, onExportWriter, busyNote = "", paused = false }: {
  story: NovelStory; busy: boolean; onGenerate: (action?: string, illustrationId?: string, imagesOnly?: boolean) => Promise<NovelStory | undefined>;
  onSave: (cursor: NovelStory["cursor"]) => Promise<unknown>; onSettings: () => void; onLibrary: () => void; onCancel: () => void; paused?:boolean;
  busyNote?: string;
  onToChat: () => Promise<unknown>; onExportWriter: () => Promise<{ name: string } | undefined>;
  onEditImage: (id: string, patch: { prompt?: string; reseed?: boolean }) => Promise<unknown>; onAddFrame: (sceneId: string, atLine: number, prompt: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [sceneIndex, setSceneIndex] = useState(story.cursor.scene); const [lineIndex, setLineIndex] = useState(story.cursor.line);
  const [panel, setPanel] = useState<"journal" | "memory" | null>(null); const [action, setAction] = useState("");
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const [exported, setExported] = useState("");
  const [hidden, setHidden] = useState(false); const [auto, setAuto] = useState(false); const [revealed, setRevealed] = useState(false);
  const advancing = useRef(false);
  // Scene count when a generation started. Streamed scenes may appear before
  // the request returns; the reader moves to the first new one exactly once.
  const jumpFrom = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scene = story.scenes[sceneIndex]; const line = scene?.lines[lineIndex];
  const [pageVisible,setPageVisible]=useState(()=>!document.hidden);
  useEffect(()=>{const sync=()=>setPageVisible(!document.hidden);document.addEventListener("visibilitychange",sync);return()=>document.removeEventListener("visibilitychange",sync);},[]);
  const speech=useNovelSpeech(story.id,`${scene?.id||""}:${lineIndex}`,line?.text||"",pageVisible && !paused && !panel);
  const openSpeechSettings=()=>{speech.stop();window.dispatchEvent(new CustomEvent("open-settings-view",{detail:{category:"voice",sectionId:"settings-tts"}}));};
  const atSceneEnd = Boolean(scene && lineIndex >= scene.lines.length - 1); const atEnd = sceneIndex >= story.scenes.length - 1 && atSceneEnd;
  const layers = usesLayers(story.config);
  // Layers mode: the background opens every scene, so a full frame starts at
  // its own line instead of being moved to the first one.
  const frames = layers ? sceneFrames(scene?.illustrations || []) : scheduledNovelFrames(scene?.illustrations || [], scene?.lines.length || 1);
  const frame = [...frames].reverse().find((im) => im.atLine <= lineIndex && im.status === "ready");
  const selectedFrame = [...frames].reverse().find((im) => im.atLine <= lineIndex);
  const background = layers && scene?.background ? story.backgrounds?.[scene.background] : undefined;
  // The picture the tools act on: the frame on screen, else the place's background.
  const picture = selectedFrame || background;
  const progressRef = useRef<NovelStory["cursor"] | null>(null);
  const onSaveRef = useRef(onSave); onSaveRef.current = onSave;
  if (scene) progressRef.current = { scene: sceneIndex, line: lineIndex };
  useEffect(() => {
    if (!scene) return;
    const cursor = { scene: sceneIndex, line: lineIndex };
    const timer = setTimeout(() => { void onSaveRef.current(cursor); }, 800);
    return () => clearTimeout(timer);
  }, [sceneIndex, lineIndex, story.scenes.length]);
  useEffect(() => () => { if (progressRef.current) void onSaveRef.current(progressRef.current); }, []);
  useEffect(() => {
    if (jumpFrom.current !== null && story.scenes.length > jumpFrom.current) { setSceneIndex(jumpFrom.current); setLineIndex(0); jumpFrom.current = null; return; }
    // Streamed scenes vanish if a generation fails; never point past the end.
    if (story.scenes.length && sceneIndex >= story.scenes.length) { setSceneIndex(story.scenes.length - 1); setLineIndex(0); }
  }, [story.scenes.length]);
  useEffect(() => { if (scene && lineIndex >= scene.lines.length) setLineIndex(Math.max(0, scene.lines.length - 1)); }, [scene, lineIndex]);
  useEffect(() => { setBookmarkSaved(false); setRevealed(false); rootRef.current?.querySelector(".novel-reading-surface")?.scrollTo(0,0); const timer = setTimeout(() => setRevealed(true), 650); return () => clearTimeout(timer); }, [sceneIndex, lineIndex]);
  useEffect(()=>{if(speech.status==="playing")setRevealed(true);},[speech.status]);
  function next() {
    if (panel || paused) return;
    if (!revealed) { setRevealed(true); return; }
    if (!scene) { if (!busy) void onGenerate(); return; }
    if (!atSceneEnd) setLineIndex((n) => n + 1);
    else if (sceneIndex < story.scenes.length - 1) { setSceneIndex((n) => n + 1); setLineIndex(0); }
    else if (!busy && !action.trim() && !scene.question && !scene.choices.length && !advancing.current) {
      advancing.current = true; jumpFrom.current = story.scenes.length;
      void onGenerate().finally(() => { advancing.current = false; jumpFrom.current = null; });
    }
  }
  function previous() {
    if (lineIndex > 0) setLineIndex((n) => n - 1);
    else if (sceneIndex > 0) { setSceneIndex((n) => n - 1); setLineIndex(story.scenes[sceneIndex - 1].lines.length - 1); }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current?.getClientRects().length || panel || paused || document.querySelector('[role="dialog"]') || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (/^[1-9]$/.test(e.key) && atEnd && scene?.choices[Number(e.key) - 1]) { e.preventDefault(); void answer(scene.choices[Number(e.key) - 1]); }
      else if ([" ", "Enter", "ArrowRight"].includes(e.key)) {
        if (e.key !== "ArrowRight" && (e.target as HTMLElement)?.closest("button")) return;
        e.preventDefault(); next();
      }
      else if (e.key === "ArrowLeft") { e.preventDefault(); previous(); }
      else if (e.key.toLowerCase() === "s" && !busy) {e.preventDefault();onSettings();}
      else if (e.key.toLowerCase() === "h") setHidden((v) => !v);
      else if (e.key === "Escape") { setHidden(false); setAuto(false); if(speech.enabled)speech.stop(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!auto || (busy && atEnd) || action.trim() || panel || paused || !pageVisible || (speech.enabled && !speech.done) || (atEnd && (scene?.question || scene?.choices.length))) return;
    const timer = setTimeout(() => { if (rootRef.current?.getClientRects().length && !document.hidden) next(); }, speech.enabled ? 450 : Math.max(3200, (line?.text.length || 0) * 45));
    return () => clearTimeout(timer);
  });
  async function answer(value: string) {
    if (!value.trim() || busy || advancing.current || paused || panel) return;
    advancing.current=true;setAuto(false);jumpFrom.current=story.scenes.length;
    try {
      const nextStory=await onGenerate(value.trim());
      if(nextStory && nextStory.scenes.length>story.scenes.length)setAction("");
    }finally{advancing.current=false;jumpFrom.current=null;}
  }
  return <div className={`novel-reader ${hidden ? "is-hidden" : ""} ${atEnd && scene ? "has-choice" : ""}`} ref={rootRef} onClick={(event) => {
    if (panel || (event.target as HTMLElement).closest("button,a,input,textarea,select,form,summary,details,[role=dialog],[role=menu]")) return;
    if (window.getSelection()?.toString()) return;
    if (hidden) { setHidden(false); return; }
    next();
  }}>
    <NovelStage story={story} scene={scene} speaker={line?.speaker || ""} frameUrl={frame?.url} />
    <div className="novel-vignette" />
    <header className="novel-reader-top">
      <button onClick={onLibrary} disabled={busy} aria-label={t("novel.library")}>← <span>{t("novel.library")}</span></button>
      <div><span className="novel-eyebrow">{t("novel.workspace")}</span><h1>{story.title}</h1></div>
      <button onClick={onSettings} disabled={busy}>{t("novel.settings")}</button>
    </header>
    {!hidden && <>
      <div className="novel-scene-context"><span>{scene?.location || t("novel.opening")}</span>{scene?.pov && <small>{t("novel.pov")} · {scene.pov}</small>}</div>
      {story.scenes.length > 0 && <nav className="novel-scene-strip" aria-label={t("novel.scenes")}>
        {story.scenes.map((s, i) => <button key={s.id} aria-current={i === sceneIndex ? "step" : undefined} onClick={() => { setSceneIndex(i); setLineIndex(0); setAuto(false); }} title={s.title}>{String(i + 1).padStart(2, "0")}</button>)}
      </nav>}
      <main className="novel-reading-surface" title={t("novel.advanceHint")}>
        {speech.enabled && (speech.status==="loading" || speech.status==="playing") && <div className="novel-speech-status" role="status"><span>{t(speech.status==="loading"?"novel.ttsLoading":"novel.ttsPlaying")}</span><button onClick={speech.stop}>{t("chat.stop")}</button></div>}
        {speech.enabled && speech.error && <div className="novel-speech-status" role="alert"><span>{speech.error}</span><button onClick={speech.replay}>{t("novel.ttsReplay")}</button><button onClick={openSpeechSettings}>{t("novel.ttsSettings")}</button></div>}
        {exported && <div className="novel-generation-status" role="status"><span>{t("novel.exportedWriter").replace("{name}", exported)}</span><button onClick={() => window.dispatchEvent(new CustomEvent("open-app-tab", { detail: { tabId: "writing" } }))}>{t("novel.openWriter")}</button><button aria-label={t("chat.cancel")} onClick={() => setExported("")}>×</button></div>}
        {busy && <div className="novel-generation-status" role="status"><span className="novel-pulse" />{busyNote || t("novel.working")}<button onClick={onCancel}>{t("chat.stop")}</button></div>}
        {scene && story.config.imagesEnabled && !layers && !scene.illustrations.length && <div className="novel-image-notice"><span>{t("novel.missingImagePlan")}</span><button disabled={busy} onClick={()=>void onGenerate(undefined,undefined,true)}>{t("novel.renderImages")}</button></div>}
        {selectedFrame?.status === "error" && <div className="novel-image-notice"><span title={selectedFrame.error}>{t("novel.imageFailed")} {selectedFrame.error}</span><button disabled={busy} onClick={() => void onGenerate(undefined, selectedFrame.id, true)}>{t("novel.retryImage")}</button></div>}
        {background?.status === "error" && !selectedFrame && <div className="novel-image-notice"><span title={background.error}>{t("novel.imageFailed")} {background.error}</span><button disabled={busy} onClick={() => void onGenerate(undefined, background.id, true)}>{t("novel.retryImage")}</button></div>}
        {(selectedFrame || background)?.status === "pending" && !busy && <div className="novel-image-notice"><span>{t("novel.imagePending")}</span><button onClick={() => void onGenerate(undefined, undefined, true)}>{t("novel.renderImages")}</button></div>}
        {scene ? <>
          <div className="novel-dialogue-heading"><span>{line?.speaker || t("novel.narrator")}</span><small>{String(sceneIndex + 1).padStart(2, "0")} / {String(story.scenes.length).padStart(2, "0")} · {lineIndex + 1}/{scene.lines.length}</small></div>
          <button className={`novel-dialogue ${revealed ? "is-revealed" : ""}`} onClick={next} aria-label={t("novel.next")}><span key={`${scene.id}-${lineIndex}`}>{line?.text}</span>{!atEnd && <i aria-hidden="true">▾</i>}</button>
          {atEnd && <section className="novel-choices" aria-label={t("novel.yourChoice")}>
            {(scene.question || scene.choices.length>0) && <p>{scene.question || t("novel.yourChoice")}</p>}
            {scene.choices.map((choice, i) => <button disabled={busy} key={`${i}-${choice}`} onClick={() => void answer(choice)}><span>{i + 1}</span>{choice}</button>)}
            <form onSubmit={(e) => { e.preventDefault(); void answer(action); }}><input aria-label={t("novel.customAction")} placeholder={t("novel.customAction")} value={action} disabled={busy} maxLength={6000} onFocus={()=>setAuto(false)} onChange={(e) => {setAuto(false);setAction(e.target.value);}} /><button aria-label={t("novel.sendAction")} disabled={busy || !action.trim()} type="submit">↵</button></form>
          </section>}
        </> : <div className="novel-opening"><span className="novel-eyebrow">{t("novel.ready")}</span><h2>{story.title}</h2><p>{t("novel.readyHint")}</p><button className="novel-primary" disabled={busy} onClick={() => void onGenerate()}>{t("novel.begin")}</button></div>}
        <footer className="novel-reader-controls" aria-label={t("novel.controls")}>
          <NovelControl icon="back" label={t("novel.previous")} disabled={!lineIndex && !sceneIndex} onClick={previous} />
          <NovelControl icon="auto" label={t("novel.auto")} disabled={!scene} pressed={auto} onClick={() => setAuto((v) => !v)} />
          <NovelControl icon="voice" label={t("novel.voice")} title={t("novel.ttsHint")} pressed={speech.enabled} onClick={speech.toggle} />
          {speech.enabled && !speech.error && <NovelControl iconOnly icon={speech.status==="playing" || speech.status==="loading" ? "stop" : "replay"} label={t(speech.status==="playing" || speech.status==="loading" ? "novel.ttsStop" : "novel.ttsReplay")} disabled={!line} onClick={speech.status==="playing" || speech.status==="loading" ? speech.stop : speech.replay} />}
          <span className="novel-control-divider" aria-hidden="true" />
          <NovelControl iconOnly icon="journal" label={t("novel.journal")} onClick={() => setPanel("journal")} />
          <NovelControl iconOnly icon="memory" label={t("novel.memory")} onClick={() => setPanel("memory")} />
          <NovelControl iconOnly icon="bookmark" label={t(bookmarkSaved ? "novel.bookmarked" : "novel.bookmark")} pressed={bookmarkSaved} disabled={busy || !scene} onClick={async () => { const result = await onSave({ scene: sceneIndex, line: lineIndex }); if (result) setBookmarkSaved(true); }} />
          <NovelControl iconOnly icon="hide" label={t("novel.hideUi")} onClick={() => setHidden(true)} />
          <NovelControl iconOnly icon="settings" label={t("novel.settings")} title={t("novel.settingsShortcut")} disabled={busy} onClick={onSettings} />
          <NovelMoreMenu label={t("novel.moreActions")}>
            {story.config.imagesEnabled && story.config.workflow && <><p className="novel-more-heading">{t("novel.pictures")}</p><NovelImageTools picture={picture} scene={scene} lineIndex={lineIndex} busy={busy} onEdit={onEditImage} onAdd={onAddFrame} /></>}
            <p className="novel-more-heading">{t("novel.continueElsewhere")}</p>
            <button type="button" disabled={busy || !story.scenes.length} title={t("novel.toChatHint")} onClick={() => void onToChat()}>{t("novel.toChat")}</button>
            <button type="button" disabled={busy || !story.scenes.length} title={t("novel.exportWriterHint")} onClick={async () => { const result = await onExportWriter(); if (result) setExported(result.name); }}>{t("novel.exportWriter")}</button>
          </NovelMoreMenu>
          <span className="novel-control-spacer" />
          <button className="novel-continue novel-primary" aria-label={t(atEnd ? "novel.continue" : "novel.next")} onClick={next} disabled={(busy && atEnd) || (atEnd && Boolean(action.trim() || scene?.question || scene?.choices.length))}><span className="novel-control-label">{t(atEnd ? "novel.continue" : "novel.next")}</span><NovelIcon name="next" /></button>
        </footer>
      </main>
    </>}
    {hidden && <button className="novel-show-ui" onClick={() => setHidden(false)}>{t("novel.showUi")}</button>}
    {panel && <ModalShell title={t(panel === "journal" ? "novel.journal" : "novel.memory")} closeLabel={t("chat.cancel")} onClose={() => setPanel(null)} size="lg">
      <div className="novel-detail-panel">{panel === "journal" ? story.scenes.map((s, i) => <section key={s.id}><h3>{i + 1}. {s.title}</h3><small>{s.location} · {s.pov}</small>{s.lines.map((l, n) => <p key={n}><b>{l.speaker} </b>{l.text}</p>)}</section>) : <>
        <p className="novel-hint">{t("novel.memoryHint")}</p>{story.contextCheckpoint && <section><h3>{t("novel.contextCompacted")}</h3><p className="novel-hint">{t("novel.contextCompactedHint").replace("{count}",String(story.contextCheckpoint.throughTurn))}</p><p>{story.contextCheckpoint.text}</p></section>}<h3>{t("novel.cast")}</h3>{story.memory.characters.map((c) => <section key={c.id}><h4>{c.name}</h4><p>{c.appearance}</p><p>{c.relationships}</p><p>{c.state}</p></section>)}
        <p className="novel-hint">{t("novel.cacheHint")}</p>{story.cache && <p>{t("novel.cacheUsage")}: {story.cache.cachedTokensReported === false ? t("novel.cacheUnreported") : `${story.cache.cachedTokens} / ${story.cache.inputTokens}`}{story.cache.outputTokens !== undefined && <> · {t("novel.outputTokens")}: {story.cache.outputTokens}</>}{story.cache.reasoningTokens !== undefined && <> · {t("novel.reasoningTokens")}: {story.cache.reasoningTokens}</>}</p>}
      </>}</div>
    </ModalShell>}
  </div>;
}
