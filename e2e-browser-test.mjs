import { chromium } from 'playwright';
const BASE='http://localhost:4100';
let pass=0,fail=0; const results=[];
const ok=(n,c,e='')=>{c?pass++:fail++;results.push(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`);console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};

// Real 1x1 PNG for the picker
import fs from 'node:fs';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
fs.writeFileSync('/tmp/pic.png',PNG);
const JPEG=Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
fs.writeFileSync('/tmp/pic.jpg',JPEG);

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const ctx=await browser.newContext({viewport:{width:390,height:844},permissions:['microphone'],ignoreHTTPSErrors:true});
const page=await ctx.newPage();
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); page.on('pageerror',e=>errs.push(String(e)));

// ---------- CUSTOMER ----------
await page.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
await page.waitForTimeout(1200);
ok('CUSTOMER: anonymous pre-chat screen (no login)', await page.locator('text=No account or password needed').isVisible());

// start the conversation from the pre-chat screen
await page.fill('textarea','Hi, I need help with my order');
await page.click('form button[type=submit], button:has-text("Send message")');
await page.waitForSelector('textarea#chat-composer',{timeout:20000});
ok('CUSTOMER: composer visible after conversation starts', await page.locator('textarea#chat-composer').isVisible());
await page.waitForTimeout(1200);
ok('CUSTOMER: first text message delivered', (await page.locator('text=Hi, I need help with my order').count())>0);

// --- IMAGE ---
await page.setInputFiles('input[type=file]','/tmp/pic.png');
await page.waitForTimeout(600);
ok('CUSTOMER: image preview panel appears', await page.locator('text=/^Image$/').count()>0 || await page.locator('button[aria-label="Send image"]').isVisible());
const thumbBefore = await page.locator('img[alt*="pic.png"]').count();
ok('CUSTOMER: preview thumbnail rendered', thumbBefore>0);
await page.click('button[aria-label="Send image"]');
await page.waitForTimeout(3000);
const bubbles = await page.locator('button[aria-label^="View image"]').count();
ok('CUSTOMER: image bubble in chat', bubbles>0);
// lightbox
await page.locator('button[aria-label^="View image"]').first().click();
await page.waitForTimeout(800);
ok('CUSTOMER: full-screen viewer opens', await page.locator('[role=dialog] img').isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok('CUSTOMER: viewer closes on Escape', (await page.locator('[role=dialog]').count())===0);

// --- VOICE RECORDING (real MediaRecorder) ---
await page.click('button[aria-label="Record a voice message"]');
await page.waitForTimeout(1200);
const recVisible = await page.locator('text=Recording').count()>0;
ok('CUSTOMER: recording UI appears', recVisible);
const timerTxt = await page.locator('span.tabular-nums').first().textContent().catch(()=>'');
ok('CUSTOMER: elapsed timer counting', /^\d+:\d{2}$/.test((timerTxt||'').trim()), 'timer='+timerTxt);
await page.waitForTimeout(2000);
await page.click('button[aria-label="Stop recording"]');
await page.waitForTimeout(1000);
ok('CUSTOMER: preview/delete/send shown after stop', await page.locator('button[aria-label="Send voice message"]').isVisible() && await page.locator('button[aria-label="Delete recording"]').isVisible());
const audioCtrl = await page.locator('audio').count();
ok('CUSTOMER: audio preview player present', audioCtrl>0);
await page.click('button[aria-label="Send voice message"]');
await page.waitForTimeout(3500);
const playBtns = await page.locator('button[aria-label^="Play voice message"]').count();
ok('CUSTOMER: voice message bubble with play button', playBtns>0);

// playback works (real fetch of the audio)
await page.locator('button[aria-label^="Play voice message"]').first().click();
// Poll instead of sleeping: playback start is asynchronous (the browser fetches
// the file and fires 'playing'), so a fixed wait is flaky on a loaded machine.
let playingNow = 0;
for (let i = 0; i < 40 && playingNow === 0; i++) {
  playingNow = await page.locator('button[aria-label^="Pause voice message"]').count();
  if (playingNow === 0) await page.waitForTimeout(150);
}
ok('CUSTOMER: audio plays in bubble', playingNow>0);

// --- REFRESH PERSISTENCE ---
await page.reload({waitUntil:'networkidle'});
await page.waitForTimeout(2500);
ok('CUSTOMER: image persists after refresh', (await page.locator('button[aria-label^="View image"]').count())>0);
ok('CUSTOMER: audio persists after refresh', (await page.locator('button[aria-label^="Play voice message"]').count())>0);
ok('CUSTOMER: text persists after refresh', (await page.locator('text=Hi, I need help with my order').count())>0);

// actual pixel check that the image really decoded
const dims = await page.locator('button[aria-label^="View image"] img').first().evaluate(el=>({w:el.naturalWidth,h:el.naturalHeight}));
ok('CUSTOMER: image actually decodes in browser', dims.w>0&&dims.h>0, JSON.stringify(dims));

// ---------- VISITOR ISOLATION (second browser context) ----------
const ctx2=await browser.newContext({viewport:{width:375,height:812}});
const p2=await ctx2.newPage();
await p2.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
await p2.fill('textarea','I am a different visitor');
await p2.click('button:has-text("Send message")');
await p2.waitForSelector('textarea#chat-composer',{timeout:20000});
await p2.waitForTimeout(2000);
const imgsB = await p2.locator('button[aria-label^="View image"]').count();
ok('VISITOR B: cannot see visitor A media', imgsB===0, 'found '+imgsB);
// direct API probe from B
const probe = await p2.evaluate(async()=>{const r=await fetch('/api/attachments/000000000000000000000000');return r.status});
ok('VISITOR B: attachment probe blocked', probe>=400, 'status '+probe);

console.log('\nCONSOLE ERRORS:', errs.length? errs.slice(0,5).join(' | '):'none');
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail?1:0);
