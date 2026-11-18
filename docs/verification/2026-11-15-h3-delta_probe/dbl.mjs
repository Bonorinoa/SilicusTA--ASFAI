import { scriptedPlanV2 } from "./tree/host/test/scripted-course.mjs";
const { PlanWorker } = await import("./tree/host/worker.mjs");
const OBJ = [{ id: "urn:uuid:aaa", statement: "Students can explain binary search." }];
const prompt0 = await (async () => { let b; await new PlanWorker({url:"https://x.test/v1",model:"m",fetchImpl: async (u,o)=>{b=JSON.parse(o.body).messages[0].content; return {ok:true,status:200,json:async()=>({choices:[{message:{content:"{}"},finish_reason:"stop"}]})}}}).draft({objectives:OBJ,topic:"T",ages:{min:12,max:14}}).catch(()=>{}); return b; })();
const plan = scriptedPlanV2(prompt0);
plan.activities = plan.activities.map((a, i) => ({ ...a, objectiveIds: ["urn:uuid:aaa"], ...(i === 2 ? { aiStatus: "required", learnerFirst: undefined } : {}) }));
const spec = await new PlanWorker({url:"https://x.test/v1",model:"m",fetchImpl: async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(plan)},finish_reason:"stop"}]})})}).draft({objectives:OBJ,topic:"T",ages:{min:12,max:14}});
console.log(JSON.stringify({ notes: spec.notes, a3: { aiStatus: spec.activities[2].aiStatus, clamped: spec.activities[2].clamped } }, null, 1));
