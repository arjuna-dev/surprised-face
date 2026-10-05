import { statSync } from 'node:fs';
import path from 'node:path';
import { projectPathForConversation } from '../src/lib/project-chats';

type LocalProject = Record<string, unknown>;

export function projectsForUi<T extends LocalProject>(projects: T[]): T[] {
  return projects.filter((project) => {
    const location = typeof project.path === 'string' ? project.path.trim() : '';
    if (!location || !path.isAbsolute(location)) return false;
    if (project.ignored === true) return false;
    if (project.discovered !== true) return true;
    const normalized = location.replaceAll('\\', '/');
    if (
      /\/(?:\.git|node_modules)(?:\/|$)/.test(normalized) ||
      /\/Documents\/Codex\/\d{4}-\d{2}-\d{2}(?:\/|-|$)/.test(normalized) ||
      /\/Library\/Application Support\/(?:sheep|declaw)\/(?:support\/runs|ai-agent)(?:\/|$)/.test(
        normalized,
      )
    )
      return false;
    try {
      return statSync(location).isDirectory();
    } catch {
      return false;
    }
  });
}

export function sortProjectsByRecent<T extends LocalProject>(
  projects: T[],
  conversations: { path?: string; updatedAt?: string }[],
): T[] {
  const activity = (project: T): number => {
    const location = typeof project.path === 'string' ? project.path : '';
    const ownDate = [project.lastUsedAt, project.lastActiveAt, project.updatedAt]
      .map((value) => typeof value === 'string' ? Date.parse(value) || 0 : 0);
    const chatDates = conversations
      .filter((conversation) => projectPathForConversation(conversation.path, projects) === location)
      .map((conversation) => conversation.updatedAt ? Date.parse(conversation.updatedAt) || 0 : 0);
    return Math.max(0, ...ownDate, ...chatDates);
  };
  return [...projects].sort((left, right) => activity(right) - activity(left));
}
