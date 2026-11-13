import {useState} from 'react';
import {useI18n} from '../../../shared/i18n';
import type {CharacterDetail} from '../../../shared/types/contracts';
import type {SetupFieldsProps} from './SetupFields';
export function NovelWorldCards({config,patch,characters}:SetupFieldsProps&{characters:CharacterDetail[]}){
 const {t}=useI18n(),[search,setSearch]=useState('');const ids=config.settingCardIds||[];
 const filtered=characters.filter(card=>card.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 const toggle=(id:string,checked:boolean)=>patch({settingCardIds:checked?[...ids,id]:ids.filter(value=>value!==id)});
 return <details className="novel-advanced" open={ids.length>0||undefined}><summary>{t('novel.worldCards')}{ids.length>0&&` · ${ids.length}/3`}</summary>
  <p className="novel-hint">{t('novel.worldCardsHint')}</p>
  {characters.length>5&&<input className="novel-search" aria-label={t('novel.worldSearch')} placeholder={t('novel.worldSearch')} value={search} onChange={e=>setSearch(e.target.value)}/>}
  <div className="novel-cast-picker">
   {filtered.map(card=><label key={card.id}><input type="checkbox" checked={ids.includes(card.id)} disabled={!ids.includes(card.id)&&ids.length>=3} onChange={e=>toggle(card.id,e.target.checked)}/>{card.name}</label>)}
   {ids.filter(id=>!characters.some(card=>card.id===id)).map(id=><label key={id}><input type="checkbox" checked onChange={()=>toggle(id,false)}/>{t('novel.worldCardSaved')}</label>)}
   {!characters.length&&!ids.length&&<p>{t('novel.worldNoCards')}</p>}
   {characters.length>0&&!filtered.length&&<p>{t('novel.setup.noCastMatches')}</p>}
  </div>
 </details>;
}
