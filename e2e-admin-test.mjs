import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE='http://localhost:4100';
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
fs.writeFileSync('/tmp/apic.png',PNG);

// customer conversation created by the previous run
const cctx=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const cpage=await (await cctx.newContext({viewport:{width:390,height:844},permissions:['microphone']})).newPage();
await cpage.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
await cpage.fill('textarea','Admin please check my screenshot and voice note');
await cpage.click('button:has-text("Send message")');
await cpage.waitForSelector('textarea#chat-composer',{timeout:20000});
await cpage.setInputFiles('input[type=file]','/tmp/apic.png');
await cpage.waitForTimeout(500);
await cpage.click('button[aria-label="Send image"]');
await cpage.waitForTimeout(2500);
await cpage.click('button[aria-label="Record a voice message"]');
await cpage.waitForTimeout(2500);
await cpage.click('button[aria-label="Stop recording"]');
await cpage.waitForTimeout(800);
await cpage.click('button[aria-label="Send voice message"]');
await cpage.waitForTimeout(3500);

// ---------- ADMIN ----------
const actx=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const apage=await (await actx.newContext({viewport:{width:1280,height:900},permissions:['microphone']})).newPage();
await apage.goto(`${BASE}/admin/login`,{waitUntil:'networkidle'});
await apage.fill('input[type=email]','admin@chatadmin.local');
await apage.fill('input[type=password]','Admin@2026#Secure');
await apage.click('button[type=submit]');
await apage.waitForURL('**/admin*',{timeout:20000});
await apage.waitForTimeout(2000);
ok('ADMIN: login succeeds', apage.url().includes('/admin'));

// open the most recent conversation (first row link in the inbox list)
await apage.locator('a[href^="/admin/conversations/"]').first().click();
await apage.waitForSelector('textarea#chat-composer',{timeout:20000});
await apage.waitForTimeout(2500);
ok('ADMIN: opened customer conversation', await apage.locator('textarea#chat-composer').isVisible());

const adminImgs=await apage.locator('button[aria-label^="View image"]').count();
ok('ADMIN: can view customer image', adminImgs>0, 'count '+adminImgs);
const adminAudio=await apage.locator('button[aria-label^="Play voice message"]').count();
ok('ADMIN: can play customer voice', adminAudio>0, 'count '+adminAudio);
await apage.locator('button[aria-label^="Play voice message"]').first().click();
// Poll: playback start is asynchronous (fetch + 'playing' event).
let adminPlaying = 0;
for (let i = 0; i < 40 && adminPlaying === 0; i++) {
  adminPlaying = await apage.locator('button[aria-label^="Pause voice message"]').count();
  if (adminPlaying === 0) await apage.waitForTimeout(150);
}
ok('ADMIN: customer voice actually plays', adminPlaying>0);

// admin sends image
await apage.setInputFiles('input[type=file]','/tmp/apic.png');
await apage.waitForTimeout(500);
ok('ADMIN: image preview appears', await apage.locator('button[aria-label="Send image"]').isVisible());
await apage.click('button[aria-label="Send image"]');
await apage.waitForTimeout(3000);
const adminOwnImgs=await apage.locator('button[aria-label^="View image"]').count();
ok('ADMIN: admin image bubble created', adminOwnImgs>adminImgs, `${adminImgs} -> ${adminOwnImgs}`);

// admin records voice
await apage.click('button[aria-label="Record a voice message"]');
await apage.waitForTimeout(1200);
ok('ADMIN: recording UI appears', (await apage.locator('text=Recording').count())>0);
await apage.waitForTimeout(2000);
await apage.click('button[aria-label="Stop recording"]');
await apage.waitForTimeout(800);
await apage.click('button[aria-label="Send voice message"]');
await apage.waitForTimeout(3500);
const adminAudio2=await apage.locator('button[aria-label^="Play voice message"]').count();
ok('ADMIN: admin voice bubble created', adminAudio2>adminAudio, `${adminAudio} -> ${adminAudio2}`);

// admin refresh persistence
await apage.reload({waitUntil:'networkidle'});
await apage.waitForTimeout(3000);
ok('ADMIN: media persists after refresh', (await apage.locator('button[aria-label^="View image"]').count())>0);

// ---------- CUSTOMER RECEIVES VIA POLLING ----------
await cpage.reload({waitUntil:'networkidle'});
// Poll interval is 3s; wait two full cycles to rule out a timing race.
await cpage.waitForTimeout(8000);
const custImgs=await cpage.locator('button[aria-label^="View image"]').count();
const custAudio=await cpage.locator('button[aria-label^="Play voice message"]').count();
ok('CUSTOMER receives admin image via polling', custImgs>=2, 'imgs '+custImgs);
ok('CUSTOMER receives admin voice via polling', custAudio>=2, 'audio '+custAudio);

// ---------- UNAUTH ACCESS ----------
const anon=await (await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})).newContext();
const anonPage=await anon.newPage();
const st=await anonPage.goto(`${BASE}/api/attachments/000000000000000000000000`);
ok('UNAUTH attachment access blocked', st.status()>=400, 'status '+st.status());
// admin route without session
const st2=await anonPage.goto(`${BASE}/api/admin/conversations`);
ok('ADMIN route blocked without session', st2.status()>=400, 'status '+st2.status());
// logout
await apage.goto(`${BASE}/admin`,{waitUntil:'networkidle'});
await apage.waitForTimeout(1500);
const logout=apage.locator('button:has-text("Logout")');
if(await logout.count()>0){await logout.first().click();await apage.waitForTimeout(2000);}
ok('ADMIN: logout returns to login', apage.url().includes('/admin/login'), apage.url());

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await cctx.close();await actx.close();await anon.close();
process.exit(fail?1:0);
