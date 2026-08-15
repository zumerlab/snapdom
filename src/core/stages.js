/**
 * How far down the pipeline a capture has to go.
 *
 * A capture is a chain, and each step consumes what the previous one produced:
 *
 *   element ──▶ [clone] ──▶ [render] ──▶ exports
 *
 * Not every consumer needs the whole chain: a plugin that annotates the clone may not want
 * pixels at all. So each plugin declares how far it needs to go:
 *
 *   { name: 'agent-map', needs: 'clone' }          // annotates the clone, no pixels
 *   { name: 'ascii-export' }                       // default: 'render', the full pipeline
 *
 * There used to be a third, shallower stage ('dom') that stopped BEFORE the clone, for
 * plugins that only read the live page. It was removed: a capture that takes no clone does
 * no capturing, so core contributed nothing but option normalization and a hook runner, and
 * a plugin can do that work by calling its own function on the element. The one thing it
 * genuinely needed from core, the compiled exclusion policy, is on the context as
 * `shouldExclude` and is available at any stage. The clone is the floor now.
 *
 * Two rules keep this predictable:
 *
 *  1. The capture runs to the MAXIMUM of what the attached plugins declare, defaulting to
 *     'render'. A plugin can only lower the pipeline when every other plugin agrees, so a
 *     capture with no plugins behaves exactly as it always did.
 *  2. What was never produced is never faked. Touching `url` / `toPng()` on a capture
 *     that stopped early throws, naming the plugins that lowered it. Re-capturing on
 *     demand would return pixels of a DIFFERENT instant, and the caller has no way to
 *     tell — the clone IS the freeze, and it cannot be taken after the fact.
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
 * @throws {Error} on an unknown `needs` value — a typo must not silently buy the default.
 */
export function resolveStage(context) {
  // context.plugins holds INSTANCES (mergePlugins normalized them); anything else is
  // treated as undeclared, which means the full pipeline — the conservative direction.
  const defs = Array.isArray(context && context.plugins) ? context.plugins : []
  if (!defs.length) return { stage: DEFAULT_STAGE, loweredBy: [] }

  let rank = -1
  const declared = []
  for (const inst of defs) {
    if (!inst || typeof inst !== 'object') continue
    const needs = inst.needs === undefined ? DEFAULT_STAGE : inst.needs
    if (!Object.prototype.hasOwnProperty.call(RANK, needs)) {
      throw new Error(`[snapdom] plugin '${inst.name || '(unnamed)'}' declares needs: ${JSON.stringify(needs)}, expected one of ${STAGES.join(', ')}`)
    }
    declared.push({ name: inst.name || '(unnamed)', needs })
    rank = Math.max(rank, RANK[needs])
  }
  if (rank < 0) return { stage: DEFAULT_STAGE, loweredBy: [] }

  const stage = STAGES[rank]
  return {
    // Only the plugins that asked for exactly this stage — they are the ones the error
    // message blames, and naming a plugin that asked for less would be a wrong lead.
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
    throw new Error(`[snapdom] ${pluginName}: needs must be one of ${STAGES.join(', ')}, got ${JSON.stringify(value)}`)
  }
  if (!supported.includes(value)) {
    throw new Error(`[snapdom] ${pluginName} cannot run at stage '${value}': it supports ${supported.join(', ')}`)
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
    `[snapdom] no ${what}: this capture stopped at '${stage}' because ${who} declared needs: '${stage}' (result.needs says so too). ` +
    'It is not re-captured on demand — that would be a different instant. ' +
    'Ask the plugin for needs: \'render\', or capture without it.'
  )
}
