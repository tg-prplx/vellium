import {createHash} from "crypto";
import type {NovelCharacter,NovelIllustration} from "../../../src/shared/types/novels.js";
const str=(v:unknown)=>typeof v==="string"?v.trim():"";
const obj=(v:unknown):Record<string,unknown>=>v && typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const groupName=(name:string)=>/\s(?:&|\+|and|и)\s/i.test(name);
export function expandNovelCharacters(value:unknown,known:NovelCharacter[],depth=0):unknown[] {
  if(!Array.isArray(value)||depth>3)return [];
  const result:unknown[]=[];
  for(const item of value.slice(0,40)) {
    if(result.length>=40)break;
    const row=obj(item);
    if(Array.isArray(row.members) && row.members.length) {
      const id=str(row.id);const group={...row,members:undefined,isGroup:true};if(id)result.push(group);
      const parent={...group,id,name:str(row.name)} as unknown as NovelCharacter;
      result.push(...expandNovelCharacters(row.members.slice(0,20).map(m=>({...obj(m),sourceCharacterId:id})),[...known,parent],depth+1));continue;
    }
    const name=str(row.name),id=str(row.id),source=str(row.sourceCharacterId);
    const identities=[...known,...result.map(v=>obj(v) as unknown as NovelCharacter)];
    const parent=identities.find(c=>c.id===(source||id));
    if(parent && name && name.toLocaleLowerCase()!==str(parent.name).toLocaleLowerCase() && (source || parent.isGroup || groupName(parent.name))) {
      const previous=identities.find(c=>c.sourceCharacterId===parent.id && str(c.name).toLocaleLowerCase()===name.toLocaleLowerCase());
      const memberId=previous?.id || (id && id!==parent.id && !identities.some(c=>c.id===id)?id:'member-'+createHash('sha256').update(parent.id+'|'+name.toLocaleLowerCase()).digest('hex').slice(0,24));
      result.push({...row,id:memberId,sourceCharacterId:parent.id});
    }else result.push(row);
  }
  return result;
}
export function resolveVisibleMembers(frame:Pick<NovelIllustration,'characterIds'|'subjectNames'|'prompt'>,known:NovelCharacter[]) {
  const unique=known.filter((c,i)=>known.findIndex(other=>other.id===c.id)===i);
  const groups=new Set(unique.filter(c=>c.isGroup || groupName(c.name) || unique.some(m=>m.sourceCharacterId===c.id && m.id!==c.id)).map(c=>c.id));
  const named=(frame.subjectNames||[]).map(name=>{
    const matches=unique.filter(c=>!groups.has(c.id)&&c.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    const scoped=matches.filter(c=>frame.characterIds.includes(c.id)||Boolean(c.sourceCharacterId&&frame.characterIds.includes(c.sourceCharacterId)));
    return scoped.length===1?scoped[0]:matches.length===1?matches[0]:undefined;
  }).filter((c):c is NovelCharacter=>!!c);
  if(named.length)return {ids:[...new Set(named.map(c=>c.id))],ambiguous:named.length!==(frame.subjectNames||[]).length};
  const ids:string[]=[];let ambiguous=false;
  for(const id of frame.characterIds){
    const person=unique.find(c=>c.id===id||c.name.toLocaleLowerCase()===id.toLocaleLowerCase());if(!person)continue;
    if(!groups.has(person.id)){ids.push(person.id);continue;}
    const words=' '+frame.prompt.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).join(' ')+' ';
    const mentioned=unique.filter(c=>c.sourceCharacterId===person.id && !c.isGroup && c.id!==person.id && words.includes(' '+c.name.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).join(' ')+' '));
    if(!mentioned.length)ambiguous=true;else ids.push(...mentioned.map(c=>c.id));
  }
  return {ids:[...new Set(ids)],ambiguous};
}

/** Legacy/partial model responses must remain drawable. Prefer individual
 * profiles, then named passages; keep an unresolved shared card as context,
 * never as one visual person or a reason to reject the image. */
export function resolveImageCast(frame:Pick<NovelIllustration,'characterIds'|'subjectNames'|'prompt'>,known:NovelCharacter[]) {
  const unique=known.filter((c,i)=>known.findIndex(other=>other.id===c.id)===i);
  const resolved=resolveVisibleMembers(frame,unique);
  const characters=resolved.ids.map(id=>unique.find(c=>c.id===id)!).filter(Boolean);
  const references:NovelCharacter[]=[];
  const words=(value:string)=>' '+value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).join(' ')+' ';
  const mentions=(value:string,name:string)=>words(value).includes(words(name));
  for(const id of frame.characterIds) {
    const group=unique.find(c=>c.id===id||c.name.toLocaleLowerCase()===id.toLocaleLowerCase());
    if(!group || !(group.isGroup||groupName(group.name)||unique.some(c=>c.sourceCharacterId===group.id&&c.id!==group.id)))continue;
    if(!resolved.ambiguous && characters.some(c=>c.sourceCharacterId===group.id))continue;
    const memberNames=group.name.split(/\s*(?:&|\+|\/|,|\band\b|\bи\b)\s*/i).filter(Boolean);
    const names=frame.subjectNames?.length?frame.subjectNames:memberNames.filter(name=>mentions(frame.prompt,name));
    let needsReference=false;
    for(const name of names) {
      if(characters.some(c=>c.name.toLocaleLowerCase()===name.toLocaleLowerCase()))continue;
      const passage=(source:string)=>{
        const parts=source.split(/(?<=[.!?;])\s+|\n+|,\s+|\s+(?:while|whereas|а)\s+/i);
        return parts.filter(part=>mentions(part,name) && !memberNames.some(other=>other.toLocaleLowerCase()!==name.toLocaleLowerCase()&&mentions(part,other))).map(part=>part.replace(/^.*?:\s*/,'')) .join('. ').slice(0,900);
      };
      const appearance=passage(group.appearance||group.description);
      const outfit=passage(group.outfit||'') || (memberNames.some(member=>mentions(group.outfit||'',member))?'':group.outfit||'');
      characters.push({...group,id:`${group.id}:${name}`,sourceCharacterId:group.id,isGroup:false,name,appearance,description:'',outfit});
      if(!appearance)needsReference=true;
    }
    if(!names.length||needsReference)references.push(group);
  }
  return {characters,references};
}
