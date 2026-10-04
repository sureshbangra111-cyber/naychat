import fs from 'node:fs';
const BASE='http://localhost:4100';
let pass=0,fail=0;
const ok=(n,c,extra='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${extra?' :: '+extra:''}`)};

// cookie jar per identity
function jar(){return new Map()}
function ck(j,set){if(!set)return;const arr=Array.isArray(set)?set:(typeof set.split==='function'?[set]:[]);for(const c of arr){for(const p of String(c).split(',').map(x=>x.split(';')[0].trim()).filter(Boolean)){const i=p.indexOf('=');if(i>0)j.set(p.slice(0,i),p.slice(i+1))}}}
async function req(path,opt={},j=null){const h={...(opt.headers||{})};if(j&&j.size)h.cookie=[...j].map(([k,v])=>`${k}=${v}`).join('; ');if(opt.json!==undefined)h['content-type']='application/json';
const r=await fetch(BASE+path,{method:opt.method||'GET',headers:h,body:opt.json!==undefined?JSON.stringify(opt.json):opt.body});
ck(j,r.headers.getSetCookie?.()||r.headers.get('set-cookie'));return r}

// customer A
const A=jar(); let r=await req('/api/session',{},A); ok('A session created',r.ok);
r=await req('/api/conversations',{method:'POST',json:{customerName:'Alice',campaign:{first_message:'Hello there'}}},A);
const convA=(await r.json()).conversationId; ok('A conversation created',r.status===201,convA);

// upload real PNG
const png=fs.readFileSync('/tmp/test.png');
const fd=new FormData(); fd.append('file',new Blob([png],{type:'image/png'}),'holiday.png');
r=await req(`/api/conversations/${convA}/attachments`,{method:'POST',body:fd},A);
const attA=await r.json(); ok('customer PNG upload',r.status===201,JSON.stringify(attA.attachment||attA));
const attAId=attA.attachment?.id;

r=await req(`/api/conversations/${convA}/messages`,{method:'POST',json:{attachmentId:attAId,clientId:'c1'}},A);
ok('customer media message created',r.status===201,await r.text());

r=await req(`/api/attachments/${attAId}`,{},A);
ok('A can fetch own attachment',r.status===200);
const et=r.headers.get('content-type'); const nosniff=r.headers.get('x-content-type-options');
ok('image served as image/png + nosniff',et==='image/png'&&nosniff==='nosniff',`${et} ${nosniff}`);
const buf=Buffer.from(await r.arrayBuffer()); ok('image bytes intact',buf.equals(png),`${buf.length} vs ${png.length}`);

// range request
r=await req(`/api/attachments/${attAId}`,{headers:{range:'bytes=0-9'}},A);
ok('range request returns 206',r.status===206,r.headers.get('content-range'));

// --- visitor B isolation ---
const B=jar(); await req('/api/session',{},B);
r=await req(`/api/attachments/${attAId}`,{},B);
ok('B CANNOT read A attachment (404)',r.status===404,'got '+r.status);
r=await req(`/api/conversations/${convA}/messages`,{method:'POST',json:{message:'hijack'}},B);
ok('B CANNOT post to A conversation (404)',r.status===404,'got '+r.status);
r=await req(`/api/conversations/${convA}`,{},B);
ok('B CANNOT read A conversation (404)',r.status===404,'got '+r.status);

// --- security rejections ---
async function up(j,buf,name,type,cid=convA){const f=new FormData();f.append('file',new Blob([buf],{type}),name);return req(`/api/conversations/${cid}/attachments`,{method:'POST',body:f},j)}
r=await up(A,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),'evil.svg','image/svg+xml');
ok('SVG rejected',r.status===415,'got '+r.status);
r=await up(A,Buffer.from('<script>alert(1)</script>'),'x.html','image/png');
ok('HTML renamed .html rejected',r.status===415,'got '+r.status);
r=await up(A,png,'photo.png','image/png', 'a'.repeat(24));
r=await up(A,png,'photo.png','application/pdf');
ok('PDF declared type rejected',r.status===415,'got '+r.status);
r=await up(A,Buffer.concat([png,Buffer.alloc(11*1024*1024)]),'big.png','image/png');
ok('oversized image rejected 413',r.status===413,'got '+r.status);
r=await up(A,Buffer.alloc(11*1024*1024),'big.webm','audio/webm');
ok('oversized audio rejected 413',r.status===413,'got '+r.status);
// fake mime: valid png bytes declared as audio
r=await up(A,png,'sneaky.webm','audio/webm');
ok('PNG bytes declared as audio rejected',r.status===415,'got '+r.status);
// traversal in storage key: attempt via attachment id
r=await req('/api/attachments/..%2F..%2F..%2Fetc%2Fpasswd',{},A);
ok('path traversal attachment id rejected',r.status===404||r.status===400,'got '+r.status);
r=await req('/api/attachments/000000000000000000000000',{},A);
ok('unknown attachment 404',r.status===404,'got '+r.status);

// admin
const G=jar();
r=await req('/api/admin/login',{method:'POST',json:{email:'admin@chatadmin.local',password:'Admin@2026#Secure'}},G);
ok('admin login',r.ok,(await r.text()).slice(0,60));
r=await req(`/api/attachments/${attAId}`,{},G);
ok('admin can read attachment',r.status===200,'got '+r.status);
r=await req(`/api/admin/conversations/${convA}/attachments`,{method:'POST',body:(()=>{const f=new FormData();f.append('file',new Blob([png],{type:'image/png'}),'admin-send.png');return f})()},G);
const attAdm=(await r.json()).attachment; ok('admin PNG upload',r.status===201,JSON.stringify(attAdm));
r=await req(`/api/admin/conversations/${convA}/messages`,{method:'POST',json:{attachmentId:attAdm.id,clientId:'a1'}},G);
ok('admin media message created',r.status===201,(await r.text()).slice(0,120));

// audio (webm magic + minimal EBML header) as MediaRecorder would produce
const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x1f]),Buffer.alloc(2000,7)]);
{const f=new FormData();f.append('file',new Blob([webm],{type:'audio/webm'}),'voice.webm');f.append('durationMs','8000');r=await req(`/api/conversations/${convA}/attachments`,{method:'POST',body:f},A)}
const attAud=await r.json(); ok('customer audio upload (webm/opus)',r.status===201,JSON.stringify(attAud.attachment||attAud).slice(0,150));
if(attAud.attachment){
  r=await req(`/api/conversations/${convA}/messages`,{method:'POST',json:{attachmentId:attAud.attachment.id,clientId:'v1'}},A);
  ok('customer voice message created',r.status===201,(await r.text()).slice(0,80));
}

// customer sees admin media + persistence
r=await req(`/api/conversations/${convA}/messages?limit=50`,{},A);
const msgs=(await r.json()).messages;
ok('A sees admin media message',msgs.some(m=>m.type==='image'&&m.sender_type==='admin'));
ok('A sees own image message',msgs.some(m=>m.type==='image'&&m.sender_type==='customer'));
ok('A sees voice message with duration',msgs.some(m=>m.type==='audio'&&m.attachment?.duration_ms===8000));
ok('messages carry no storageKey leak',!JSON.stringify(msgs).includes('storageKey'));
ok('text message still works',msgs.some(m=>m.type==='text'&&m.message==='Hello there'));

// idempotency: same clientId must not duplicate
const before=msgs.length;
await req(`/api/conversations/${convA}/messages`,{method:'POST',json:{message:'dup',clientId:'c1'}},A);
r=await req(`/api/conversations/${convA}/messages?limit=50`,{},A);
const after=(await r.json()).messages.length;
ok('idempotent retry creates no duplicate',after===before,`${before} -> ${after}`);

// unauthorized: no cookie at all
r=await fetch(`${BASE}/api/attachments/${attAId}`);
ok('no session cannot read attachment',r.status===404,'got '+r.status);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
