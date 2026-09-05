import { afterEach, expect, it } from 'vitest'
import { cache } from '../src/core/cache.js'
import { downsampleDataURL } from '../src/modules/compress.js'

afterEach(() => cache.compress.clear())

async function firstPixel(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return [...ctx.getImageData(0, 0, 1, 1).data]
}

// Uncompressed PNG with a fixed metadata chunk at the end. Legitimate PNGs can share
// length and both key fragments while the compressed pixel bytes differ in the middle.
function png(r,g,b) {
  const n=128, bytes=new Uint8Array(n*(n*4+1)); let p=0
  for(let y=0;y<n;y++) {bytes[p++]=0;for(let x=0;x<n;x++){bytes[p++]=r;bytes[p++]=g;bytes[p++]=b;bytes[p++]=255}}
  const enc=new TextEncoder()
  const crc=(v) => {let c=0xffffffff;for(const b of v){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
  const be=(v) => new Uint8Array([v>>>24,v>>>16,v>>>8,v])
  const join=(...arrays) => {const o=new Uint8Array(arrays.reduce((n,a) => n+a.length,0));let p=0;for(const a of arrays){o.set(a,p);p+=a.length}return o}
  const chunk=(t,d) => {const payload=join(enc.encode(t),d);return join(be(d.length),payload,be(crc(payload)))}
  const ihdr=join(be(n),be(n),new Uint8Array([8,6,0,0,0]))
  let a=1,z=0;for(const v of bytes){a=(a+v)%65521;z=(z+a)%65521}
  const blocks=[];for(let off=0;off<bytes.length;off+=65535){const part=bytes.slice(off,off+65535),len=part.length;blocks.push(new Uint8Array([off+len===bytes.length?1:0,len&255,len>>>8,(~len)&255,((~len)>>>8)&255]),part)}
  const packed=join(new Uint8Array([0x78,0x01]),...blocks,be((z<<16)|a))
  const metadata=enc.encode('Comment\0'+ 'a'.repeat(100))
  const data=join(new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('tEXt',metadata),chunk('IDAT',packed),chunk('tEXt',metadata),chunk('IEND',new Uint8Array()))
  let bin='';for(const b of data)bin+=String.fromCharCode(b)
  return 'data:image/png;base64,'+btoa(bin)
}

it('does not substitute pixels when distinct PNGs share the sampled cache key', async () => {
  const red = png(255, 0, 0), blue = png(0, 0, 255)
  expect(red.length).toBe(blue.length)
  expect(red.slice(0, 64)).toBe(blue.slice(0, 64))
  expect(red.slice(-64)).toBe(blue.slice(-64))
  const first = await downsampleDataURL(red, 32, 32)
  const second = await downsampleDataURL(blue, 32, 32)
  expect(first).not.toBe(second)
  expect(await firstPixel(first)).toEqual([255, 0, 0, 255])
  expect(await firstPixel(second)).toEqual([0, 0, 255, 255])
  const again = await downsampleDataURL(red, 32, 32)
  expect(await firstPixel(again)).toEqual([255, 0, 0, 255])
})

it('keeps concurrent colliding jobs independent', async () => {
  const sources = [png(255, 0, 0), png(0, 0, 255)]
  const results = await Promise.all(sources.map(src => downsampleDataURL(src, 32, 32)))
  expect(await firstPixel(results[0])).toEqual([255, 0, 0, 255])
  expect(await firstPixel(results[1])).toEqual([0, 0, 255, 255])
})
