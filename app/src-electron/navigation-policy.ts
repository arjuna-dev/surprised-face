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

export async function openExternalWebLink(
  value: string,
  openExternal: (url: string) => Promise<unknown>,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  await openExternal(url.href);
  return true;
}

export function createExternalWindowHandler(
  openExternal: (url: string) => Promise<unknown>,
  onError: (error: unknown) => void,
): (details: { url: string }) => { action: 'deny' } {
  return ({ url }) => {
    void openExternalWebLink(url, openExternal).catch(onError);
    return { action: 'deny' };
  };
}
