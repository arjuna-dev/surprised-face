export function isSafeAppNavigation(currentValue: string, nextValue: string): boolean {
  try {
    const current = new URL(currentValue);
    const next = new URL(nextValue);
    return (
      current.protocol === next.protocol &&
      current.host === next.host &&
      current.pathname === next.pathname &&
      current.search === next.search
    );
  } catch {
    return false;
  }
}
