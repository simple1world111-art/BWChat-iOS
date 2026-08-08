export async function retryCallMediaPublication(
  publish: () => Promise<unknown>,
  isCurrent: () => boolean,
  wait: (milliseconds: number) => Promise<void> = delay,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!isCurrent()) return false;
    try {
      await publish();
      return isCurrent();
    } catch {
      if (attempt === 3) return false;
      await wait(500);
    }
  }
  return false;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
