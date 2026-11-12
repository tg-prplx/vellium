import {useEffect,useState} from "react";
import {api} from "../../../shared/api";
import {useI18n} from "../../../shared/i18n";
import type {SetupFieldsProps} from "./SetupFields";
export function NovelPromptEditor({config,patch}:SetupFieldsProps) {
  const {t}=useI18n();const [open,setOpen]=useState(false),[defaultPrompt,setDefault]=useState(""),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!open)return;let cancelled=false;setError("");setDefault("");
    void api.novelPromptPreview({language:config.language,pov:config.pov,povCharacter:config.povCharacter,imagePov:config.imagePov,imagePovCharacter:config.imagePovCharacter,imagesEnabled:config.imagesEnabled}).then(result=>{if(!cancelled)setDefault(result.defaultPrompt);}).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;};
  },[open,config.language,config.pov,config.povCharacter,config.imagePov,config.imagePovCharacter,config.imagesEnabled,retry]);
  const custom=Boolean(config.systemPrompt?.trim());
  return <details className="novel-advanced" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t("novel.systemPrompt")}</summary>
    <p className="novel-hint">{t("novel.systemPromptHint")}</p>
    {error && <div role="alert" className="novel-validation">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>{t("novel.promptRetry")}</button></div>}
    <label className="novel-field"><span>{t(custom?"novel.promptCustom":"novel.promptDefault")}</span><textarea className="novel-system-prompt" aria-label={t("novel.systemPrompt")} rows={15} maxLength={40000} disabled={!custom && !defaultPrompt} value={custom?config.systemPrompt:defaultPrompt} placeholder={t("chat.loading")} onChange={e=>patch({systemPrompt:e.target.value})}/></label>
    {custom && <button type="button" className="novel-link" onClick={()=>patch({systemPrompt:""})}>{t("novel.promptReset")}</button>}
  </details>;
}
