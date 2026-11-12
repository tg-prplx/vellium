import {expect,it} from "vitest";
import {scheduledNovelFrames} from "./frames";
import type {NovelIllustration} from "../../shared/types/novels";
const frames=(positions:number[]):NovelIllustration[]=>positions.map((atLine,i)=>({id:String(i),atLine,prompt:"Synthetic",characterIds:[],seed:1,url:"/test.png",status:"ready"}));
it("shows one-based opening frames immediately, including old saved stories",()=>{expect(scheduledNovelFrames(frames([1,3]),4).map(f=>f.atLine)).toEqual([0,3]);});
it("drops duplicate cuts instead of moving them onto unrelated dialogue",()=>{const input=frames([0,0,0]);expect(scheduledNovelFrames(input,2).map(f=>f.atLine)).toEqual([0]);expect(input.map(f=>f.atLine)).toEqual([0,0,0]);});

it("keeps a two-shot plan below a three-frame maximum and waits for the planned reveal line",()=>{expect(scheduledNovelFrames(frames([0,5]),8).map(f=>f.atLine)).toEqual([0,5]);});
