"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SlideElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src?: string;
  [key: string]: unknown;
};

type Slide = {
  id: string;
  title: string;
  background: string;
  transition: string;
  elements: SlideElement[];
  [key: string]: unknown;
};

type Project = {
  id: string;
  name: string;
  updatedAt: number;
  slides: Slide[];
};

type WorkspaceNamespace = {
  id: string;
  name: string;
  updatedAt: number;
  projects: Project[];
};

type StoredProject = Omit<Project, "slides"> & {
  slides: Array<
    Omit<Partial<Slide>, "elements"> &
      Pick<Slide, "id" | "title" | "background"> & {
        elements: Array<Partial<SlideElement> & Pick<SlideElement, "id" | "type" | "x" | "y" | "width" | "height">>;
      }
  >;
};

type StoredNamespace = Partial<Omit<WorkspaceNamespace, "projects">> & {
  projects?: StoredProject[];
};

type StoredWorkspace = {
  namespaces?: StoredNamespace[];
  activeNamespaceId?: string;
};

type RemoteProjectsResponse = {
  configured: boolean;
  projects: StoredProject[] | null;
  workspace?: StoredWorkspace | null;
  updatedAt: number;
};

type ProjectSort = "manual" | "newest" | "oldest";

const storageKey = "reveals-studio-projects-v1";
const namespaceStorageKey = "reveals-studio-namespaces-v1";
const defaultNamespaceId = "default";
const defaultNamespaceName = "Default";
const projectDbName = "reveals-studio-db";
const projectDbStoreName = "kv";

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
};

const getProjectsUpdatedAt = (projects: Project[]) => Math.max(0, ...projects.map((project) => project.updatedAt));
const getNamespacesUpdatedAt = (namespaces: WorkspaceNamespace[]) =>
  Math.max(0, ...namespaces.map((namespace) => Math.max(namespace.updatedAt, getProjectsUpdatedAt(namespace.projects))));

const hasLargeEmbeddedMedia = (projects: Project[]) =>
  projects.some((project) =>
    project.slides.some((slide) =>
      slide.elements.some((element) => typeof element.src === "string" && element.src.startsWith("data:") && element.src.length > 120_000),
    ),
  );

const openProjectDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(projectDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(projectDbStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readValueFromDb = async <T,>(key: string): Promise<T | null> => {
  try {
    const db = await openProjectDb();
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = db.transaction(projectDbStoreName, "readonly");
      const request = transaction.objectStore(projectDbStoreName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    return null;
  }
};

const writeValueToDb = async (key: string, value: unknown) => {
  try {
    const db = await openProjectDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(projectDbStoreName, "readwrite");
      transaction.objectStore(projectDbStoreName).put(value, key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Local storage and the remote API remain available as fallbacks.
  }
};

const readWorkspaceFromDb = () => readValueFromDb<StoredWorkspace>(namespaceStorageKey);
const readLegacyProjectsFromDb = () => readValueFromDb<StoredProject[]>(storageKey);
const writeWorkspaceToDb = (workspace: StoredWorkspace) => writeValueToDb(namespaceStorageKey, workspace);

const readNamespacesFromRemote = async (): Promise<WorkspaceNamespace[] | null> => {
  try {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return null;
    const result = await response.json() as RemoteProjectsResponse;
    if (!result.configured) return null;
    if (result.workspace) return normalizeNamespaces(result.workspace);
    return result.projects ? normalizeNamespaces(result.projects) : null;
  } catch {
    return null;
  }
};

const writeNamespacesToRemote = async (namespaces: WorkspaceNamespace[], activeNamespaceId: string) => {
  try {
    await fetch("/api/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: { namespaces, activeNamespaceId },
        updatedAt: getNamespacesUpdatedAt(namespaces),
      }),
    });
  } catch {
    // Remote persistence is optional for local-only development.
  }
};

const mergeProjectsByFreshness = (localProjects: Project[], remoteProjects: Project[]) => {
  const merged = new Map<string, Project>();
  localProjects.forEach((project) => merged.set(project.id, project));
  remoteProjects.forEach((project) => {
    const localProject = merged.get(project.id);
    if (!localProject || project.updatedAt > localProject.updatedAt) merged.set(project.id, project);
  });
  return Array.from(merged.values());
};

const mergeNamespacesByFreshness = (localNamespaces: WorkspaceNamespace[], remoteNamespaces: WorkspaceNamespace[]) => {
  const merged = new Map<string, WorkspaceNamespace>();
  localNamespaces.forEach((namespace) => merged.set(namespace.id, namespace));
  remoteNamespaces.forEach((namespace) => {
    const localNamespace = merged.get(namespace.id);
    if (!localNamespace) {
      merged.set(namespace.id, namespace);
      return;
    }

    const remoteUpdatedAt = Math.max(namespace.updatedAt, getProjectsUpdatedAt(namespace.projects));
    const localUpdatedAt = Math.max(localNamespace.updatedAt, getProjectsUpdatedAt(localNamespace.projects));
    merged.set(namespace.id, {
      ...localNamespace,
      name: remoteUpdatedAt > localUpdatedAt ? namespace.name : localNamespace.name,
      updatedAt: Math.max(localNamespace.updatedAt, namespace.updatedAt),
      projects: mergeProjectsByFreshness(localNamespace.projects, namespace.projects),
    });
  });
  return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
};

const starterProject = (): Project => ({
  id: makeId(),
  name: "ROS 2 Architecture Pitch",
  updatedAt: Date.now(),
  slides: [
    {
      id: makeId(),
      title: "Main Diagram",
      background: "#f6f1e7",
      transition: "fade",
      elements: [
        {
          id: makeId(),
          type: "text",
          x: 86,
          y: 74,
          width: 690,
          height: 96,
          rotation: 0,
          zIndex: 1,
          reveal: 1,
          animation: "fade-up",
          text: "Dynamic presentation",
          fontSize: 54,
          fontWeight: 900,
          textAlign: "left",
          fill: "#111827",
          stroke: "#111827",
          strokeWidth: 0,
        },
      ],
    },
  ],
});

const makeDefaultNamespace = (projects: Project[], updatedAt = getProjectsUpdatedAt(projects)): WorkspaceNamespace => ({
  id: defaultNamespaceId,
  name: defaultNamespaceName,
  updatedAt,
  projects,
});

const normalizeProjects = (projects: StoredProject[]): Project[] =>
  projects.map((project) => ({
    ...project,
    updatedAt: typeof project.updatedAt === "number" ? project.updatedAt : Date.now(),
    slides: project.slides.map((slide) => ({
      ...slide,
      transition: typeof slide.transition === "string" ? slide.transition : "fade",
      elements: slide.elements as SlideElement[],
    })),
  }));

const normalizeNamespaces = (workspace: StoredWorkspace | StoredNamespace[] | StoredProject[] | null | undefined): WorkspaceNamespace[] => {
  if (!workspace) return [makeDefaultNamespace([starterProject()], Date.now())];
  if (Array.isArray(workspace)) {
    const firstItem = workspace[0] as StoredNamespace | StoredProject | undefined;
    if (firstItem && "projects" in firstItem) {
      const namespaces = (workspace as StoredNamespace[]).map((namespace, index) => {
        const projects = normalizeProjects(namespace.projects ?? []);
        const safeProjects = projects.length > 0 ? projects : [starterProject()];
        return {
          id: typeof namespace.id === "string" && namespace.id ? namespace.id : makeId(),
          name: typeof namespace.name === "string" && namespace.name.trim() ? namespace.name : index === 0 ? defaultNamespaceName : `Namespace ${index + 1}`,
          updatedAt: typeof namespace.updatedAt === "number" ? namespace.updatedAt : getProjectsUpdatedAt(safeProjects),
          projects: safeProjects,
        };
      });
      return namespaces.length > 0 ? namespaces : [makeDefaultNamespace([starterProject()], Date.now())];
    }

    return [makeDefaultNamespace(normalizeProjects(workspace as StoredProject[]))];
  }

  return normalizeNamespaces(workspace.namespaces ?? null);
};

const formatUpdatedAt = (value: number) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value || Date.now());

export default function Dashboard() {
  const [namespaces, setNamespaces] = useState<WorkspaceNamespace[]>([]);
  const [activeNamespaceId, setActiveNamespaceId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [projectSort, setProjectSort] = useState<ProjectSort>("manual");
  const [draggingProjectId, setDraggingProjectId] = useState("");
  const [projectDropTargetId, setProjectDropTargetId] = useState("");
  const [renamingNamespaceId, setRenamingNamespaceId] = useState("");
  const [renamingNamespaceName, setRenamingNamespaceName] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async () => {
      let nextNamespaces = [makeDefaultNamespace([starterProject()], Date.now())];
      let nextActiveNamespaceId = nextNamespaces[0].id;
      try {
        const savedWorkspaceFromDb = await readWorkspaceFromDb();
        const savedWorkspaceFromStorage = savedWorkspaceFromDb ? null : window.localStorage.getItem(namespaceStorageKey);
        const savedLegacyFromDb = savedWorkspaceFromDb || savedWorkspaceFromStorage ? null : await readLegacyProjectsFromDb();
        const savedLegacyFromStorage = savedWorkspaceFromDb || savedWorkspaceFromStorage || savedLegacyFromDb ? null : window.localStorage.getItem(storageKey);
        const savedWorkspace = savedWorkspaceFromDb ?? (savedWorkspaceFromStorage ? JSON.parse(savedWorkspaceFromStorage) as StoredWorkspace : null);
        const savedLegacy = savedLegacyFromDb ?? (savedLegacyFromStorage ? JSON.parse(savedLegacyFromStorage) as StoredProject[] : null);
        if (savedWorkspace) {
          nextNamespaces = normalizeNamespaces(savedWorkspace);
          nextActiveNamespaceId =
            typeof savedWorkspace.activeNamespaceId === "string" && nextNamespaces.some((namespace) => namespace.id === savedWorkspace.activeNamespaceId)
              ? savedWorkspace.activeNamespaceId
              : nextNamespaces[0].id;
        } else if (savedLegacy) {
          nextNamespaces = normalizeNamespaces(savedLegacy);
          nextActiveNamespaceId = nextNamespaces[0].id;
        }
        const remoteNamespaces = await readNamespacesFromRemote();
        if (remoteNamespaces) {
          nextNamespaces = mergeNamespacesByFreshness(nextNamespaces, remoteNamespaces);
          if (!nextNamespaces.some((namespace) => namespace.id === nextActiveNamespaceId)) nextActiveNamespaceId = nextNamespaces[0].id;
        }
      } catch {
        nextNamespaces = [makeDefaultNamespace([starterProject()], Date.now())];
        nextActiveNamespaceId = nextNamespaces[0].id;
      }

      if (cancelled) return;
      setNamespaces(nextNamespaces);
      setActiveNamespaceId(nextActiveNamespaceId);
      setLoaded(true);
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeNamespace = useMemo(
    () => namespaces.find((namespace) => namespace.id === activeNamespaceId) ?? namespaces[0],
    [activeNamespaceId, namespaces],
  );
  const sortedProjects = useMemo(
    () => {
      const projects = [...(activeNamespace?.projects ?? [])];
      if (projectSort === "manual") return projects;
      return projects.sort((first, second) =>
        projectSort === "newest"
          ? second.updatedAt - first.updatedAt
          : first.updatedAt - second.updatedAt,
      );
    },
    [activeNamespace?.projects, projectSort],
  );

  const saveWorkspace = async (nextNamespaces: WorkspaceNamespace[], nextActiveNamespaceId: string) => {
    const workspace = { namespaces: nextNamespaces, activeNamespaceId: nextActiveNamespaceId };
    const writes = [
      writeWorkspaceToDb(workspace),
      writeNamespacesToRemote(nextNamespaces, nextActiveNamespaceId),
    ];
    if (!nextNamespaces.some((namespace) => hasLargeEmbeddedMedia(namespace.projects))) {
      try {
        window.localStorage.setItem(namespaceStorageKey, JSON.stringify(workspace));
      } catch {
        // IndexedDB remains the primary local store for large workspaces.
      }
    }
    await Promise.all(writes);
  };

  const createProject = () => {
    if (!activeNamespace) return;
    const project = starterProject();
    project.name = `New project ${activeNamespace.projects.length + 1}`;
    const nextNamespaces = namespaces.map((namespace) =>
      namespace.id === activeNamespace.id
        ? { ...namespace, updatedAt: Date.now(), projects: [project, ...namespace.projects] }
        : namespace,
    );
    setNamespaces(nextNamespaces);
    void saveWorkspace(nextNamespaces, activeNamespace.id).finally(() => {
      window.location.href = `/canvas?namespace=${encodeURIComponent(activeNamespace.id)}&project=${encodeURIComponent(project.id)}`;
    });
  };

  const createNamespace = () => {
    const project = starterProject();
    const namespace: WorkspaceNamespace = {
      id: makeId(),
      name: `Namespace ${namespaces.length + 1}`,
      updatedAt: project.updatedAt,
      projects: [project],
    };
    const nextNamespaces = [namespace, ...namespaces];
    setNamespaces(nextNamespaces);
    setActiveNamespaceId(namespace.id);
    void saveWorkspace(nextNamespaces, namespace.id);
  };

  const startRenameNamespace = (namespace: WorkspaceNamespace) => {
    setRenamingNamespaceId(namespace.id);
    setRenamingNamespaceName(namespace.name);
  };

  const commitNamespaceRename = () => {
    const namespaceId = renamingNamespaceId;
    const nextName = renamingNamespaceName.trim();
    setRenamingNamespaceId("");
    setRenamingNamespaceName("");
    if (!namespaceId || !nextName) return;

    const target = namespaces.find((namespace) => namespace.id === namespaceId);
    if (!target || target.name === nextName) return;

    const nextNamespaces = namespaces.map((namespace) =>
      namespace.id === namespaceId
        ? { ...namespace, name: nextName, updatedAt: Date.now() }
        : namespace,
    );
    setNamespaces(nextNamespaces);
    void saveWorkspace(nextNamespaces, activeNamespaceId);
  };

  const cancelNamespaceRename = () => {
    setRenamingNamespaceId("");
    setRenamingNamespaceName("");
  };

  const reorderProjects = (draggedProjectId: string, targetProjectId: string) => {
    if (!activeNamespace || draggedProjectId === targetProjectId) return;

    const visibleProjects = [...sortedProjects];
    const draggedIndex = visibleProjects.findIndex((project) => project.id === draggedProjectId);
    const targetIndex = visibleProjects.findIndex((project) => project.id === targetProjectId);
    if (draggedIndex < 0 || targetIndex < 0) return;

    const [draggedProject] = visibleProjects.splice(draggedIndex, 1);
    visibleProjects.splice(targetIndex, 0, draggedProject);
    const nextProjectIds = new Set(visibleProjects.map((project) => project.id));
    const nextProjects = [
      ...visibleProjects,
      ...activeNamespace.projects.filter((project) => !nextProjectIds.has(project.id)),
    ];
    const nextNamespaces = namespaces.map((namespace) =>
      namespace.id === activeNamespace.id
        ? { ...namespace, updatedAt: Date.now(), projects: nextProjects }
        : namespace,
    );

    setProjectSort("manual");
    setNamespaces(nextNamespaces);
    void saveWorkspace(nextNamespaces, activeNamespace.id);
  };

  if (!loaded || !activeNamespace) {
    return (
      <main className="loading-screen" aria-label="Loading Reveal Studio">
        <div className="loading-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-app">
      <aside className="dashboard-sidebar">
        <Link className="dashboard-brand" href="/" aria-label="Reveal Studio dashboard">
          <span className="app-logo" aria-hidden="true" />
          <strong>Reveal Studio</strong>
        </Link>
        <div className="dashboard-sidebar-block">
          <span className="dashboard-sidebar-label">Workspaces</span>
          <div className="dashboard-namespace-list">
            {namespaces.map((namespace) => (
              <div
                className={`dashboard-namespace-row ${namespace.id === activeNamespace.id ? "active" : ""} ${renamingNamespaceId === namespace.id ? "renaming" : ""}`}
                key={namespace.id}
              >
                {renamingNamespaceId === namespace.id ? (
                  <input
                    autoFocus
                    className="dashboard-namespace-input"
                    value={renamingNamespaceName}
                    onChange={(event) => setRenamingNamespaceName(event.target.value)}
                    onBlur={commitNamespaceRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitNamespaceRename();
                      if (event.key === "Escape") cancelNamespaceRename();
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="dashboard-namespace-select"
                      onClick={() => setActiveNamespaceId(namespace.id)}
                    >
                      <span>{namespace.name}</span>
                      <small>{namespace.projects.length}</small>
                    </button>
                    <button
                      type="button"
                      className="dashboard-namespace-action"
                      aria-label={`Rename ${namespace.name}`}
                      title="Rename"
                      onClick={() => startRenameNamespace(namespace)}
                    >
                      <span className="dashboard-namespace-action-label">Rename</span>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="dashboard-secondary-button" onClick={createNamespace}>
            New workspace
          </button>
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>Projects</h1>
            <p>{activeNamespace.name} · {activeNamespace.projects.length} projects</p>
          </div>
          <div className="dashboard-header-actions">
            <div className="dashboard-sort" aria-label="Project order">
              <button
                type="button"
                className={projectSort === "manual" ? "active" : ""}
                onClick={() => setProjectSort("manual")}
              >
                Custom
              </button>
              <button
                type="button"
                className={projectSort === "oldest" ? "active" : ""}
                onClick={() => setProjectSort("oldest")}
              >
                Oldest
              </button>
              <button
                type="button"
                className={projectSort === "newest" ? "active" : ""}
                onClick={() => setProjectSort("newest")}
              >
                Newest
              </button>
            </div>
            <button type="button" className="primary-button" onClick={createProject}>
              New project
            </button>
          </div>
        </header>

        <div className="dashboard-project-list" aria-label="Projects">
          {sortedProjects.map((project) => (
            <Link
              className={`dashboard-project-row ${draggingProjectId === project.id ? "dragging" : ""} ${projectDropTargetId === project.id && draggingProjectId !== project.id ? "drop-target" : ""}`}
              draggable
              href={`/canvas?namespace=${encodeURIComponent(activeNamespace.id)}&project=${encodeURIComponent(project.id)}`}
              key={project.id}
              onDragEnd={() => {
                setDraggingProjectId("");
                setProjectDropTargetId("");
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                if (draggingProjectId && draggingProjectId !== project.id) setProjectDropTargetId(project.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (draggingProjectId && draggingProjectId !== project.id) setProjectDropTargetId(project.id);
              }}
              onDragStart={(event) => {
                setDraggingProjectId(project.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", project.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const draggedProjectId = event.dataTransfer.getData("text/plain") || draggingProjectId;
                reorderProjects(draggedProjectId, project.id);
                setDraggingProjectId("");
                setProjectDropTargetId("");
              }}
            >
              <span className="dashboard-project-drag" aria-hidden="true" />
              <span className="dashboard-project-mark" aria-hidden="true">
                {project.name.trim().slice(0, 1).toUpperCase() || "R"}
              </span>
              <span className="dashboard-project-copy">
                <strong>{project.name}</strong>
                <small>{project.slides.length} slides · Updated {formatUpdatedAt(project.updatedAt)}</small>
              </span>
              <span className="dashboard-project-open">Open</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
