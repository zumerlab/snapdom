// Compare the two real engines, with identical output stages and isolated module caches.
// Terminal 1: SNAPDOM_CANVAS_ENGINE=1 npm run site
// Terminal 2: node scripts/engine-bench.mjs [samples=15] [rounds=2]
// Chrome must be installed. The browser feature is enabled only in this test process.
// No production hooks or source instrumentation. The rendered result URL descriptor
// guards every sample; one untimed raw URL check per run confirms the native bitmap.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cpus, platform, release, totalmem } from 'node:os'
import { createHash } from 'node:crypto'

const samples = Number(process.argv[2] || 15)
const rounds = Number(process.argv[3] || 2)
if (!Number.isInteger(samples) || samples < 3 || !Number.isInteger(rounds) || rounds < 1) {
  throw new Error('Use at least 3 samples and 1 round')
}
const origin = process.env.SITE_URL || 'http://127.0.0.1:8123'
const outDir = resolve(process.env.BENCH_OUTPUT || 'output/engine-bench')
mkdirSync(outDir, { recursive: true })
const warmups = 3
const cases = ['card', 'dashboard', 'table', 'images', 'shadow']
const scenarios = [
  ...cases.map(scene => ({scene, mode: 'recapture'})),
  ...['card', 'dashboard'].map(scene => ({scene, mode: 'memoized'})),
]
const report = {
  date: new Date().toISOString(), origin, samples, rounds, warmups,
  environment: {cpu: cpus()[0].model, platform: platform(), release: release(), memoryGB: totalmem() / 2**30},
  buildSha256: createHash('sha256').update(readFileSync(new URL('../dist/snapdom.mjs', import.meta.url))).digest('hex'),
  method: 'Headed Chrome, CanvasDrawElement enabled; DPR 1, scale 1; each scene/engine/round has a fresh browser context; engine order reverses each round. Resources preloaded and caches warmed. burst:false for recapture; automatic memoization for memoized. Timed snapdom -> toCanvas -> canvas.toDataURL(image/png). Engine guards inspect URL descriptors after timing; one untimed PNG URL check and pixel readback occur after all timed samples. No hooks. First-capture latency recorded separately from warmed samples.',
  runs: [],
}
const fixtureHTML = '<!doctype html><meta charset="utf-8"><title>SnapDOM engine benchmark</title><style>html,body{margin:0;padding:0;background:white;font:14px/1.4 Arial,sans-serif}*{box-sizing:border-box}#root{position:relative;background:#fff;color:#0f1e4d;overflow:hidden}#stamp{position:absolute;right:12px;top:8px;font-size:11px}.metric{background:#edf1fc;border:1px solid #bac6e5;padding:12px;border-radius:8px}.metric::before{content:"";display:block;width:24px;height:4px;background:#2d5bff;margin-bottom:8px}.metric strong{display:block;font-size:23px}.metric span{display:block;color:#55617c}td,th{padding:0 8px;border-bottom:1px solid #dae0ef;text-align:left;white-space:nowrap}tr:nth-child(even){background:#edf1fc}</style><main id="host"></main>'

async function installFixture(page, scene) {
  return page.evaluate(async scene => {
    const root = document.createElement('div')
    root.id = 'root'
    let width, height
    if (scene === 'card') {
      width=480; height=240
      root.style.cssText = 'padding:28px;background:linear-gradient(120deg,#172b62,#2d5bff);color:white;border-radius:16px'
      root.innerHTML = '<h2 style="margin:0 0 12px;font-size:26px">Quarterly report</h2><p>SnapDOM captures the interface as it appears.</p><div style="display:flex;gap:24px;margin-top:24px"><div><strong style="font-size:28px">82,410</strong><br>Requests</div><div><strong style="font-size:28px">99.9%</strong><br>Availability</div></div>'
    } else if (scene === 'dashboard') {
      width=960; height=720
      root.style.padding='24px'
      root.innerHTML='<h2 style="margin:0 0 12px">Operations dashboard</h2><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">'+Array.from({length:25},(_,i)=>`<section class="metric"><strong>${1400+i*173}</strong><span>Service ${i+1}</span><small>Updated just now</small></section>`).join('')+'</div>'
    } else if (scene === 'table') {
      width=800; height=6032
      root.innerHTML='<table style="border-collapse:collapse;table-layout:fixed;width:100%;font-size:12px;line-height:18px"><thead><tr style="height:32px"><th>Account</th><th>Status</th><th>Requests</th><th>Revenue</th></tr></thead><tbody>'+Array.from({length:250},(_,i)=>`<tr style="height:24px"><td>Customer ${i+1}</td><td>Active</td><td>${200+i*17}</td><td>$${310+i*29}</td></tr>`).join('')+'</tbody></table>'
    } else if (scene === 'images') {
      width=960; height=720
      root.style.padding='20px'
      const files = ['newhero.png','mrsnapdom-plugin.png','mrsnapdom-pose.png','mrsnapdom-run.png','mr-snapdom-wave.png','mrsnapdom-greet.png']
      root.innerHTML='<h2 style="margin:0 0 12px">Image gallery</h2><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">'+Array.from({length:12},(_,i)=>`<figure style="margin:0;border:1px solid #c5cee4;padding:8px"><img src="/assets/${files[i%files.length]}" style="display:block;width:100%;height:152px;object-fit:contain"><figcaption>Image ${i+1}</figcaption></figure>`).join('')+'</div>'
    } else if (scene === 'shadow') {
      width=960; height=720
      root.style.cssText='padding:20px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px'
      for(let i=0;i<30;i++) {
        const host=document.createElement('section')
        host.attachShadow({mode:'open'}).innerHTML=`<style>:host{display:block;border:1px solid #bec9e1;padding:10px;background:#f0f4ff;border-radius:8px}strong{font-size:20px;color:#2d5bff}p{margin:6px 0;font:12px Arial}span{font-weight:bold}</style><strong>Component ${i+1}</strong><p>Styles inside an open shadow root.</p><span>${i*17} events</span>`
        root.appendChild(host)
      }
    }
    root.style.width=width+'px'; root.style.height=height+'px'
    const stamp=document.createElement('span'); stamp.id='stamp'; stamp.textContent='Sample 0'; root.appendChild(stamp)
    document.getElementById('host').appendChild(root)
    await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode()))
    await document.fonts.ready
    const {snapdom}=await import('/__dist/snapdom.mjs')
    window.engineBench={snapdom,root,width,height,stamp}
    const ctx=document.createElement('canvas').getContext('2d')
    return {width,height,version:snapdom.version,drawApi:typeof ctx.drawElementImage==='function'?'drawElementImage':typeof ctx.drawElement==='function'?'drawElement':null,lightDOMDescendants:root.querySelectorAll('*').length,shadowRoots:[...root.querySelectorAll('*')].filter(el=>el.shadowRoot).length,userAgent:navigator.userAgent}
  },scene)
}

const browser = await chromium.launch({channel:'chrome',headless:false,args:['--enable-blink-features=CanvasDrawElement']})
report.browser = browser.version()
try {
  for(let round=0;round<rounds;round++) {
    const engines = round%2 ? ['html-in-canvas','svg'] : ['svg','html-in-canvas']
    for(const scenario of scenarios) {
      for(const engine of engines) {
        const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1})
        const page=await context.newPage()
        const warnings=[], errors=[]
        page.on('pageerror',e=>errors.push(e.message))
        page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text()); if(m.type()==='error')errors.push(m.text())})
        await page.route(origin+'/__engine_bench__',r=>r.fulfill({contentType:'text/html',body:fixtureHTML}))
        await page.goto(origin+'/__engine_bench__')
        await page.bringToFront()
        const fixture=await installFixture(page,scenario.scene)
        if(!fixture.drawApi)throw new Error('Native drawing API unavailable; cannot compare engines')
        const result=await page.evaluate(async ({engine,mode,samples,warmups})=>{
          const {snapdom,root,stamp,width,height}=window.engineBench
          const frame=()=>new Promise(r=>requestAnimationFrame(r))
          const options={engine,scale:1,dpr:1,...(mode==='recapture'?{burst:false}:{})}
          const rows=[]
          let previous=null, artifact=null, firstCapture=null
          const sample=async(i,timed)=>{
            if(mode==='recapture')stamp.textContent='Sample '+i
            await frame(); await frame()
            if(document.visibilityState!=='visible')throw new Error('Benchmark tab became hidden')
            const start=performance.now()
            const result=await snapdom(root,options)
            const captured=performance.now()
            const canvas=await result.toCanvas()
            const drawn=performance.now()
            const png=canvas.toDataURL('image/png')
            const encoded=performance.now()
            const row={capture:captured-start,exportCanvas:drawn-captured,encodePNG:encoded-drawn,canvasTotal:drawn-start,pngTotal:encoded-start,reused:result===previous}
            if(canvas.width!==width||canvas.height!==height)throw new Error(`Output size mismatch: ${canvas.width}x${canvas.height} vs ${width}x${height}`)
            const descriptor=Object.getOwnPropertyDescriptor(result,'url')
            const native=result.needs==='render' && typeof descriptor?.get==='function'
            if(native!==(engine==='html-in-canvas'))throw new Error(`${engine} did not use requested engine`)
            row.native=native
            if(mode==='memoized'&&timed&&!row.reused)throw new Error('Expected memoized result was recaptured')
            if(mode==='recapture'&&row.reused)throw new Error('Unexpected memoized result')
            if(i===0)artifact={png}
            if(timed && i===samples-1){
              const raw=result.toRaw()
              if(raw.startsWith('data:image/png')!==native)throw new Error('Engine descriptor / URL mismatch')
              const pixels=canvas.getContext('2d').getImageData(0,0,width,height).data
              let ink=0;for(let p=3;p<pixels.length;p+=4)if(pixels[p])ink++
              if(!ink)throw new Error('Blank output')
              artifact.ink=ink
            }
            previous=result
            return row
          }
          for(let i=-warmups;i<0;i++){
            const row=await sample(i,false)
            if(i===-warmups)firstCapture=row
          }
          for(let i=0;i<samples;i++)rows.push(await sample(i,true))
          return {rows,firstCapture,artifact}
        },{engine,mode:scenario.mode,samples,warmups})
        const id=`${scenario.scene}-${scenario.mode}-${engine}-r${round+1}`
        writeFileSync(resolve(outDir,id+'.png'),Buffer.from(result.artifact.png.split(',')[1],'base64'))
        delete result.artifact.png
        if(round===0 && engine==='svg' && scenario.mode==='recapture') {
          await page.locator('#stamp').evaluate(el=>el.textContent='Sample 0')
          await page.locator('#root').screenshot({path:resolve(outDir,scenario.scene+'-source.png')})
        }
        const run={...scenario,engine,round:round+1,fixture,...result,warnings:[...new Set(warnings)],errors}
        report.runs.push(run)
        writeFileSync(resolve(outDir,'results.json'),JSON.stringify(report,null,2)+'\n')
        const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]
        console.log(`${id}: canvas ${median(result.rows.map(x=>x.canvasTotal)).toFixed(1)} ms; PNG ${median(result.rows.map(x=>x.pngTotal)).toFixed(1)} ms`)
        await context.close()
        if(errors.length)throw new Error(errors.join('\n'))
      }
    }
  }
} finally {
  await browser.close()
}
console.log(`Saved ${report.runs.length} runs to ${outDir}/results.json`)
