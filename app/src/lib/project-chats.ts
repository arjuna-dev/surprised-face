type ProjectPath = { path?: unknown };

function normalized(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '') || '/';
}

export function projectPathForConversation(
  conversationPath: string | undefined,
  projects: ProjectPath[],
): string {
  if (!conversationPath) return '';
  const location = normalized(conversationPath);
  let match = '';
  for (const project of projects) {
    if (typeof project.path !== 'string' || !project.path) continue;
    const projectPath = normalized(project.path);
    if ((location === projectPath || location.startsWith(`${projectPath}/`)) && projectPath.length > match.length)
      match = projectPath;
  }
  return match;
}
