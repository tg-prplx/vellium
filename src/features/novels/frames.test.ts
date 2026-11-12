import {expect,it} from "vitest";
import {scheduledNovelFrames} from "./frames";
import type {NovelIllustration} from "../../shared/types/novels";
const frames=(positions:number[]):NovelIllustration[]=>positions.map((atLine,i)=>({id:String(i),atLine,prompt:"Synthetic",characterIds:[],seed:1,url:"/test.png",status:"ready"}));
it("shows one-based opening frames immediately, including old saved stories",()=>{expect(scheduledNovelFrames(frames([1,3]),4).map(f=>f.atLine)).toEqual([0,3]);});
it("gives duplicate frames distinct visible lines without mutating saved data",()=>{const input=frames([0,0,0]);expect(scheduledNovelFrames(input,2).map(f=>f.atLine)).toEqual([0,1]);expect(input.map(f=>f.atLine)).toEqual([0,0,0]);});
