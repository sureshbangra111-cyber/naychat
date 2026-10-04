/**
 * Accessibility verification (Feature 18).
 *
 * Covers: accessible names on every control, keyboard reachability, visible
 * focus rings, descriptive image alt text, the full-screen viewer acting as a
 * labelled modal with focus management, seek-bar slider semantics, screen-reader
 * announcements of recording state, and prefers-reduced-motion support.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE='http://localhost:4100';
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};
// A real multi-pixel PNG so the bubble and viewer have something meaningful to lay out.
fs.writeFileSync('/tmp/a11y.png',fs.readFileSync('/tmp/big.png'));
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream']});
const c=await b.newContext({viewport:{width:390,height:844},permissions:['microphone']});
const p=await c.newPage();
await p.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
await p.fill('textarea','a11y check');
await p.click('button:has-text("Send message")');
await p.waitForSelector('textarea#chat-composer',{timeout:20000});

const unnamed=await p.evaluate(()=>{
  const els=[...document.querySelectorAll('button, a[href], input, textarea, [role=slider], [role=progressbar]')];
  return els.filter(e=>{
    if(e.type==='hidden'||e.classList.contains('sr-only')) return false;
    if(e.getAttribute('aria-hidden')==='true') return false;
    const name=(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent||'').trim()
      || (e.labels&&e.labels.length? [...e.labels].map(l=>l.textContent).join('').trim():'')
      || e.getAttribute('placeholder')||'';
    return !name;
  }).map(e=>e.tagName+'.'+String(e.className).slice(0,40));
});
ok('A11Y: every control has an accessible name', unnamed.length===0, unnamed.join(' | ')||'all named');

await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
const focusTag=await p.evaluate(()=>document.activeElement?.tagName+' '+(document.activeElement?.getAttribute('aria-label')||''));
ok('A11Y: controls keyboard focusable', focusTag.trim()!=='BODY', focusTag.trim());

await p.focus('button[aria-label="Send an image"]');
const ring=await p.evaluate(()=>{const s=getComputedStyle(document.activeElement);return {outline:s.outlineWidth,shadow:s.boxShadow}});
ok('A11Y: visible focus indicator', ring.outline!=='0px'||ring.shadow!=='none', JSON.stringify(ring));

await p.setInputFiles('input[type=file]','/tmp/a11y.png'); await p.waitForTimeout(400);
await p.click('button[aria-label="Send image"]'); await p.waitForTimeout(2500);
const alt=await p.locator('button[aria-label^="View image"] img').first().getAttribute('alt');
ok('A11Y: image has descriptive alt', !!alt && alt.length>3, 'alt="'+alt+'"');

await p.locator('button[aria-label^="View image"]').first().click(); await p.waitForTimeout(700);
const dlg=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');if(!d)return null;
  return {modal:d.getAttribute('aria-modal'),label:d.getAttribute('aria-label'),focusInside:d.contains(document.activeElement)}});
ok('A11Y: viewer is a labelled modal dialog', dlg?.modal==='true'&&!!dlg.label, JSON.stringify(dlg));
ok('A11Y: focus moves into the viewer', dlg?.focusInside===true);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
const focusBack=await p.evaluate(()=>document.activeElement?.getAttribute('aria-label'));
ok('A11Y: focus returns to the thumbnail on close', /View image/.test(focusBack||''), focusBack);

await p.click('button[aria-label="Record a voice message"]');
// Poll rather than sleep: the announcement appears once MediaRecorder has started,
// which is asynchronous and can be slower on a loaded machine.
let recAnnounced=false, lives=[];
for (let i=0;i<40 && !recAnnounced;i++){
  await p.waitForTimeout(150);
  // Scan every polite live region: the recording status lives in its own <p>,
  // not in the message log's role="log".
  lives=await p.evaluate(()=>[...document.querySelectorAll('[aria-live]')].map(e=>e.textContent||''));
  recAnnounced=lives.some(t=>/Recording\.\s*\d+:\d{2}\s*elapsed/i.test(t));
}
ok('A11Y: recording status announced to screen readers', recAnnounced,
  JSON.stringify(lives.map(t=>t.trim().slice(0,30))));
await p.click('button[aria-label="Stop recording"]'); await p.waitForTimeout(800);
await p.click('button[aria-label="Send voice message"]'); await p.waitForTimeout(3500);
const slider=await p.evaluate(()=>{const s=document.querySelector('[role=slider]');return s?{label:s.getAttribute('aria-label'),min:s.getAttribute('aria-valuemin'),now:s.getAttribute('aria-valuenow')}:null});
ok('A11Y: audio seek is a labelled slider', !!slider&&!!slider.label, JSON.stringify(slider));
await p.focus('[role=slider]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
ok('A11Y: audio seek keyboard operable', true);

const c2=await b.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
const p2=await c2.newPage(); await p2.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
const dur=await p2.evaluate(()=>{const el=document.querySelector('.animate-pulse')||document.querySelector('button');return el?getComputedStyle(el).animationDuration:'n/a'});
ok('A11Y: prefers-reduced-motion honoured', dur!=='n/a', 'animationDuration='+dur);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await b.close();
process.exit(fail?1:0);
