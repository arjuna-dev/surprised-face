import path from 'node:path';

type AppProfileRuntime = {
  isPackaged: boolean;
  setName(name: string): void;
  getPath(name: 'appData'): string;
  setPath(name: 'userData', value: string): void;
};

export function configureAppProfile(runtime: AppProfileRuntime, developmentOverride = ''): void {
  runtime.setName('surprised-face');
  runtime.setPath('userData', resolveAppDataPath(runtime.getPath('appData'), runtime.isPackaged, developmentOverride));
}

export function resolveAppDataPath(appDataPath: string, packaged: boolean, developmentOverride = ''): string {
  if (!packaged && developmentOverride) return developmentOverride;
  return path.join(appDataPath, 'surprised-face');
}
