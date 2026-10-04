/**
 * Meta Ads tracking — API-level verification.
 *
 * Covers runtime configuration, admin-only writes, Pixel ID validation (including
 * injection attempts), public-config safety, UTM/fbclid attribution capture and
 * persistence, admin attribution visibility, and visitor isolation.
 *
 * Uses a structurally valid Pixel ID so the code path under test is the real one.
 * It never contacts Meta and contains no real credentials.
 */
const BASE='http://localhost:4100';
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};
function jar(){return new Map()}
function ck(j,set){if(!set||!j)return;const arr=Array.isArray(set)?set:(typeof set.split==='function'?[set]:[]);
  for(const c of arr)for(const p of String(c).split(',').map(x=>x.split(';')[0].trim()).filter(Boolean)){const i=p.indexOf('=');if(i>0)j.set(p.slice(0,i),p.slice(i+1))}}
async function req(p,o={},j=null){
  // Normalise: accept both '/settings' and '/api/settings'.
  const path=p.startsWith('/api')?p:`/api${p}`;
  const h={...(o.headers||{})};if(j&&j.size)h.cookie=[...j].map(([k,v])=>`${k}=${v}`).join('; ');
  if(o.json!==undefined)h['content-type']='application/json';
  const r=await fetch(BASE+path,{method:o.method||'GET',headers:h,body:o.json!==undefined?JSON.stringify(o.json):undefined});ck(j,r.headers.getSetCookie?.());return r}

// A structurally valid numeric Pixel ID (not a real account, no network calls).
const PIXEL='123456789012345';

const V=jar();
let r=await req('/api/session',{},V);
ok('1. anonymous session created', r.ok);

// ---------- public config safety ----------
r=await req('/api/public/config');
const pub0=await r.json();
ok('2. public config reachable without auth', r.ok);
const pubText=JSON.stringify(pub0);
const forbidden=['MONGODB_URI','SESSION_SECRET','ADMIN_PASSWORD','ACCESS_TOKEN','mongodb://','mongodb+srv://','access_token'];
ok('3. public config has NO secrets', !forbidden.some(k=>pubText.includes(k)), forbidden.filter(k=>pubText.includes(k)).join(',')||'clean');
ok('4. pixel disabled by default', pub0.meta_pixel_id===null && pub0.meta_tracking_enabled===false);

// ---------- customer cannot write settings ----------
r=await req('/admin/settings',{method:'PATCH',json:{metaPixelId:PIXEL,metaTrackingEnabled:true}},V);
ok('5. customer CANNOT modify pixel settings (401)', r.status===401, 'got '+r.status);

// ---------- admin auth ----------
const A=jar();
r=await req('/api/admin/login',{method:'POST',json:{email:'admin@chatadmin.local',password:'Admin@2026#Secure'}},A);
ok('6. admin login', r.ok);

r=await req('/admin/settings',{},A);
const before=await r.json();
ok('7. admin settings readable', r.ok && 'meta_pixel_id' in before);

// ---------- validation ----------
const badIds=[
  ['empty string disables','   ',true],
  ['letters rejected','abc123',false],
  ['HTML/script rejected','<script>alert(1)</script>',false],
  ['quote injection rejected','12345" onload="alert(1)',false],
  ['path traversal rejected','../../etc/passwd',false],
  ['javascript: rejected','javascript:alert(1)',false],
  ['too short rejected','123',false],
  ['non-numeric w/ dash rejected','123-456',false],
];
for(const [label,value,shouldPass] of badIds){
  const res=await req('/admin/settings',{method:'PATCH',json:{metaPixelId:value}},A);
  const body=await res.json();
  if(shouldPass){ ok(`8. validation: ${label}`, res.ok && (body.meta_pixel_id===null||body.meta_pixel_id===undefined), JSON.stringify(body.meta_pixel_id)); }
  else { ok(`8. validation: ${label}`, res.status===400, 'got '+res.status); }
}
// enabling without a pixel must fail
r=await req('/admin/settings',{method:'PATCH',json:{metaPixelId:'',metaTrackingEnabled:true}},A);
ok('8. validation: cannot enable without pixel id', r.status===400, 'got '+r.status);

// ---------- save a valid pixel ----------
r=await req('/admin/settings',{method:'PATCH',json:{metaPixelId:PIXEL,metaTrackingEnabled:true}},A);
const saved=await r.json();
ok('9. valid pixel saved', r.ok && saved.meta_pixel_id===PIXEL && saved.meta_tracking_enabled===true, JSON.stringify(saved.meta_pixel_id));

// ---------- public config now serves it, still no secrets ----------
r=await req('/api/public/config');
const pub1=await r.json();
ok('10. public config serves pixel id', pub1.meta_pixel_id===PIXEL && pub1.meta_tracking_enabled===true, JSON.stringify(pub1));
ok('11. public config still secret-free', !forbidden.some(k=>JSON.stringify(pub1).includes(k)));

// ---------- persistence across a fresh admin read ----------
r=await req('/admin/settings',{},A);
ok('12. pixel persists (re-read)', (await r.json()).meta_pixel_id===PIXEL);

// ---------- admin settings response must never contain the CAPI token ----------
const adminBody=JSON.stringify(await (await req('/admin/settings',{},A)).json());
ok('13. admin settings never expose CAPI token', !/access_token|conversions/i.test(adminBody));

// ---------- UTM + fbclid capture ----------
const UTM='?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&utm_content=ad1&utm_term=runners&fbclid=abc123XYZ789';
const V2=jar();
r=await req('/api/session'+UTM,{},V2);
ok('14. session accepts attribution', r.ok);
r=await req('/api/attribution',{},V2);
const attr=await r.json();
ok('15. UTM captured on visitor', attr.utm_source===undefined && attr.source==='facebook', JSON.stringify(attr));
ok('15. medium/campaign/term/content/fbclid captured',
   attr.medium==='paid_social'&&attr.campaign==='summer_sale'&&attr.term==='runners'&&attr.content==='ad1'&&attr.fbclid==='abc123XYZ789', JSON.stringify(attr));

// first-touch: a second visit WITHOUT params must not wipe it
await req('/api/session',{},V2);
r=await req('/api/attribution',{},V2);
const attr2=await r.json();
ok('16. attribution survives a plain revisit (first-touch)', attr2.source==='facebook'&&attr2.campaign==='summer_sale', JSON.stringify(attr2));
// a second visit WITH different params must NOT overwrite
await req('/api/session?fbclid=DIFFERENT999&utm_source=google',{},V2);
r=await req('/api/attribution',{},V2);
const attr3=await r.json();
ok('17. original click NOT overwritten by a later visit', attr3.source==='facebook'&&attr3.fbclid==='abc123XYZ789', JSON.stringify(attr3));

// ---------- attribution applied to conversation + visible to admin ----------
r=await req('/api/conversations',{method:'POST',json:{campaign:{first_message:'I saw your ad'}}},V2);
const cid=(await r.json()).conversationId;
ok('18. conversation created', !!cid);
r=await req(`/api/conversations/${cid}`,{},V2);
const conv=await r.json();
ok('19. conversation carries UTM attribution', conv.utm_source==='facebook'&&conv.utm_campaign==='summer_sale'&&conv.fbclid==='abc123XYZ789', JSON.stringify({s:conv.utm_source,c:conv.utm_campaign,f:conv.fbclid}));

r=await req(`/api/admin/conversations/${cid}`,{},A);
const sum=await r.json();
const conv2=sum.conversation;
ok('20. admin sees attribution', conv2.utm_source==='facebook'&&conv2.utm_medium==='paid_social'&&conv2.utm_campaign==='summer_sale'&&conv2.utm_term==='runners'&&conv2.utm_content==='ad1'&&conv2.fbclid==='abc123XYZ789',
   JSON.stringify({s:conv2.utm_source,m:conv2.utm_medium,c:conv2.utm_campaign,t:conv2.utm_term,ct:conv2.utm_content,f:conv2.fbclid}));

// ---------- visitor isolation on attribution ----------
const V3=jar(); await req('/api/session',{},V3);
r=await req('/api/attribution',{},V3);
ok('21. visitor B has its own (empty) attribution', (await r.json()).source===null);
r=await req(`/api/conversations/${cid}`,{},V3);
ok('22. visitor B cannot read visitor A conversation', r.status===404, 'got '+r.status);

// ---------- attribution XSS is inert ----------
const XSS='?utm_source=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&utm_campaign=%3Cscript%3Ealert(2)%3C/script%3E';
const V4=jar(); await req('/api/session'+XSS,{},V4);
r=await req('/api/attribution',{},V4);
const attrX=await r.json();
ok('23. attribution stored as inert text (not executed)', typeof attrX.source==='string' && attrX.source.includes('<img'), JSON.stringify(attrX.source));
r=await req('/api/conversations',{method:'POST',json:{campaign:{first_message:'xss attribution'}}},V4);
const xid=(await r.json()).conversationId;
r=await req(`/api/admin/conversations/${xid}`,{},A);
ok('24. admin read of XSS attribution succeeds (stored, rendered as text)',
   (await r.json()).conversation.utm_source.includes('<img'));

// ---------- conversation creation does not break when metaEventId is absent ----------
r=await req('/api/conversations',{method:'POST',json:{campaign:{first_message:'no meta id'}}},V2);
ok('25. conversation works without meta_event_id', r.status===201);

// ---------- restore settings ----------
r=await req('/admin/settings',{method:'PATCH',json:{metaPixelId:'',metaTrackingEnabled:false}},A);
const restored=await r.json();
ok('26. pixel can be cleared at runtime', restored.meta_pixel_id===null && restored.meta_tracking_enabled===false, JSON.stringify(restored.meta_pixel_id));
r=await req('/api/public/config');
const pub2=await r.json();
ok('27. public config reflects disable immediately', pub2.meta_pixel_id===null && pub2.meta_tracking_enabled===false);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
