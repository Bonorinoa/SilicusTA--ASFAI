const { PlanWorker } = await import(`${process.env.TREE}/host/worker.mjs`);
const OBJ = [{ id: "urn:uuid:aaa", statement: "Students can explain what an algorithm is." }];
async function grab(input){ let body; const f=async(u,o)=>{body=JSON.parse(o.body).messages[0].content; return {ok:true,status:200,json:async()=>({choices:[{message:{content:"{}"},finish_reason:"stop"}]})}};
 try{ await new PlanWorker({url:"https://example.test/v1",model:"m",fetchImpl:f}).draft({objectives:OBJ,...input}); }catch{} return body; }
const anchored={ages:{min:9,max:10},anchorPrereqs:[{id:"mt_PREREQ12345",name:"Pattern spotting",evidence:["Child sorts shapes by a rule.","Child names the rule."]}],topic:"Algorithms",course:"Grade 4, 45 min"};
import fs from "node:fs";
fs.writeFileSync(process.env.TMPDIR+"/hvprobe/prompt_base.txt", await grab({topic:"Algorithms"}));
fs.writeFileSync(process.env.TMPDIR+"/hvprobe/prompt_anch.txt", await grab(anchored));
fs.writeFileSync(process.env.TMPDIR+"/hvprobe/prompt_age_noanchor.txt", await grab({ages:{min:9,max:10},topic:"Algorithms"}));
fs.writeFileSync(process.env.TMPDIR+"/hvprobe/prompt_anchor_noage.txt", await grab({anchorPrereqs:anchored.anchorPrereqs,topic:"Algorithms"}));
for (const m of [1,2,3,4]) fs.writeFileSync(process.env.TMPDIR+`/hvprobe/prompt_s${m}.txt`, await grab({ages:{min:[5,9,13,16][m-1],max:20}}));
