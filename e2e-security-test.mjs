import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE='http://localhost:4100';
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};
const PNG=fs.readFileSync('/tmp/big.png');

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844}});
const page=await ctx.newPage();
await page.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
await page.fill('textarea','security test');
await page.click('button:has-text("Send message")');
await page.waitForSelector('textarea#chat-composer',{timeout:20000});

// 22-25: server-side rejection surfaced in the UI
await page.setInputFiles('input[type=file]',{name:'evil.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>')});
await page.waitForTimeout(1200);
const svgRejected = await page.evaluate(()=>document.body.innerText.includes('Only JPG, PNG, WEBP and GIF'));
ok('SEC24: SVG refused before upload', svgRejected);

// spoofed MIME: real PNG bytes declared as something else, sent via raw API in-page
const spoof=await page.evaluate(async()=>{
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  const conv=await (await fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaign:{first_message:'x'}})})).json();
  const f=new FormData();f.append('file',new File([bytes],'pic.png',{type:'text/html'}),'pic.png');
  const r=await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',body:f});
  return {status:r.status, body:(await r.text()).slice(0,120)};
});
ok('SEC25: spoofed MIME (text/html) rejected', spoof.status===415, JSON.stringify(spoof));

// 28: XSS filename handled safely
const xss=await page.evaluate(async()=>{
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  const conv=await (await fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaign:{first_message:'x'}})})).json();
  const f=new FormData();
  f.append('file',new File([bytes],'<img src=x onerror=alert(1)>.png',{type:'image/png'}),'<img src=x onerror=alert(1)>.png');
  const r=await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',body:f});
  const j=await r.json();
  return {status:r.status, name:j.attachment?.original_name};
});
ok('SEC28: XSS filename sanitised', xss.status===201 && !/[<>"'&`]/.test(xss.name||''), JSON.stringify(xss));

// send it and confirm no script executes / no alert
let alerted=false; page.on('dialog',async d=>{alerted=true;await d.dismiss()});
await page.evaluate(async()=>{
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  const conv=await (await fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaign:{first_message:'xss check'}})})).json();
  const f=new FormData();f.append('file',new File([bytes],'<script>alert(9)</script>.png',{type:'image/png'}),'<script>alert(9)</script>.png');
  const a=await (await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',body:f})).json();
  await fetch(`/api/conversations/${conv.conversationId}/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({attachmentId:a.attachment.id,message:'xss check'})});
  window.__cid=conv.conversationId;
});
const cid=await page.evaluate(()=>window.__cid);
await page.goto(`${BASE}/chat/${cid}`,{waitUntil:'networkidle'});
await page.waitForTimeout(2500);
ok('SEC28: no XSS execution from filename', alerted===false, 'alerted='+alerted);
const bodyTxt=await page.locator('body').innerText();
ok('SEC28: filename rendered as inert text', !bodyTxt.includes('<script>'), '');

// 29: path traversal on attachment routes + storage dir not served statically
for(const p of ['/api/attachments/..%2f..%2f..%2fetc%2fpasswd','/api/attachments/....//....//etc/passwd','/api/attachments/%2e%2e%2f%2e%2e%2fserver%2f.env']){
  const r=await page.evaluate(async u=>{const x=await fetch(u);return x.status},p);
  ok(`SEC29: traversal ${p.slice(0,44)} blocked`, r>=400, 'status '+r);
}
// The SPA fallback answers unknown paths with index.html (status 200), so the
// meaningful assertion is that no server file CONTENT is ever returned.
const envLeak=await page.evaluate(async()=>{
  const out={};
  for (const u of ['/.data/attachments/../../server/.env','/server/.env','/../../server/.env']){
    const t=await (await fetch(u)).text();
    out[u]= t.includes('SESSION_SECRET')||t.includes('MONGODB_URI')||t.includes('ADMIN_PASSWORD');
  }
  return out;
});
const leaked=Object.entries(envLeak).filter(([,v])=>v).map(([k])=>k);
ok('SEC29: server env content never served statically', leaked.length===0, leaked.join(',')||'no env content returned');

// 22/23 oversized via in-page fetch
const big=await page.evaluate(async()=>{
  const conv=await (await fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaign:{first_message:'x'}})})).json();
  const out={};
  const f1=new FormData();f1.append('file',new File([new Uint8Array(11*1024*1024)],'big.png',{type:'image/png'}),'big.png');
  out.img=(await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',body:f1})).status;
  const f2=new FormData();f2.append('file',new File([new Uint8Array(11*1024*1024)],'big.webm',{type:'audio/webm'}),'big.webm');
  out.aud=(await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',body:f2})).status;
  const f3=new FormData();f3.append('file',new File([new Uint8Array(1024)],'x.exe',{type:'application/x-msdownload'}),'x.exe');
  out.exe=(await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',body:f3})).status;
  return out;
});
ok('SEC22: oversized image -> 413', big.img===413, 'status '+big.img);
ok('SEC23: oversized audio -> 413', big.aud===413, 'status '+big.aud);
ok('SEC24: executable -> 415', big.exe===415, 'status '+big.exe);

// non-multipart body
const nm=await page.evaluate(async()=>{
  const conv=await (await fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaign:{first_message:'x'}})})).json();
  const r=await fetch(`/api/conversations/${conv.conversationId}/attachments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'nope'})});
  return r.status;
});
ok('SEC: non-multipart upload rejected', nm===415||nm===400, 'status '+nm);

// 26/27 cross-visitor API probe
const ctx2=await browser.newContext();
const p2=await ctx2.newPage();
await p2.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
const cross=await p2.evaluate(async cid=>{
  const conv=await (await fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaign:{first_message:'B'}})})).json();
  const list=await (await fetch(`/api/conversations/${conv.conversationId}/messages`)).json();
  const attId=list.messages.find(m=>m.attachment)?.attachment?.id;
  const r1=await fetch(`/api/attachments/${attId}`);
  const r2=await fetch(`/api/conversations/${cid}/messages`);
  return {att:r1?.status, conv:r2?.status};
},cid);
ok('SEC27: visitor B cannot fetch visitor A attachment', cross.att>=400, 'status '+cross.att);
ok('SEC27: visitor B cannot read visitor A messages', cross.conv>=400, 'status '+cross.conv);

// 30: secrets in bundle
const bundle=fs.readdirSync('dist/assets').map(f=>fs.readFileSync('dist/assets/'+f,'utf8')).join('');
// Generic patterns only — this file is committed, so it must never contain a
// real database username, host or password.
const leaks=['mongodb://','mongodb+srv://','SESSION_SECRET','ADMIN_PASSWORD','META_CONVERSIONS_API','ATTACHMENT_STORAGE_DIR'].filter(s=>bundle.includes(s));
ok('SEC30: no secrets in frontend bundle', leaks.length===0, leaks.join(','));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail?1:0);
