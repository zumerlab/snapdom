// Animated demos without a reproducible resting frame cannot be regression baselines.
// Shared by the browser suite and the release preflight so coverage cannot drift.
export const skippedVisualDemos = new Set([
  'demo',
  'd-plugin-webgl-seamless-dom',
  'd-plugin-webgl-time-tunnel',
])

export function assertVisualBaselineMode(required, update) {
  if (required && update) throw new Error('Release validation cannot update visual baselines')
}
