import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveSheepExecutable(
  packaged: boolean,
  appPath: string,
  cwd: string,
  resourcesPath: string,
): string {
  const filename = process.platform === 'win32' ? 'sheep.exe' : 'sheep';
  if (packaged) return path.join(resourcesPath, 'bin', filename);
  const candidates = [
    path.join(appPath, 'resources', 'bin', filename),
    path.resolve(appPath, '..', '..', 'resources', 'bin', filename),
    path.join(cwd, 'resources', 'bin', filename),
  ];
  return candidates.find(existsSync) || candidates[candidates.length - 1]!;
}
