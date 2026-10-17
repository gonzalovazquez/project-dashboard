import type { ProjectUpdate, Snapshot } from '../../shared/ipc.js';
import type { Project } from '../../shared/types.js';

/** Folds a main-process update into the snapshot the interface renders. Pure, so it can be tested without a window. */
export function applyUpdate(prev: Snapshot | undefined, u: ProjectUpdate): Snapshot | undefined {
  if (u.kind === 'scan-finished') return u.snapshot;
  if (!prev) return prev;
  switch (u.kind) {
    case 'scan-started': return { ...prev, scanning: true, scanError: undefined };
    case 'notion': return { ...prev, notion: u.notion };
    case 'open-review': return prev;
    case 'project': {
      const i = prev.projects.findIndex((p) => p.name === u.project.name);
      const projects = i >= 0 ? prev.projects.map((p, j) => (j === i ? u.project : p)) : [...prev.projects, u.project];
      return { ...prev, projects };
    }
  }
}

export const sortByName = (ps: Project[]) => ps.slice().sort((a, b) => a.name.localeCompare(b.name));
