import gathering from '../assets/hordes/gathering.webp';
import engineering from '../assets/hordes/engineering.webp';
import space from '../assets/hordes/space.webp';
import builders from '../assets/hordes/builders.webp';
import explorers from '../assets/hordes/explorers.webp';
import assembly from '../assets/hordes/assembly.webp';
import { hordeCoverKeys, type HordeProject } from './hordes';
export const hordeCovers: Record<string, string> = {
  gathering,
  engineering,
  space,
  builders,
  explorers,
  assembly,
};
export function defaultHordeCover(id: string): string {
  const hash = Array.from(id).reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0);
  return hordeCovers[hordeCoverKeys[hash % hordeCoverKeys.length]!]!;
}
export function projectCover(project: Pick<HordeProject, 'id' | 'coverImage'>): string {
  return (
    hordeCovers[project.coverImage || ''] || project.coverImage || defaultHordeCover(project.id)
  );
}
