export type CatalogConversation = {
  id: string;
  title: string;
  harness: string;
  path?: string;
  agent?: string;
  agentId?: string;
};

export type CatalogFilters = {
  query: string;
  harness: string;
  agent: string;
  projectPath: string;
};

/** A shared room already represents this native session, so the sidebar keeps one row. */
export function withoutSharedSessions<T extends { id: string; harness: string }>(
  rows: T[],
  linkedKeys: Iterable<string>,
): T[] {
  const linked = linkedKeys instanceof Set ? linkedKeys : new Set(linkedKeys);
  return rows.filter((row) => !linked.has(`${row.harness}:${row.id}`));
}

export function filterLocalConversations<T extends CatalogConversation>(
  rows: T[],
  filters: CatalogFilters,
): T[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((conversation) => {
    const { projectPath, harness, agent } = filters;
    const location = typeof conversation.path === 'string' ? conversation.path : '';
    return (
      (!projectPath ||
        location === projectPath ||
        location.startsWith(`${projectPath}/`)) &&
      (!harness || conversation.harness === harness) &&
      (!agent || conversation.agent === agent || conversation.agentId === agent) &&
      (!query ||
        `${conversation.title} ${location} ${conversation.harness} ${conversation.agent || ''}`
          .toLowerCase()
          .includes(query))
    );
  });
}
