/** Verifies every pre-existing feature still works (Feature 22). */
const BASE='http://localhost:4100';
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};
function jar(){return new Map()}
function ck(j,set){if(!set)return;const arr=Array.isArray(set)?set:(typeof set.split==='function'?[set]:[]);
  for(const c of arr)for(const p of String(c).split(',').map(x=>x.split(';')[0].trim()).filter(Boolean)){const i=p.indexOf('=');if(i>0)j.set(p.slice(0,i),p.slice(i+1))}}
async function req(p,o={},j=null){const h={...(o.headers||{})};if(j&&j.size)h.cookie=[...j].map(([k,v])=>`${k}=${v}`).join('; ');
  if(o.json!==undefined)h['content-type']='application/json';
  const r=await fetch(BASE+p,{method:o.method||'GET',headers:h,body:o.json!==undefined?JSON.stringify(o.json):undefined});ck(j,r.headers.getSetCookie?.());return r}

// --- customer: anonymous chat ---
const V=jar(); await req('/api/session',{},V);
let r=await req('/api/conversations',{method:'POST',json:{visitorId:'anon-1',customerName:'Alice',customerPhone:'+1',campaign:{first_message:'Hello',utm_source:'google',utm_medium:'cpc',utm_campaign:'spring'}}},V);
const cid=(await r.json()).conversationId; ok('REGRESSION: anonymous conversation created',r.status===201&&!!cid);
r=await req(`/api/conversations/${cid}`,{},V); const conv=await r.json();
ok('REGRESSION: customer reads own conversation',r.status===200&&conv.customer_name==='Alice');
ok('REGRESSION: campaign attribution stored',conv.utm_campaign==='spring'&&conv.utm_source==='google');
r=await req(`/api/conversations/${cid}`,{method:'PATCH',json:{customerName:'Alice B'}},V);
ok('REGRESSION: customer updates details',(await r.json()).customer_name==='Alice B');
r=await req(`/api/conversations/${cid}/messages`,{method:'POST',json:{message:'second',clientId:'c2'}},V);
ok('REGRESSION: text send with clientId',r.status===201);
r=await req(`/api/conversations/${cid}/messages?since=2000-01-01T00:00:00.000Z`,{},V);
ok('REGRESSION: incremental poll (since)',(await r.json()).messages.length>=2);
const old=(await (await req(`/api/conversations/${cid}/messages`,{},V)).json()).messages[0];
r=await req(`/api/conversations/${cid}/messages?before=${encodeURIComponent(new Date().toISOString())}`,{},V);
ok('REGRESSION: older-page read works',r.status===200);

// --- admin: login, authz, list, status, tags, events, stats ---
const A=jar();
r=await req('/api/admin/login',{method:'POST',json:{email:'admin@chatadmin.local',password:'wrong'}},A);
ok('REGRESSION: bad password rejected',r.status===401);
r=await req('/api/admin/login',{method:'POST',json:{email:'admin@chatadmin.local',password:'Admin@2026#Secure'}},A);
ok('REGRESSION: admin login',r.ok);
r=await req('/api/admin/me',{},A); ok('REGRESSION: /admin/me',r.ok);
r=await req('/api/admin/stats',{},A);
const st=await r.json(); ok('REGRESSION: dashboard stats',r.ok&&typeof st.stats.total==='number'&&Array.isArray(st.by_campaign));
r=await req(`/api/admin/conversations/${cid}`,{},A);
ok('REGRESSION: admin reads conversation',r.ok);
r=await req(`/api/admin/conversations/${cid}/messages`,{},A);
ok('REGRESSION: admin reads messages',(await r.json()).messages.length>=2);
r=await req(`/api/admin/conversations/${cid}/messages`,{method:'POST',json:{message:'agent reply'}},A);
ok('REGRESSION: admin replies',r.status===201);
r=await req(`/api/admin/conversations/${cid}/read`,{method:'POST'},A); ok('REGRESSION: mark read',r.ok);
r=await req(`/api/admin/conversations/${cid}/tags`,{method:'POST',json:{tag:'VIP'}},A);
ok('REGRESSION: add tag',(await r.json()).tags.includes('vip'));
r=await req(`/api/admin/conversations/${cid}/events`,{},A);
ok('REGRESSION: events logged',(await r.json()).events.length>0);
r=await req(`/api/admin/conversations/${cid}`,{method:'PATCH',json:{status:'closed'}},A);
ok('REGRESSION: close conversation',(await r.json()).conversation?.status==='closed');
// closed conversation must block the customer
r=await req(`/api/conversations/${cid}/messages`,{method:'POST',json:{message:'after close'}},V);
ok('REGRESSION: closed conversation blocks send',r.status===409);
r=await req(`/api/admin/conversations/${cid}`,{method:'PATCH',json:{status:'open'}},A);
ok('REGRESSION: reopen conversation',(await r.json()).conversation?.status==='open');
r=await req(`/api/admin/conversations?filter=all&limit=10`,{},A);
ok('REGRESSION: conversation list + pagination',r.ok&&Array.isArray((await r.json()).rows));
r=await req('/api/admin/campaigns',{},A); ok('REGRESSION: campaign list',r.ok);
r=await req('/api/admin/settings',{method:'PATCH',json:{companyName:'Support Team'}},A); ok('REGRESSION: admin settings update',r.ok);

// --- authorization ---
const noAuth=jar();
r=await req('/api/admin/stats',{},noAuth); ok('REGRESSION: admin stats need session',r.status===401);
r=await req(`/api/admin/conversations/${cid}`,{},noAuth); ok('REGRESSION: admin conversation needs session',r.status===401);
const B=jar(); await req('/api/session',{},B);
r=await req(`/api/conversations/${cid}`,{},B); ok('REGRESSION: visitor isolation on conversation',r.status===404);
r=await req(`/api/conversations/${cid}/messages`,{},B); ok('REGRESSION: visitor isolation on messages',r.status===404);
r=await req('/api/settings',{},B); ok('REGRESSION: public settings readable',r.ok);

// --- logout ---
r=await req('/api/admin/logout',{method:'POST'},A); ok('REGRESSION: logout',r.ok);
r=await req('/api/admin/me',{},A); ok('REGRESSION: session revoked after logout',r.status===401);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
