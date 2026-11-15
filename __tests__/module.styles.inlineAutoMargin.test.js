// Firefox answers 0px for the `auto` margin of a grid container once the
// grid-template-columns of another grid container has been read, until its own tracks are
// read. An inline `margin-left: auto` is resolved before the node's snapshot, so a
// right-aligned grid was captured at the left the first time. The markup is the tree of truth
// fuzz seed 68 as it failed; smaller ones show the quirk with plain reads but not through the
// order the pipeline reads in.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

const TREE = '<div style="width: 300px; border: 1px solid rgb(0, 0, 0); font: 14px / 18px Arial, sans-serif; background: rgb(255, 255, 255); color: rgb(0, 0, 0);"><span style="display: inline; width: 50%; height: auto;">x<div style="margin-bottom: 8px; padding: 6px; display: grid; position: static;">lorem ipsum dolor sit amet consectetur adipiscing elit sed do</div></span><div style="float: left; background-color: rgb(255, 102, 102);">lorem ipsum dolor sit amet consectetur adipiscing elit sed do</div><span style="margin-left: auto; position: static; width: 50%;">wordy words words words words words words words words words words words words words words words words words words words words<section style="padding: 6px; position: relative; float: left; background-color: rgb(102, 255, 102); margin-top: 8px;">x</section><ul style="padding: 0px; display: grid;">x</ul><div style="margin-bottom: 20px; margin-left: auto; width: 120px; display: grid; background-color: rgb(102, 102, 255); margin-top: 8px;">wordy words words words words words words words words words words words words words words words words words words words words</div><ul style="margin-top: -6px; display: flow-root; width: 50%; height: auto; background-color: rgb(204, 204, 204);">delta epsilon zeta</ul></span><div style="margin-top: 8px; display: inline; width: 120px; height: auto; background-color: rgb(102, 238, 238);">delta epsilon zeta</div></div>'

describe('inline auto margin on a grid container', () => {
  it('a right-aligned grid stays at the right on its first capture', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:400px'
    host.innerHTML = TREE
    document.body.appendChild(host)
    const root = host.firstChild
    const right = [...root.querySelectorAll('div')].find((d) => d.style.width === '120px' && d.style.display === 'grid')
    const live = Math.round(right.getBoundingClientRect().left - root.getBoundingClientRect().left)
    expect(live).toBeGreaterThan(100)
    const canvas = await (await snapdom(root, { scale: 1, dpr: 1, embedFonts: false, burst: false })).toCanvas()
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    // The block is the only rgb(102, 102, 255) box of the tree.
    let x0 = -1
    for (let y = 0; y < height && x0 < 0; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i] === 102 && data[i + 1] === 102 && data[i + 2] === 255) { x0 = x; break }
      }
    }
    expect(Math.abs(x0 - live)).toBeLessThanOrEqual(1)
  })
})
