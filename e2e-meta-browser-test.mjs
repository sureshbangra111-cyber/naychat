/**
 * Meta Pixel — real browser verification.
 *
 * Meta's CDN cannot be reached from this environment, so the official
 * `connect.facebook.net` script request is intercepted and served locally. That
 * is the ONLY substitution: everything else is the production code path —
 * runtime config fetch, admin-route exclusion, the real `fbq` queue, real event
 * dispatch and real deduplication.
 *
 * The assertions are made against the actual `fbq` calls the app makes.
 */
import { chromium } from 'playwright';
const BASE='http://localhost:4100';
const PIXEL='123456789012345';
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};

async function setPixel(pixelId, enabled){
  const c=await (await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']})).newContext();
  const p=await c.newPage();
  await p.goto(`${BASE}/admin/login`,{waitUntil:'networkidle'});
  await p.fill('input[type=email]','admin@chatadmin.local');
  await p.fill('input[type=password]','Admin@2026#Secure');
  await p.click('button[type=submit]');
  await p.waitForURL('**/admin*',{timeout:20000});
  await p.goto(`${BASE}/admin/settings`,{waitUntil:'networkidle'});
  await p.waitForSelector('input[name="meta-pixel-id"]');
  const cb=p.locator('#meta-tracking-enabled');
  // Order matters: the enable toggle is intentionally disabled while the field is
  // empty, so turning tracking OFF must happen BEFORE clearing the ID.
  if(!enabled && await cb.isEnabled() && await cb.isChecked()){
    await cb.setChecked(false);
    await p.click('button[type=submit]');
    await p.waitForTimeout(1400);
  }
  await p.fill('input[name="meta-pixel-id"]', pixelId);
  if(enabled && !(await cb.isChecked())) await cb.setChecked(true);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1400);
  const saved=await p.locator('text=Saved').count();
  const val=await p.inputValue('input[name="meta-pixel-id"]');
  await p.context().browser().close();
  return {saved:saved>0, val};
}

/** Intercepts Meta's CDN with a local stub and records every fbq call. */
async function newTrackedPage(browser, viewport={width:390,height:844}){
  const ctx=await browser.newContext({viewport});
  let pixelRequested=false;
  await ctx.route('https://connect.facebook.net/**', async route=>{
    pixelRequested=true;
    await route.fulfill({status:200,contentType:'application/javascript',
      body:'/* local stub of Meta fbevents.js */ window.__metaScriptLoaded=true;'});
  });
  const page=await ctx.newPage();
  // Record every call the app makes to the real fbq queue. We wrap the function
  // on each assignment, which is how the app installs its queue stub.
  await page.addInitScript(()=>{
    window.__fbqCalls=[];
    let current;
    Object.defineProperty(window,'fbq',{
      configurable:true,
      get(){ return current; },
      set(v){
        if(typeof v!=='function'){ current=v; return; }
        const wrapped=(...args)=>{ window.__fbqCalls.push(args); return v(...args); };
        // Preserve Meta's own queue properties so the stub keeps working.
        wrapped.q=v.q; wrapped.callMethod=v.callMethod; wrapped.version=v.version; wrapped.loaded=v.loaded;
        current=wrapped;
      },
    });
  });
  return {ctx,page,isRequested:()=>pixelRequested};
}

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});

// ================= Pixel disabled =================
await setPixel('', false);
{
  const {page,isRequested}=await newTrackedPage(browser);
  await page.goto(`${BASE}/chat?utm_source=facebook&utm_campaign=summer`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  ok('P1. no Meta script when disabled', isRequested()===false);
  ok('P2. no fbq global when disabled', await page.evaluate(()=>!window.fbq));
  // chat still fully works
  const composerVisible=await page.locator('textarea').first().isVisible();
  ok('P3. chat works normally with tracking disabled', composerVisible);
  await page.context().close();
}

// ================= Pixel enabled =================
const save=await setPixel(PIXEL, true);
ok('P4. admin saved pixel (Saved indicator shown)', save.saved);
ok('P5. value persisted in the field', save.val===PIXEL, 'val='+save.val);

// customer page
{
  const {page,isRequested}=await newTrackedPage(browser);
  await page.goto(`${BASE}/chat?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer&utm_content=ad1`,{waitUntil:'networkidle'});
  await page.waitForTimeout(3000);
  ok('P6. Meta script loads on customer page when enabled', isRequested()===true);
  const hasScript=await page.evaluate(()=>!!document.getElementById('meta-pixel-fbevents'));
  ok('P7. official loader element injected', hasScript);
  const src=await page.evaluate(()=>document.getElementById('meta-pixel-fbevents')?.getAttribute('src')??'');
  ok('P8. loader src uses the runtime Pixel ID', src.includes(PIXEL) && src.startsWith('https://connect.facebook.net/en_US/fbevents.js'), src);
  const cfg=await page.evaluate(async()=>(await (await fetch('/api/public/config')).json()));
  ok('P9. public config returned only safe fields', cfg.meta_pixel_id===PIXEL && !('mongodb_uri' in cfg) && !('session_secret' in cfg));
  // events
  const calls=await page.evaluate(()=>window.__fbqCalls);
  const names=calls.map(c=>c[1]).filter(n=>typeof n==='string');
  ok('P10. PageView fired', names.includes('PageView'), JSON.stringify(names));
  ok('P11. ViewContent fired on entering chat', names.includes('ViewContent'), JSON.stringify(names));
  const init=calls.find(c=>c[0]==='init');
  ok('P12. fbq init called with the Pixel ID', init && init[1]===PIXEL);

  // StartChat + Contact on conversation start
  await page.fill('textarea','Hello, I saw your Facebook ad');
  await page.click('button:has-text("Send message")');
  await page.waitForSelector('textarea#chat-composer',{timeout:20000});
  await page.waitForTimeout(2500);
  const calls2=await page.evaluate(()=>window.__fbqCalls);
  const names2=calls2.map(c=>c[1]).filter(n=>typeof n==='string');
  ok('P13. StartChat fired', names2.includes('StartChat'), JSON.stringify(names2));
  ok('P14. Contact fired', names2.includes('Contact'), JSON.stringify(names2));
  ok('P15. Lead NOT fired without contact details', !names2.includes('Lead'), JSON.stringify(names2));

  // eventID present for CAPI dedup
  const contact=calls2.find(c=>c[1]==='Contact');
  const payload=contact?.[2]??{};
  ok('P16. Contact carries an eventID for dedup', typeof payload.eventID==='string'&&payload.eventID.length>0, JSON.stringify(payload));

  // Lead fires when details are supplied
  const callsBefore=(await page.evaluate(()=>window.__fbqCalls)).length;
  await page.evaluate(()=>{ /* no-op: Lead covered by the details path below */ });
  // reload with details to exercise the Lead path
  await page.context().close();
}

// Lead with details
{
  const {page}=await newTrackedPage(browser);
  await page.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
  await page.fill('textarea','Please call me about the offer');
  const detailsToggle=page.locator('button:has-text("Add my details")');
  if(await detailsToggle.count()>0){ await detailsToggle.click(); await page.waitForTimeout(400);
    const nameField=page.locator('input').filter({hasNot:page.locator('[type=checkbox]')}).first();
    await nameField.fill('Alex Example').catch(()=>{}); }
  await page.click('button:has-text("Send message")');
  await page.waitForSelector('textarea#chat-composer',{timeout:20000});
  await page.waitForTimeout(2500);
  const names=(await page.evaluate(()=>window.__fbqCalls)).map(c=>c[1]).filter(n=>typeof n==='string');
  ok('P17. Lead fired when contact details supplied', names.includes('Lead'), JSON.stringify(names));
  await page.context().close();
}

// ================= ADMIN PAGES EXCLUDED =================
{
  const {page,isRequested}=await newTrackedPage(browser);
  await page.goto(`${BASE}/admin/login`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  ok('P18. Pixel NOT loaded on /admin/login', isRequested()===false);
  ok('P19. no fbq on /admin/login', await page.evaluate(()=>!window.fbq));

  await page.fill('input[type=email]','admin@chatadmin.local');
  await page.fill('input[type=password]','Admin@2026#Secure');
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin*',{timeout:20000});
  await page.waitForTimeout(2500);
  ok('P20. Pixel NOT loaded on admin dashboard', isRequested()===false);

  await page.goto(`${BASE}/admin/settings`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  ok('P21. Pixel NOT loaded on admin settings', isRequested()===false);
  ok('P22. admin settings page shows the Meta section', (await page.locator('text=Meta Ads Tracking').count())>0);

  // Test Pixel button
  const testBtn=page.locator('button:has-text("Test Pixel")');
  ok('P23. Test Pixel button present', await testBtn.count()>0);
  await testBtn.click();
  await page.waitForTimeout(2000);
  const txt=await page.locator('[role=status]').allInnerTexts();
  ok('P24. Test Pixel reports verification', txt.join(' ').includes('Pixel verification'), txt.join(' | ').slice(0,120));

  // admin conversations page
  await page.goto(`${BASE}/admin`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2000);
  ok('P25. Pixel NOT loaded while browsing admin list', isRequested()===false);
  await page.context().close();
}

// ================= DEDUPLICATION =================
{
  const {page}=await newTrackedPage(browser);
  await page.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  const before=await page.evaluate(()=>window.__fbqCalls.filter(c=>c[1]==='PageView').length);
  // Force several rerenders + a re-navigation to the same path
  await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('scroll'));});
  await page.locator('textarea#chat-composer, textarea').first().fill('x').catch(()=>{});
  await page.waitForTimeout(1200);
  const mid=await page.evaluate(()=>window.__fbqCalls.filter(c=>c[1]==='PageView').length);
  ok('P26. rerenders do NOT duplicate PageView', before===mid, `${before} -> ${mid}`);

  // sessionStorage dedupe list must be populated
  const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('meta_pixel_events_v1')||'[]'));
  ok('P27. conversions recorded for dedup', Array.isArray(stored)&&stored.some(k=>k.startsWith('pageview:')), JSON.stringify(stored));
  await page.context().close();
}

// ================= FAILURE HANDLING =================
{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  // Block the Meta CDN entirely -> script fails to load
  await ctx.route('https://connect.facebook.net/**', route=>route.abort());
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
  await page.waitForTimeout(2500);
  ok('P28. chat unaffected when Meta CDN is blocked',
     await page.locator('textarea').first().isVisible());
  ok('P29. no uncaught error from failed Meta script', errors.length===0, errors.join(' | '));
  // and the chat still functions
  await page.fill('textarea','still works with meta down');
  await page.click('button:has-text("Send message")');
  await page.waitForSelector('textarea#chat-composer',{timeout:20000});
  ok('P30. conversation still startable with Meta down',
     await page.locator('textarea#chat-composer').isVisible());
  await ctx.close();
}

await setPixel('', false);
await browser.close();
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
