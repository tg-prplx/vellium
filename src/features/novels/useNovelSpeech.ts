import {useEffect,useRef,useState} from "react";
import {api} from "../../shared/api";
import {useI18n} from "../../shared/i18n";
import {RealtimeTtsPlayer} from "../../shared/realtimeTts";
import {LOCAL_INFERENCE_SETTINGS_URL,LOCAL_TERATTS_MODEL_ID} from "../../shared/localModelConfig";
import type {AppSettings} from "../../shared/types/contracts";

export function novelSpeechKey(id:string){return `vellium:novels:auto-tts:v1:${id}`;}
export function readNovelSpeechEnabled(id:string){try{return localStorage.getItem(novelSpeechKey(id))==="on";}catch{return false;}}

type VoiceSettings=Pick<AppSettings,"ttsBaseUrl"|"ttsModel"|"ttsVoice"|"ttsRealtime">;
export function useNovelSpeech(storyId:string,lineKey:string,text:string,active:boolean) {
  const {t}=useI18n();const translate=useRef(t);translate.current=t;
  const [enabled,setEnabled]=useState(()=>readNovelSpeechEnabled(storyId));
  const [settings,setSettings]=useState<VoiceSettings|null>(null);
  const [status,setStatus]=useState<"idle"|"loading"|"playing"|"done"|"error">("idle");
  const [error,setError]=useState("");const [finishedKey,setFinishedKey]=useState("");const [retry,setRetry]=useState(0);const [paused,setPaused]=useState(false);const [configRetry,setConfigRetry]=useState(0);
  const started=useRef("");const cache=useRef(new Map<string,Blob>());
  const stopRef=useRef<()=>void>(()=>{});
  function toggle(){const next=!enabled;stopRef.current();setSettings(null);setError("");setPaused(false);started.current="";setEnabled(next);try{localStorage.setItem(novelSpeechKey(storyId),next?"on":"off");}catch{/* Session preference remains usable. */}}
  function replay(){setFinishedKey("");setError("");setPaused(false);if(!settings)setConfigRetry(n=>n+1);setRetry(n=>n+1);}
  function stop(){stopRef.current();setPaused(true);setStatus("idle");}
  useEffect(()=>{setPaused(false);setError("");},[lineKey]);
  useEffect(()=>{
    if(!enabled)return;
    let cancelled=false;setStatus("loading");
    void api.settingsGet().then(s=>{
      if(cancelled)return;
      if(!s.ttsBaseUrl || !s.ttsModel || !s.ttsVoice){setStatus("error");setError(translate.current("novel.ttsNotConfigured"));return;}
      setSettings({ttsBaseUrl:s.ttsBaseUrl,ttsModel:s.ttsModel,ttsVoice:s.ttsVoice,ttsRealtime:s.ttsRealtime});
    }).catch(e=>{if(!cancelled){setStatus("error");setError(String(e));}});
    return()=>{cancelled=true;};
  },[enabled,configRetry]);
  useEffect(()=>{
    if(!enabled || !settings || !active || paused || !text.trim())return;
    const runKey=`${lineKey}:${retry}`;if(started.current===runKey)return;started.current=runKey;
    const controller=new AbortController();let audio:HTMLAudioElement|null=null;let objectUrl="";let realtime:RealtimeTtsPlayer|null=null;
    const release=()=>{if(audio){audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute("src");audio=null;}if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl="";}realtime?.stop();};
    const cleanup=()=>{controller.abort();release();};stopRef.current=cleanup;
    setStatus("loading");setError("");
    void (async()=>{
      try {
        const streaming=settings.ttsRealtime || (settings.ttsBaseUrl===LOCAL_INFERENCE_SETTINGS_URL && settings.ttsModel===LOCAL_TERATTS_MODEL_ID);
        if(streaming){
          realtime=new RealtimeTtsPlayer({onPlaybackStart:()=>{if(!controller.signal.aborted)setStatus("playing");}});
          await realtime.play((onEvent,signal)=>api.chatTtsTextRealtime(text,onEvent,signal,{voice:settings.ttsVoice}));
          if(!controller.signal.aborted){setFinishedKey(lineKey);setStatus("done");}return;
        }
        const cacheKey=JSON.stringify([settings.ttsBaseUrl,settings.ttsModel,settings.ttsVoice,text]);
        let blob=cache.current.get(cacheKey);
        if(!blob){blob=await api.chatTtsText(text,{voice:settings.ttsVoice},controller.signal);if(controller.signal.aborted)return;
          if(blob.size<=4*1024*1024){cache.current.set(cacheKey,blob);while(cache.current.size>4)cache.current.delete(cache.current.keys().next().value!);}}
        if(controller.signal.aborted)return;
        objectUrl=URL.createObjectURL(blob);audio=new Audio(objectUrl);
        audio.onended=()=>{if(!controller.signal.aborted){release();setFinishedKey(lineKey);setStatus("done");}};
        audio.onerror=()=>{if(!controller.signal.aborted){release();setStatus("error");setError(translate.current("novel.ttsPlaybackError"));}};
        await audio.play();if(!controller.signal.aborted)setStatus("playing");
      }catch(e){if(!controller.signal.aborted){release();setStatus("error");setError(e instanceof Error?e.message:String(e));}}
    })();
    return()=>{cleanup();if(stopRef.current===cleanup)stopRef.current=()=>{};setStatus("idle");};
  },[enabled,settings,lineKey,text,active,paused,retry]);
  return {enabled,toggle,status:!enabled?"idle":status,error,replay,stop,done:enabled && finishedKey===lineKey && status!=="loading" && status!=="playing" && status!=="error"};
}
