import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const T=process.env.TREE;
const { CourseStore } = await import(`${T}/host/store.mjs`); const { CourseSession } = await import(`${T}/host/course.mjs`);
function mk(spec, ages){ const s=CourseSession.create(new CourseStore(mkdtempSync(join(tmpdir(),"p2v-"))),{owner:"teacher:t",title:"AI",ages}); let t0=1000;
 s.confirmCheckpoint({id:"files",text:"c",at:t0}); s.observeIntake({state:"clarifying",questions:[{id:"q1"}],at:t0+500}); s.answerIntake({text:"Topic: AI. Course: x.",at:t0+750}); s.observeIntake({state:"ready_to_draft",at:t0+900});
 s.confirmCheckpoint({id:"outline",text:"c",at:t0+1000}); s.proposeObjectives({items:[{kind:"local",statement:"Students can spot AI."}],sources:["s"],at:t0+2000});
 const [p1]=s.view().proposals.map(p=>p.id); s.decideObjectives({decisions:[{verb:"accept",proposalId:p1}],text:"a",at:t0+3000});
 s.proposeLessonPlan({spec:spec(p1),at:t0+4000}); return {s,p1}; }
const base=(id,extra={})=>({title:"T",activities:[{title:"A",minutes:5,objectiveIds:[id],learnerDoes:"x",teacherDoes:"y",evidenceIfAny:"observation",...extra}]});
// 1) v1 plan: view plan has no v2 keys
let {s}=mk(id=>base(id),{min:5,max:7}); let pl=s.view().plan;
console.log("v1 view keys:",Object.keys(pl).join(","),"| activity keys:",Object.keys(pl.activities[0]).join(","));
// 2) raw (un-normalised) v2 spec injected through the replay/propose path at stage 1
({s}=mk(id=>base(id,{aiStatus:"required",helpAfter:"ai"}),{min:5,max:7})); pl=s.view().plan;
console.log("replay path, stage 1, raw aiStatus=required ->", pl.activities[0].aiStatus, "(clamp is applied at draft normalisation only)");
s.confirmLessonPlan({text:"c",at:6000}); s.publish({text:"p",at:7000});
const v=s.view().versions.at(-1); console.log("sealed version has v2 fields:", JSON.stringify(v).includes("aiStatus"));
