import assert from 'node:assert';

/**
 * Assert that `run` grows linearly with `count`: Doubling the input doubles a linear run but
 * quadruples a quadratic one. Comparing growth rather than absolute time keeps the test
 * independent of the machine. The best of several runs, alternating sizes, discounts load
 * from parallel tests, and the constant absorbs timer noise where both runs are near-instant.
 * Load that still skews one size gets more attempts, which a quadratic run fails all of.
 *
 * Sizes double up to `count` from far below it, so that a regression fails where it still
 * takes milliseconds, rather than running for minutes at full size.
 * @param {(count: number) => unknown} run - Work on an input of size `count`, awaited
 * @param {number} count - The smaller size of the last step, at which `run` should take milliseconds
 * @param {string} label - What grew, for the failure message
 */
export async function assertLinearGrowth(run, count, label) {
  const time = async (/** @type {number} */ size) => {
    const started = performance.now();
    await run(size);
    return performance.now() - started;
  };

  for (let size = Math.ceil(count / 128); ; size = Math.min(size * 2, count)) {
    let small = Infinity;
    let large = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      small = Infinity;
      large = Infinity;
      for (let i = 0; i < 5; i++) {
        small = Math.min(small, await time(size));
        large = Math.min(large, await time(size * 2));
      }
      if (large <= small * 3 + 50) break;
    }

    assert.ok(
      large <= small * 3 + 50,
      `${label} grew from ${small.toFixed(1)} ms to ${large.toFixed(1)} ms on twice the input (${size} to ${size * 2})`
    );
    if (size === count) return;
  }
}