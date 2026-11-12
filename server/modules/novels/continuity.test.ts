import {expect,it} from "vitest";
import {continuityTurn} from "./continuity.js";
it("removes legacy plot bookkeeping from historical inputs and per-scene outputs deterministically",()=>{
const memory={summary:"SECRET_SUMMARY",facts:["SECRET_FACT"],threads:["SECRET_THREAD"],characters:[{id:"one",name:"Test",appearance:"red hair",state:"garden"}]};
for(const raw of [JSON.stringify({memory}),JSON.stringify({scenes:[{lines:[{text:"Actual narrative"}],memory}]})]){
 const compact=continuityTurn(raw);expect(compact).not.toMatch(/SECRET_|summary|facts|threads|memory/);expect(compact).toContain('red hair');expect(continuityTurn(raw)).toBe(compact);
}
});
