import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../shared/api";
import { startBackgroundTask, finishBackgroundTask, failBackgroundTask, updateBackgroundTask } from "../../shared/backgroundTasks";
import type { NovelConfig, NovelPreviewScene, NovelStory, NovelSummary } from "../../shared/types/novels";
import { withPreviewScenes } from "./preview";
import { novelImageQueue, usesLayers } from "./layers";
import { requestOpenChat } from "../../shared/appNavigation";
import { directorNote } from "./directorNote";
import { useI18n } from "../../shared/i18n";

export function useNovelWorkspace() {
  const { t } = useI18n();
  const [list, setList] = useState<NovelSummary[]>([]);
  const [story, setStory] = useState<NovelStory | null>(null);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null); const currentId = useRef<string | null>(null);
  // Scenes streamed before the story is saved. Display only: every API call
  // still uses `story`, which carries the authoritative revision.
  const [preview, setPreview] = useState<{ storyId: string; scenes: NovelPreviewScene[] } | null>(null);
  // Why the separate follow-up request runs, shown while it does.
  const [stageNote, setStageNote] = useState("");
  const view = useMemo(() => story && preview?.storyId === story.id ? withPreviewScenes(story, preview.scenes) : story, [story, preview]);
  const refresh = useCallback(async () => { setList(await api.novelList()); }, []);
  useEffect(() => { void refresh().catch((e) => setError(String(e))).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);
  async function open(id: string) {
    if (running.current) return;
    setError(""); setLoading(true); currentId.current = id;
    try { const next = await api.novelGet(id); if (currentId.current === id) setStory(next); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  async function create(title: string, config: NovelConfig) {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try { const next = await api.novelCreate(title, config); currentId.current = next.id; setStory(next); await refresh().catch(() => {}); return next; }
    catch (e) { setError(String(e)); } finally { running.current = false; setBusy(false); }
  }
  async function save(patch: { title?: string; config?: Partial<NovelConfig>; cursor?: NovelStory["cursor"] }) {
    if (!story || running.current) return;
    running.current = true; setBusy(true); setError("");
    try { const next = await api.novelUpdate(story, patch); if (currentId.current === next.id) setStory(next); return next; }
    catch (e) { setError(String(e)); } finally { running.current = false; setBusy(false); }
  }
  async function generate(action = "", illustrationId?: string, imagesOnly = false, createdStory?: NovelStory) {
    const target = createdStory || story;
    if (!target || running.current) return;
    running.current = true; setBusy(true); setError("");
    const controller = new AbortController(); abortRef.current = controller;
    const label = t(imagesOnly ? "novel.rendering" : "novel.generating");
    const taskId = startBackgroundTask({ scope: "novels", type: "generate", label: `${target.title} · ${label}`, cancellable: true,
      onCancel: () => { controller.abort(); void api.novelAbort(target.id).catch(() => {}); } });
    try {
      let next = imagesOnly ? target : target.config.generationMode === "lite"
        ? await streamText(target, action, controller.signal, taskId)
        : await api.novelGenerate(target, action, controller.signal);
      if (currentId.current === next.id) setStory(next);
      setPreview(null);
      if (imagesOnly || (next.config.imagesEnabled && next.config.workflow)) {
        // Layers mode draws backgrounds and sprites instead of a frame per scene.
        if(!usesLayers(next.config) && next.scenes.some(scene=>!scene.illustrations.length)) {
          next=await api.novelPrepareImages(next,controller.signal);
          if(currentId.current===next.id)setStory(next);
        }
        const frames = novelImageQueue(next)
          .filter((frame) => illustrationId ? frame.id === illustrationId : frame.status === "pending");
        const failures:string[]=[];
        for (let i=0; i<frames.length; i++) {
          controller.signal.throwIfAborted();
          updateBackgroundTask(taskId, { label: `${target.title} · ${t("novel.rendering")} ${i+1}/${frames.length}`, progress: 10+Math.round(i/frames.length*85) });
          next = await api.novelImages(next, controller.signal, frames[i].id);
          // Publish each completed shot immediately; a later slow job must not
          // hide the opening image until the entire batch has finished.
          if (currentId.current === next.id) setStory(next);
          const completed=novelImageQueue(next).find(frame=>frame.id===frames[i].id);
          if(completed?.status==="error")failures.push(completed.error || t("novel.imageFailed"));
        }
        if(failures.length)throw new Error(`${t("novel.imageFailed")}: ${[...new Set(failures)].join("; ")}`);
      }
      finishBackgroundTask(taskId);
      return next;
    } catch (e) {
      if (controller.signal.aborted) updateBackgroundTask(taskId, { status: "cancelled", finishedAt: Date.now() });
      else { setError(e instanceof Error ? e.message : String(e)); failBackgroundTask(taskId, String(e)); }
      // Any successfully completed text/images survive a later image failure or cancellation.
      await api.novelGet(target.id).then((next) => { if (currentId.current === next.id) setStory(next); }).catch(() => {});
    } finally { setPreview(null); setStageNote(""); abortRef.current = null; running.current = false; setBusy(false); await refresh().catch(() => {}); }
  }
  async function streamText(target: NovelStory, action: string, signal: AbortSignal, taskId: string) {
    let saved: NovelStory | null = null, failure = "";
    await api.novelGenerateStream(target, action, (event) => {
      if (event.type === "preview") { if (currentId.current === target.id) setPreview({ storyId: target.id, scenes: event.scenes }); }
      else if (event.type === "stage") {
        const note = directorNote(event.reasons || [], t);
        setStageNote(note);
        updateBackgroundTask(taskId, { label: `${target.title} · ${note}` });
      }
      else if (event.type === "done") saved = event.story;
      else if (event.type === "error") failure = event.error;
    }, signal);
    if (failure) throw new Error(failure);
    if (!saved) throw new Error(t("novel.streamIncomplete"));
    return saved as NovelStory;
  }
  /** Change a picture and render it again. Only ever called from a user action. */
  async function editImage(imageId: string, patch: { prompt?: string; reseed?: boolean }) {
    if (!story || running.current) return;
    running.current = true; setBusy(true); setError("");
    let next: NovelStory | undefined;
    try { next = await api.novelEditImage(story, imageId, patch); if (currentId.current === next.id) setStory(next); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; setBusy(false); }
    if (next) return generate("", imageId, true, next);
  }
  async function addFrame(sceneId: string, atLine: number, prompt: string) {
    if (!story || running.current) return;
    running.current = true; setBusy(true); setError("");
    let added: { story: NovelStory; frameId: string } | undefined;
    try { added = await api.novelAddFrame(story, sceneId, atLine, prompt); if (currentId.current === added.story.id) setStory(added.story); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; setBusy(false); }
    if (added) return generate("", added.frameId, true, added.story);
  }
  /** Continue the story as an ordinary chat with the same characters. */
  async function toChat() {
    if (!story || running.current) return;
    running.current = true; setBusy(true); setError("");
    try { const chat = await api.novelToChat(story.id); requestOpenChat(chat.chatId); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function exportWriter() {
    if (!story || running.current) return;
    running.current = true; setBusy(true); setError("");
    try { return await api.novelExportWriter(story.id); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function progress(cursor: NovelStory["cursor"]) {
    if (!story || currentId.current !== story.id) return;
    try { await api.novelProgress(story.id, cursor); return true; }
    catch (e) { if(currentId.current===story.id)setError(String(e)); return false; }
  }
  async function reset() {
    if(!story || running.current)return;
    running.current=true;setBusy(true);setError("");
    try{const next=await api.novelReset(story);if(currentId.current===next.id)setStory(next);await refresh().catch(()=>{});return next;}
    catch(e){setError(String(e));}finally{running.current=false;setBusy(false);}
  }
  async function remove(id = story?.id) {
    if (!id || running.current) return false;
    running.current = true; setBusy(true); setError("");
    try {
      await api.novelDelete(id);
      if(currentId.current===id){currentId.current=null;setStory(null);}
      setList(items=>items.filter(item=>item.id!==id));
      return true;
    } catch (e) { setError(String(e)); return false; }
    finally { running.current = false; setBusy(false); }
  }
  return { list, story, view, stageNote, busy, loading, error, open, create, save, progress, generate, editImage, addFrame, toChat, exportWriter, refresh, reset, remove, clearError: () => setError(""),
    close: () => { if (!running.current) { currentId.current = null; setStory(null); } },
    cancel: () => { abortRef.current?.abort(); if (story) void api.novelAbort(story.id).catch(() => {}); } };
}
