/**
 * Creates a promise that resolves after the specified delay
 * @param {number} [ms=0] - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */

// I dont use right know but I will need in a future.
export function delay(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}