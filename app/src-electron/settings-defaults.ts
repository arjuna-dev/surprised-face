export const DEFAULT_ROOM_SERVICE_URL = 'https://surprised-face-rooms.camus-00.workers.dev';

export const AVAILABLE_APP_THEMES = ['cobalt-red', 'mint-charcoal', 'classic'] as const;
export type AppTheme = (typeof AVAILABLE_APP_THEMES)[number];

export function resolveRoomServiceUrl(savedUrl: string | undefined, connected: boolean, override = ''): string {
  return override || (connected && savedUrl ? savedUrl : DEFAULT_ROOM_SERVICE_URL);
}

export function normalizeAppTheme(value: unknown): AppTheme {
  if (value === 'cobalt-red') return 'cobalt-red';
  if (value === 'light' || value === 'classic') return 'classic';
  if (value === 'dark' || value === 'green' || value === 'mint-charcoal') return 'mint-charcoal';
  return 'mint-charcoal';
}
