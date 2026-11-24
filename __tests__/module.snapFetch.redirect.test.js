import { describe, it, expect } from 'vitest'
import { commands } from 'vitest/browser'
import { snapFetch } from '../src/modules/snapFetch.js'

// Real requests, no fetch stub: the CORS check on a redirected request is the browser's.
describe('snapFetch across a same-origin redirect', () => {
  it('reads a same-origin URL that redirects to a host answering plain CORS', async () => {
    // What a presigned storage URL answers: Access-Control-Allow-Origin, no Allow-Credentials.
    const target = await commands.serveCrossOriginCss('.presigned{color:red}', { cors: true })
    const result = await snapFetch(`/__redirect?to=${encodeURIComponent(target)}`, { as: 'text' })
    expect([result.ok, result.data]).toEqual([true, '.presigned{color:red}'])
  })

  it('still fails when the redirect target sends no CORS header', async () => {
    const target = await commands.serveCrossOriginCss('.closed{color:red}')
    const result = await snapFetch(`/__redirect?to=${encodeURIComponent(target)}`, { as: 'text', errorTTL: 0 })
    expect([result.ok, result.reason]).toEqual([false, 'network'])
  })
})
