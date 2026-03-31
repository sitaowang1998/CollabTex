export function createProjectRoomName(projectId: string): string {
  return `project:${projectId}`;
}

export function createWorkspaceRoomName(
  projectId: string,
  documentId: string,
): string {
  return `workspace:${projectId}:${documentId}`;
}

export function createTextWorkspaceRoomName(
  projectId: string,
  documentId: string,
  generation: number,
): string {
  return `workspace:${projectId}:${documentId}:text:${generation}`;
}
