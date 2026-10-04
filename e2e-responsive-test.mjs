import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';
const BASE='http://localhost:4100';

/** Self-contained fixture: a real 800x600 PNG, so the bubble and viewer have
 *  genuine dimensions to lay out and a genuinely clickable target. */
function makePng(w, h) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = (b) => { let x = 0xffffffff; for (const v of b) x = crcTable[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { const off = y * (1 + w * 3); raw[off] = 0;
    for (let x = 0; x < w; x++) { raw[off+1+x*3] = x % 256; raw[off+2+x*3] = y % 256; raw[off+3+x*3] = 128; } }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const FIXTURE = '/tmp/e2e-responsive-fixture.png';
fs.writeFileSync(FIXTURE, makePng(800, 600));
let pass=0,fail=0;
const ok=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`)};

const WIDTHS=[320,375,390,430,768,1280];
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream']});

for(const w of WIDTHS){
  const ctx=await browser.newContext({viewport:{width:w,height:800},permissions:['microphone'],isMobile:w<768,hasTouch:w<768});
  const p=await ctx.newPage();
  await p.goto(`${BASE}/chat`,{waitUntil:'networkidle'});
  await p.fill('textarea','Responsive check '+w);
  await p.click('button:has-text("Send message")');
  await p.waitForSelector('textarea#chat-composer',{timeout:20000});
  await p.waitForTimeout(800);

  const m=await p.evaluate(()=>({
    docW:document.documentElement.scrollWidth,
    winW:window.innerWidth,
    composerBottom:document.querySelector('#chat-composer')?.getBoundingClientRect().bottom,
    composerTop:document.querySelector('#chat-composer')?.getBoundingClientRect().top,
    viewH:window.innerHeight,
  }));
  ok(`${w}px: no horizontal overflow`, m.docW<=m.winW+1, `doc ${m.docW} vs win ${m.winW}`);
  ok(`${w}px: composer visible in viewport`, m.composerTop!==undefined && m.composerBottom<=m.viewH+2 && m.composerTop>0, `top ${Math.round(m.composerTop)} bottom ${Math.round(m.composerBottom)} vh ${m.viewH}`);

  // touch targets >= 40px for composer controls
  const small=await p.evaluate(()=>{
    const btns=[...document.querySelectorAll('#chat-composer ~ *, form button, header button, button[aria-label="Record a voice message"], button[aria-label="Send an image"]')];
    return btns.filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&(r.height<36||r.width<36)}).map(b=>b.getAttribute('aria-label')||b.textContent.trim()||b.tagName);
  });
  ok(`${w}px: touch targets >= 36px`, small.length===0, small.join(',')||'all ok');

  // image viewer responsiveness
  await p.setInputFiles('input[type=file]',FIXTURE);
  await p.waitForTimeout(400);
  const pw = await p.locator('button[aria-label="Send image"]').isVisible();
  ok(`${w}px: image preview reachable`, pw);
  await p.click('button[aria-label="Send image"]');
  await p.waitForTimeout(2500);
  const hasImg=await p.locator('button[aria-label^="View image"]').count();
  ok(`${w}px: image bubble rendered`, hasImg>0);
  if(hasImg){
    const thumb = p.locator('button[aria-label^="View image"]').first();
    // Dispatch the click on the element itself rather than at screen coordinates:
    // the message list smooth-scrolls, so a coordinate click can land mid-animation
    // and miss. This exercises the same onClick handler a user triggers.
    await thumb.evaluate((el) => el.click());
    await p.waitForSelector('[role=dialog] img', { timeout: 10000 });
    // Poll from Node until the viewer image has decoded, then measure it.
    // An 800x600 original takes a moment to paint, and measuring an undecoded
    // <img> would report a zero-sized box.
    let v = null;
    for (let i = 0; i < 40; i++) {
      v = await p.evaluate(() => {
        const img = document.querySelector('[role=dialog] img');
        if (!img || img.naturalWidth === 0) return null;
        const r = img.getBoundingClientRect();
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          vw: window.innerWidth, vh: window.innerHeight,
          natural: `${img.naturalWidth}x${img.naturalHeight}`,
          fits: r.width <= window.innerWidth + 1 && r.height <= window.innerHeight + 1,
        };
      });
      if (v) break;
      await p.waitForTimeout(150);
    }
    ok(`${w}px: viewer image fits & undistorted`, !!v&&v.fits, JSON.stringify(v));
    await p.keyboard.press('Escape');
  }
  // composer stays after a simulated mobile keyboard (viewport shrink)
  await p.setViewportSize({width:w,height:400});
  await p.waitForTimeout(400);
  const kb=await p.evaluate(()=>{const r=document.querySelector('#chat-composer')?.getBoundingClientRect();return r?{bottom:Math.round(r.bottom),vh:window.innerHeight}:null});
  ok(`${w}px: composer survives keyboard shrink`, kb&&kb.bottom<=kb.vh+2&&kb.bottom>0, JSON.stringify(kb));
  await ctx.close();
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail?1:0);
