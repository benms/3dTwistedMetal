/**
 * Call `step` at a steady rate using an accumulator, so timer drift and late wake-ups
 * never change the simulation rate. Catch-up is bounded after a long stall.
 */
export function startLoop(step: () => void, stepMs = 1000 / 60, maxSteps = 6): () => void {
  let last = performance.now();
  let accumulator = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    accumulator += now - last;
    last = now;
    let steps = 0;
    while (accumulator >= stepMs && steps < maxSteps) {
      step();
      accumulator -= stepMs;
      steps++;
    }
    if (steps === maxSteps) accumulator = Math.min(accumulator, stepMs);
  }, 4);
  return () => clearInterval(timer);
}
