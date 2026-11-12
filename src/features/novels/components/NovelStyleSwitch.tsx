import {useRef,useState} from "react";
import {useI18n} from "../../../shared/i18n";
import {NOVEL_ART_STYLES,novelArtStylePreset,type NovelArtStylePreset} from "../../../shared/novelVisualDefaults";
import {NovelTextField,type SetupFieldsProps} from "./SetupFields";
export function NovelStyleSwitch({config,patch}:SetupFieldsProps) {
  const {t}=useI18n();const [mode,setMode]=useState(()=>novelArtStylePreset(config.artStyle));
  const custom=useRef(mode==="custom"?config.artStyle:"");
  function select(next:NovelArtStylePreset|"custom") {
    if(mode==="custom")custom.current=config.artStyle;
    setMode(next);patch({artStyle:next==="custom"?custom.current||config.artStyle:NOVEL_ART_STYLES[next]});
  }
  return <div className="novel-style-switch">
    <span>{t("novel.artStyle")}</span>
    <div className="novel-style-options" role="group" aria-label={t("novel.artStyle")}>{([...Object.keys(NOVEL_ART_STYLES),"custom"] as Array<NovelArtStylePreset|"custom">).map(id=><button key={id} type="button" aria-pressed={mode===id} onClick={()=>select(id)}>{t(`novel.style.${id}`)}</button>)}</div>
    <p className="novel-hint">{t(`novel.styleHint.${mode}`)}</p>
    {mode==="custom"?<NovelTextField config={config} patch={patch} name="artStyle" label="novel.artStyle" rows={3}/>:<details className="novel-style-prompt"><summary>{t("novel.stylePrompt")}</summary><p>{config.artStyle}</p></details>}
  </div>;
}
