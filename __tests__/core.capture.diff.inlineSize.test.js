// A context-dependent inline width (`width: 50%`, `auto`) is normalized into the clone's
// inline style as px, and a softened key holds no width to compare. When a sibling leaves the
// flow and the box changes size, a differential frame has to notice through the size its
// snapshot froze. The tree is truth fuzz seed 190 as it failed: one child of the wrapping
// row goes `position: absolute`.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { __diffStats } from '../src/core/diff.js'

let host
afterEach(() => host?.remove())

const TREE = '<div style="width: 300px; display: flex; flex-wrap: wrap; font: 14px / 18px Arial, sans-serif; background: rgb(255, 255, 255); color: rgb(0, 0, 0);"><span style="padding: 0px; float: none; width: 120px; background-color: rgb(102, 102, 255);">lorem ipsum dolor sit amet consectetur adipiscing elit sed do<div style="margin-top: 20px; margin-bottom: -6px; padding: 0px; border: 2px solid rgb(51, 51, 51); display: inline-block; float: left; width: 120px; position: absolute;"></div><ul style="position: static; width: 50%; height: 30px; background-color: rgb(102, 238, 238);"></ul></span><section style="margin-top: 0px; margin-bottom: -6px; border: 2px solid rgb(51, 51, 51); display: flex; background-color: rgb(255, 102, 102);">x<section style="margin-top: -6px; margin-bottom: 0px; padding: 6px; display: block; width: auto; background-color: rgb(204, 204, 204);">wordy words words words words words words words words words words words words words words words words words words words words 73</section><span style="margin-bottom: 20px; border: 2px solid rgb(51, 51, 51); display: grid; position: static; width: auto; overflow: hidden;">delta epsilon zeta 47<section style="margin-bottom: 8px; margin-left: auto; width: 120px; border: 2px solid rgb(51, 51, 51); display: flow-root; position: absolute;"></section><section style="border: none; position: static; width: 50%;"></section><div style="padding: 0px; display: grid; position: static; float: none; background-color: rgb(238, 102, 238);">delta epsilon zeta</div><ul style="margin-top: 0px; margin-left: auto; width: 120px; padding: 6px; display: inline; position: absolute; top: 10px; left: 0px;">lorem ipsum dolor sit amet consectetur adipiscing elit sed do</ul></span><div style="display: inline; width: auto; background-color: rgb(102, 255, 102); position: absolute;">alpha</div></section><section style="margin-top: 8px; margin-left: auto; width: 120px; display: flex; position: relative; height: auto;">wordy words words words words words words words words words words words words words words words words words words words words</section><section style="margin-top: 8px; padding: 0px; display: inline-block; position: absolute;">wordy words words words words words words words words words words words words words words words words words words words words</section><ul style="margin-bottom: 20px; display: inline; overflow: hidden;">alpha</ul></div>'

describe('differential frame and a size held inline', () => {
  it('equals a full capture after a sibling leaves the flow', async () => {
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;width:400px'
    host.innerHTML = TREE
    document.body.appendChild(host)
    const root = host.firstChild
    const moved = root.children[1].children[2]
    expect(moved.style.position).toBe('absolute')
    moved.style.position = ''
    const O = { scale: 1, dpr: 1, embedFonts: false }
    for (let i = 0; i < 3; i++) await snapdom(root, O)
    moved.style.position = 'absolute'
    const served = __diffStats.served
    const frame = await (await snapdom(root, O)).toCanvas()
    expect(__diffStats.served).toBe(served + 1)
    const full = await (await snapdom(root, { ...O, burst: false })).toCanvas()
    expect([frame.width, frame.height]).toEqual([full.width, full.height])
    const a = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
    const b = full.getContext('2d').getImageData(0, 0, full.width, full.height).data
    let differing = 0
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) differing++
    expect(differing).toBe(0)
  })
})
