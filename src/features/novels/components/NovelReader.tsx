import {useNovelSpeech} from "../useNovelSpeech";
import { scheduledNovelFrames } from "../frames";
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../shared/i18n";
import type { NovelStory } from "../../../shared/types/novels";
import { resolveApiAssetUrl } from "../../../shared/api";

export function NovelReader({ story, busy, onGenerate, onSave, onSettings, onLibrary, onCancel, paused = false }: {
  story: NovelStory; busy: boolean; onGenerate: (action?: string, illustrationId?: string, imagesOnly?: boolean) => Promise<NovelStory | undefined>;
  onSave: (cursor: NovelStory["cursor"]) => Promise<unknown>; onSettings: () => void; onLibrary: () => void; onCancel: () => void; paused?:boolean;
}) {
  const { t } = useI18n();
  const [sceneIndex, setSceneIndex] = useState(story.cursor.scene); const [lineIndex, setLineIndex] = useState(story.cursor.line);
  const [panel, setPanel] = useState<"journal" | "memory" | null>(null); const [action, setAction] = useState("");
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const [hidden, setHidden] = useState(false); const [auto, setAuto] = useState(false); const [revealed, setRevealed] = useState(false);
  const advancing = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scene = story.scenes[sceneIndex]; const line = scene?.lines[lineIndex];
  const [pageVisible,setPageVisible]=useState(()=>!document.hidden);
  useEffect(()=>{const sync=()=>setPageVisible(!document.hidden);document.addEventListener("visibilitychange",sync);return()=>document.removeEventListener("visibilitychange",sync);},[]);
  const speech=useNovelSpeech(story.id,`${scene?.id||""}:${lineIndex}`,line?.text||"",pageVisible && !paused && !panel);
  const openSpeechSettings=()=>{speech.stop();window.dispatchEvent(new CustomEvent("open-settings-view",{detail:{category:"voice",sectionId:"settings-tts"}}));};
  const atSceneEnd = Boolean(scene && lineIndex >= scene.lines.length - 1); const atEnd = sceneIndex >= story.scenes.length - 1 && atSceneEnd;
  const frames = scheduledNovelFrames(scene?.illustrations || [], scene?.lines.length || 1);
  const frame = [...frames].reverse().find((im) => im.atLine <= lineIndex && im.status === "ready");
  const selectedFrame = [...frames].reverse().find((im) => im.atLine <= lineIndex);
  const url = resolveApiAssetUrl(frame?.url);
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
  useEffect(() => { setBookmarkSaved(false); setRevealed(false); rootRef.current?.querySelector(".novel-reading-surface")?.scrollTo(0,0); const timer = setTimeout(() => setRevealed(true), 650); return () => clearTimeout(timer); }, [sceneIndex, lineIndex]);
  useEffect(()=>{if(speech.status==="playing")setRevealed(true);},[speech.status]);
  function next() {
    if (panel || paused) return;
    if (!revealed) { setRevealed(true); return; }
    if (!scene) { if (!busy) void onGenerate(); return; }
    if (!atSceneEnd) setLineIndex((n) => n + 1);
    else if (sceneIndex < story.scenes.length - 1) { setSceneIndex((n) => n + 1); setLineIndex(0); }
    else if (!busy && !scene.question && !scene.choices.length && !advancing.current) {
      advancing.current = true;
      void onGenerate().then((result) => { if (result && result.scenes.length > story.scenes.length) { setSceneIndex(story.scenes.length); setLineIndex(0); } }).finally(() => { advancing.current = false; });
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
      else if (e.key.toLowerCase() === "h") setHidden((v) => !v);
      else if (e.key === "Escape") { setHidden(false); setAuto(false); if(speech.enabled)speech.stop(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!auto || busy || panel || paused || !pageVisible || (speech.enabled && !speech.done) || (atEnd && (scene?.question || scene?.choices.length))) return;
    const timer = setTimeout(() => { if (rootRef.current?.getClientRects().length && !document.hidden) next(); }, speech.enabled ? 450 : Math.max(3200, (line?.text.length || 0) * 45));
    return () => clearTimeout(timer);
  });
  async function answer(value: string) { if (!value.trim() || busy) return; setAuto(false); setAction(""); const nextStory = await onGenerate(value); if (atEnd && nextStory && nextStory.scenes.length > story.scenes.length) { setSceneIndex(story.scenes.length); setLineIndex(0); } }
  return <div className={`novel-reader ${hidden ? "is-hidden" : ""} ${atEnd && (scene?.question || scene?.choices.length) ? "has-choice" : ""}`} ref={rootRef} onClick={(event) => {
    if (panel || (event.target as HTMLElement).closest("button,a,input,textarea,select,form,[role=dialog]")) return;
    if (window.getSelection()?.toString()) return;
    if (hidden) { setHidden(false); return; }
    next();
  }}>
    <div className="novel-stage" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
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
        {busy && <div className="novel-generation-status" role="status"><span className="novel-pulse" />{t("novel.working")}<button onClick={onCancel}>{t("chat.stop")}</button></div>}
        {scene && story.config.imagesEnabled && !scene.illustrations.length && <div className="novel-image-notice"><span>{t("novel.missingImagePlan")}</span><button disabled={busy} onClick={()=>void onGenerate(undefined,undefined,true)}>{t("novel.renderImages")}</button></div>}
        {selectedFrame?.status === "error" && <div className="novel-image-notice"><span title={selectedFrame.error}>{t("novel.imageFailed")} {selectedFrame.error}</span><button disabled={busy} onClick={() => void onGenerate(undefined, selectedFrame.id, true)}>{t("novel.retryImage")}</button></div>}
        {selectedFrame?.status === "pending" && !busy && <div className="novel-image-notice"><span>{t("novel.imagePending")}</span><button onClick={() => void onGenerate(undefined, undefined, true)}>{t("novel.renderImages")}</button></div>}
        {scene ? <>
          <div className="novel-dialogue-heading"><span>{line?.speaker || t("novel.narrator")}</span><small>{String(sceneIndex + 1).padStart(2, "0")} / {String(story.scenes.length).padStart(2, "0")} · {lineIndex + 1}/{scene.lines.length}</small></div>
          <button className={`novel-dialogue ${revealed ? "is-revealed" : ""}`} onClick={next} aria-label={t("novel.next")}><span key={`${scene.id}-${lineIndex}`}>{line?.text}</span>{!atEnd && <i aria-hidden="true">▾</i>}</button>
          {atEnd && (scene.question || scene.choices.length > 0) && <section className="novel-choices" aria-label={t("novel.yourChoice")}>
            <p>{scene.question || t("novel.yourChoice")}</p>
            {scene.choices.map((choice, i) => <button disabled={busy} key={`${i}-${choice}`} onClick={() => void answer(choice)}><span>{i + 1}</span>{choice}</button>)}
            <form onSubmit={(e) => { e.preventDefault(); void answer(action); }}><input aria-label={t("novel.customAction")} placeholder={t("novel.customAction")} value={action} disabled={busy} onChange={(e) => setAction(e.target.value)} /><button disabled={busy || !action.trim()} type="submit">↵</button></form>
          </section>}
        </> : <div className="novel-opening"><span className="novel-eyebrow">{t("novel.ready")}</span><h2>{story.title}</h2><p>{t("novel.readyHint")}</p><button className="novel-primary" disabled={busy} onClick={() => void onGenerate()}>{t("novel.begin")}</button></div>}
        <footer className="novel-reader-controls" aria-label={t("novel.controls")}>
          <button disabled={!lineIndex && !sceneIndex} onClick={previous}>← {t("novel.previous")}</button>
          <button disabled={!scene} aria-pressed={auto} onClick={() => setAuto((v) => !v)}>{t("novel.auto")}</button>
          {selectedFrame?.status === "ready" && <button disabled={busy} onClick={() => void onGenerate(undefined, selectedFrame.id, true)}>{t("novel.redraw")}</button>}
          <button aria-pressed={speech.enabled} title={t("novel.ttsHint")} onClick={speech.toggle}>{t("novel.autoTts")}: {t(speech.enabled?"novel.ttsOn":"novel.ttsOff")}</button>
          {speech.enabled && !speech.error && <button disabled={!line} onClick={speech.status==="playing" || speech.status==="loading" ? speech.stop : speech.replay}>{t(speech.status==="playing" || speech.status==="loading" ? "novel.ttsStop" : "novel.ttsReplay")}</button>}
          <button onClick={() => setPanel("journal")}>{t("novel.journal")}</button>
          <button onClick={() => setPanel("memory")}>{t("novel.memory")}</button>
          <button onClick={async () => { const result = await onSave({ scene: sceneIndex, line: lineIndex }); if (result) setBookmarkSaved(true); }} disabled={busy || !scene}>{t(bookmarkSaved ? "novel.bookmarked" : "novel.bookmark")}</button>
          <button onClick={() => setHidden(true)}>{t("novel.hideUi")}</button>
          <span className="novel-control-spacer" />
          <button className="novel-continue" onClick={next} disabled={(busy && atEnd) || (atEnd && Boolean(scene?.question || scene?.choices.length))}>{t(atEnd ? "novel.continue" : "novel.next")} →</button>
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
