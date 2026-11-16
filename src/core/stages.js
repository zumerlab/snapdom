/**
 * How far down the pipeline a capture has to go:
 *
 *   element ──▶ [clone] ──▶ [render] ──▶ exports
 *
 * Each plugin declares how far it needs:
 *
 *   { name: 'agent-map', needs: 'clone' }          // annotates the clone, no pixels
 *   { name: 'ascii-export' }                       // default: 'render', the full pipeline
 *
 * The clone is the floor. A stage before it ('dom') was removed: a capture without a clone
 * captures nothing, and the one thing such a plugin needed from core, the exclusion policy,
 * is on the context as `shouldExclude` at any stage.
 *
 *  1. The capture runs to the MAXIMUM the attached plugins declare, 'render' by default, so
 *     a plugin lowers it only when every other plugin agrees.
 *  2. What was never produced is never faked. `url` or `toPng()` on a capture that stopped
 *     early throws, naming the plugins that lowered it. Do not re-capture on demand: the
 *     clone is the freeze, and a later one returns pixels of a different instant.
 *
 * @module stages
 */

/** Ordered, cheapest first. Also the vocabulary for the `needs` declaration. */
export const STAGES = ['clone', 'render']

const RANK = { clone: 0, render: 1 }

/** What a plugin that does not declare anything gets: the whole pipeline, as before. */
export const DEFAULT_STAGE = 'render'

/**
 * Resolve how deep this capture must run.
 * @param {{plugins?: any[]}} context
 * @returns {{stage: 'clone'|'render', loweredBy: string[]}} stage plus, when it is
 *   below 'render', the plugin names that asked for less (for the error message).
 * @throws {Error} on an unknown `needs` value, so a typo does not silently buy the default.
 */
export function resolveStage(context) {
  // context.plugins holds INSTANCES (mergePlugins normalized them); anything else counts as
  // undeclared, so it gets the full pipeline.
  const defs = Array.isArray(context && context.plugins) ? context.plugins : []
  if (!defs.length) return { stage: DEFAULT_STAGE, loweredBy: [] }

  let rank = -1
  const declared = []
  for (const inst of defs) {
    if (!inst || typeof inst !== 'object') continue
    const needs = inst.needs === undefined ? DEFAULT_STAGE : inst.needs
    if (!Object.prototype.hasOwnProperty.call(RANK, needs)) {
      throw new Error(`[SnapDOM] Plugin '${inst.name || '(unnamed)'}' declares needs: ${JSON.stringify(needs)}, expected one of ${STAGES.join(', ')}.`)
    }
    declared.push({ name: inst.name || '(unnamed)', needs })
    rank = Math.max(rank, RANK[needs])
  }
  if (rank < 0) return { stage: DEFAULT_STAGE, loweredBy: [] }

  const stage = STAGES[rank]
  return {
    // Only the plugins that asked for exactly this stage: the error blames them, and naming
    // one that asked for less would be a wrong lead.
    loweredBy: stage === DEFAULT_STAGE ? [] : declared.filter((d) => d.needs === stage).map((d) => d.name),
    stage,
  }
}

/** @returns {boolean} true when `stage` reaches at least `wanted`. */
export function stageReaches(stage, wanted) {
  return RANK[stage] >= RANK[wanted]
}

/**
 * For plugin authors: validate the stage a caller asked this plugin to run at, so every
 * plugin rejects a bad value the same way and with the same words. Re-exported from
 * `@zumer/snapdom/plugins`.
 *
 *   export function myPlugin({ needs } = {}) {
 *     return { name: 'my-plugin', needs: assertNeeds('my-plugin', needs, ['clone', 'render']) }
 *   }
 *
 * @param {string} pluginName for the error message
 * @param {any} value what the caller passed (undefined keeps the plugin's own default)
 * @param {string[]} [supported] stages this plugin can actually honor, deepest last
 * @returns {'clone'|'render'} the resolved stage
 * @throws {Error} on an unknown stage, or one this plugin cannot honor
 */
export function assertNeeds(pluginName, value, supported = STAGES) {
  const fallback = supported[supported.length - 1]
  if (value === undefined || value === null) return fallback
  if (!Object.prototype.hasOwnProperty.call(RANK, value)) {
    throw new Error(`[SnapDOM] ${pluginName}: needs must be one of ${STAGES.join(', ')}, got ${JSON.stringify(value)}.`)
  }
  if (!supported.includes(value)) {
    throw new Error(`[SnapDOM] ${pluginName} cannot run at stage '${value}'; it supports ${supported.join(', ')}.`)
  }
  return value
}

/**
 * The one error every absent artifact throws, so the cause reads the same everywhere.
 * @param {'clone'|'render'} stage stage this capture actually ran to
 * @param {string[]} loweredBy plugin names that declared less than 'render'
 * @param {string} what the artifact the caller reached for (e.g. 'url', 'toPng()')
 * @returns {Error}
 */
export function absentArtifactError(stage, loweredBy, what) {
  const who = loweredBy.length ? loweredBy.map((n) => `'${n}'`).join(', ') : 'the attached plugins'
  return new Error(
    `[SnapDOM] No ${what}: this capture stopped at '${stage}' because ${who} asked for needs: '${stage}'. ` +
    'It is not re-captured, since that would be a different instant. ' +
    'Ask the plugin for needs: \'render\', or capture without it.'
  )
}
