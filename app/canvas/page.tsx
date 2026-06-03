"use client";

import { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent, memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import hljs from "highlight.js";
import * as THREE from "three";
import {
  arrowTypes,
  canvasHeight,
  canvasWidth,
  codeLanguages,
  colorPickerHeight,
  colorPickerWidth,
  defaultNamespaceId,
  defaultNamespaceName,
  defaultThreeAngles,
  gridSize,
  internalClipboardType,
  internalSlideClipboardType,
  isThreeShapeType,
  maxCanvasZoom,
  maxTextFontSize,
  minCanvasZoom,
  minTextFontSize,
  minTextWidth,
  namespaceStorageKey,
  preferencesKey,
  projectDbName,
  projectDbStoreName,
  resizeHandles,
  revealColors,
  rotationSnapStep,
  rotationSnapThreshold,
  snapThreshold,
  storageKey,
  textFontSizeOptions,
  textFontWeightOptions,
  textLineHeight,
  textPaddingX,
  textPaddingY,
  textPresets,
  toolItems,
  userSettingsKey,
} from "./constants";
import type {
  AlignmentGuide,
  Bounds,
  CanvasPanState,
  ContextMenuState,
  ContextSubmenu,
  DragState,
  ElementStylePreferences,
  ElementType,
  HsvColor,
  MarqueeSelectionState,
  NamespaceContextMenuState,
  PendingPlacement,
  Project,
  RemoteProjectsResponse,
  RevealAnimation,
  ResizeHandle,
  RgbColor,
  Slide,
  SlideContextMenuState,
  SlideDropIndicator,
  SlideTransition,
  SlideElement,
  StoredNamespace,
  StoredProject,
  StoredWorkspace,
  TextEditFocusMode,
  TextPreset,
  UserSettings,
  WorkspaceNamespace,
} from "./types";

const defaultElementPreferences = (): ElementStylePreferences => ({
  text: { fill: "#111827", stroke: "#111827" },
  code: { fill: "#282c34", stroke: "#111827" },
  "file-tree": { fill: "#ffffff", stroke: "#111827" },
  table: { fill: "#ffffff", stroke: "#111827" },
  rect: { fill: "#ffffff", stroke: "#111827" },
  "border-rect": { fill: "transparent", stroke: "#111827" },
  circle: { fill: "#ffffff", stroke: "#111827" },
  "border-circle": { fill: "transparent", stroke: "#111827" },
  diamond: { fill: "#ffffff", stroke: "#111827" },
  triangle: { fill: "#ffffff", stroke: "#111827" },
  cube: { fill: "#ffffff", stroke: "#111827" },
  sphere: { fill: "#ffffff", stroke: "#111827" },
  cylinder: { fill: "#ffffff", stroke: "#111827" },
  line: { fill: "transparent", stroke: "#111827" },
  "dashed-line": { fill: "transparent", stroke: "#111827" },
  arrow: { fill: "transparent", stroke: "#111827" },
  "dashed-arrow": { fill: "transparent", stroke: "#111827" },
  "double-arrow": { fill: "transparent", stroke: "#111827" },
  "curved-arrow": { fill: "transparent", stroke: "#111827" },
  "bend-arrow": { fill: "transparent", stroke: "#111827" },
  image: { fill: "transparent", stroke: "#111827" },
});

const normalizeElementPreferences = (savedPreferences: Partial<Record<ElementType, Partial<SlideElement>>>): ElementStylePreferences => {
  const defaults = defaultElementPreferences();
  const nextPreferences: ElementStylePreferences = { ...defaults };

  (Object.keys(defaults) as ElementType[]).forEach((type) => {
    const saved = savedPreferences[type];
    nextPreferences[type] = {
      ...defaults[type],
      ...(typeof saved?.fill === "string" ? { fill: saved.fill } : {}),
      ...(typeof saved?.stroke === "string" ? { stroke: saved.stroke } : {}),
    };
  });

  return nextPreferences;
};

const defaultUserSettings = (): UserSettings => ({
  showRevealNumbers: true,
  showEditGrid: true,
  showPreviewGrid: true,
});

const normalizeUserSettings = (savedSettings: Partial<UserSettings> | null | undefined): UserSettings => {
  const defaults = defaultUserSettings();
  return {
    showRevealNumbers: typeof savedSettings?.showRevealNumbers === "boolean" ? savedSettings.showRevealNumbers : defaults.showRevealNumbers,
    showEditGrid: typeof savedSettings?.showEditGrid === "boolean" ? savedSettings.showEditGrid : defaults.showEditGrid,
    showPreviewGrid: typeof savedSettings?.showPreviewGrid === "boolean" ? savedSettings.showPreviewGrid : defaults.showPreviewGrid,
  };
};

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
};

const cloneNamespaces = (namespaces: WorkspaceNamespace[]) => structuredClone(namespaces) as WorkspaceNamespace[];
const hasLargeEmbeddedMedia = (projects: Project[]) =>
  projects.some((project) =>
    project.slides.some((slide) =>
      slide.elements.some((element) => typeof element.src === "string" && element.src.startsWith("data:") && element.src.length > 120_000),
    ),
  );
const getProjectsUpdatedAt = (projects: Project[]) => Math.max(0, ...projects.map((project) => project.updatedAt));
const getNamespacesUpdatedAt = (namespaces: WorkspaceNamespace[]) =>
  Math.max(0, ...namespaces.map((namespace) => Math.max(namespace.updatedAt, getProjectsUpdatedAt(namespace.projects))));
const mergeProjectsByFreshness = (localProjects: Project[], remoteProjects: Project[]) => {
  const merged = new Map<string, Project>();
  localProjects.forEach((project) => merged.set(project.id, project));
  remoteProjects.forEach((project) => {
    const localProject = merged.get(project.id);
    if (!localProject || project.updatedAt > localProject.updatedAt) {
      merged.set(project.id, project);
    }
  });

  return [...merged.values()];
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
      id: localNamespace.id,
      name: remoteUpdatedAt > localUpdatedAt ? namespace.name : localNamespace.name,
      updatedAt: Math.max(localNamespace.updatedAt, namespace.updatedAt),
      projects: mergeProjectsByFreshness(localNamespace.projects, namespace.projects),
    });
  });

  return [...merged.values()].sort((first, second) => second.updatedAt - first.updatedAt);
};
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const formatDegrees = (angle: number) => {
  const normalized = ((Math.round(angle) % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
};
const snapRotationAngle = (angle: number) => {
  const normalized = ((angle % 360) + 360) % 360;
  const target = Math.round(normalized / rotationSnapStep) * rotationSnapStep;
  const snapped = target === 360 ? 0 : target;
  const delta = ((snapped - normalized + 540) % 360) - 180;
  return Math.abs(delta) <= rotationSnapThreshold ? angle + delta : angle;
};

const openProjectDb = () =>
  new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = indexedDB.open(projectDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(projectDbStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

const readValueFromDb = async <T,>(key: string) => {
  const db = await openProjectDb();
  if (!db) return null;

  return new Promise<T | null>((resolve) => {
    const transaction = db.transaction(projectDbStoreName, "readonly");
    const request = transaction.objectStore(projectDbStoreName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const writeValueToDb = async (key: string, value: unknown) => {
  const db = await openProjectDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(projectDbStoreName, "readwrite");
    transaction.objectStore(projectDbStoreName).put(value, key);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
};

const readWorkspaceFromDb = () => readValueFromDb<StoredWorkspace>(namespaceStorageKey);
const readLegacyProjectsFromDb = () => readValueFromDb<StoredProject[]>(storageKey);
const writeWorkspaceToDb = (workspace: StoredWorkspace) => writeValueToDb(namespaceStorageKey, workspace);

const readNamespacesFromRemote = async () => {
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
    // Local IndexedDB remains the primary safety net if the remote database is offline.
  }
};

const downscaleImageDataUrl = (src: string, maxSide = 1800, quality = 0.88) =>
  new Promise<string>((resolve) => {
    if (typeof Image === "undefined" || typeof document === "undefined") {
      resolve(src);
      return;
    }

    const image = new Image();
    image.onload = () => {
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      const scale = Math.min(maxSide / naturalWidth, maxSide / naturalHeight, 1);

      if (scale >= 1) {
        resolve(src);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(src);
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => resolve(src);
    image.src = src;
  });

const getTextMeasureContext = (fontSize: number, fontWeight = 800) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = `${fontWeight} ${fontSize}px Arial, Helvetica, sans-serif`;
  return context;
};

const measureTextWidth = (line: string, fontSize: number, context: CanvasRenderingContext2D | null) =>
  context ? context.measureText(line || " ").width : Math.max(1, line.length) * fontSize * 0.62;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const textToHtml = (value: string) => escapeHtml(value).replaceAll("\n", "<br>");

const htmlToPlainText = (html: string) => {
  if (typeof document === "undefined") return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:div|p)>/gi, "\n").replace(/<[^>]+>/g, "");
  const template = document.createElement("template");
  template.innerHTML = html;
  const blockTags = new Set(["DIV", "P"]);
  let text = "";

  const appendNewline = () => {
    if (text && !text.endsWith("\n")) text += "\n";
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }

    if (!(node instanceof HTMLElement)) {
      node.childNodes.forEach(walk);
      return;
    }

    if (node.tagName === "BR") {
      text += "\n";
      return;
    }

    const isBlock = blockTags.has(node.tagName);
    if (isBlock) appendNewline();
    node.childNodes.forEach(walk);
    if (isBlock) appendNewline();
  };

  template.content.childNodes.forEach(walk);
  return text.replaceAll("\u00a0", " ").replace(/\n+$/g, "");
};

const getTextElementPlainText = (element: Pick<SlideElement, "text" | "textHtml">) =>
  element.textHtml ? htmlToPlainText(element.textHtml) : element.text ?? "";

const parseRichTextFontSize = (style: string, fallbackFontSize: number) => {
  const pixelSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)px/i)?.[1];
  if (pixelSize) return clamp(Number(pixelSize), minTextFontSize, maxTextFontSize);
  const percentSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)%/i)?.[1];
  if (percentSize) return clamp(fallbackFontSize * (Number(percentSize) / 100), minTextFontSize, maxTextFontSize);
  return fallbackFontSize;
};

const formatRichTextFontSizePercent = (fontSize: number, baseFontSize: number) =>
  `${Math.round((clamp(fontSize, minTextFontSize, maxTextFontSize) / Math.max(1, baseFontSize)) * 1000) / 10}%`;

const sanitizeRichTextHtml = (html: string) => {
  if (typeof document === "undefined") return textToHtml(htmlToPlainText(html));
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["B", "STRONG", "I", "EM", "BR", "DIV", "P", "SPAN"]);

  template.content.querySelectorAll("*").forEach((node) => {
    const style = node.getAttribute("style") ?? "";
    const pixelFontSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)px/i)?.[1];
    const percentFontSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)%/i)?.[1];
    const fontWeight = style.match(/font-weight:\s*(\d+)/i)?.[1];
    [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    if (node.tagName === "SPAN") {
      const safeStyles = [
        pixelFontSize ? `font-size: ${clamp(Number(pixelFontSize), minTextFontSize, maxTextFontSize)}px` : "",
        percentFontSize ? `font-size: ${clamp(Number(percentFontSize), 10, 500)}%` : "",
        fontWeight ? `font-weight: ${clamp(Number(fontWeight), 100, 900)}` : "",
      ].filter(Boolean);
      if (safeStyles.length > 0) node.setAttribute("style", safeStyles.join("; "));
    }
  });

  return template.innerHTML;
};

const getRichTextMetrics = (html: string, fallbackFontSize: number, fallbackFontWeight: number) => {
  if (typeof document === "undefined") return { fontSize: fallbackFontSize, fontWeight: fallbackFontWeight };
  const template = document.createElement("template");
  template.innerHTML = html;
  let fontSize = fallbackFontSize;
  let fontWeight = fallbackFontWeight;

  template.content.querySelectorAll("[style]").forEach((node) => {
    const style = (node as HTMLElement).getAttribute("style") ?? "";
    const nextFontWeight = style.match(/font-weight:\s*(\d+)/i)?.[1];
    fontSize = Math.max(fontSize, parseRichTextFontSize(style, fallbackFontSize));
    if (nextFontWeight) fontWeight = Math.max(fontWeight, Number(nextFontWeight));
  });

  return { fontSize, fontWeight };
};

const enhanceCodeHighlight = (html: string, language: string) => {
  if (!["cpp", "c", "c++", "cc", "h", "hpp"].includes(language)) return html;

  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part.replace(
        /\b(?:[A-Za-z_]\w*::)+[A-Za-z_]\w*(?=(?:&lt;|::|\b))/g,
        (match) => `<span class="hljs-type">${match}</span>`,
      );
    })
    .join("");
};

const highlightCode = (code: string, language = "javascript") => {
  const normalizedLanguage = hljs.getLanguage(language) ? language : "plaintext";
  const html = hljs.highlight(code, {
    language: normalizedLanguage,
    ignoreIllegals: true,
  }).value;
  return enhanceCodeHighlight(html, normalizedLanguage);
};

const isShellLanguage = (language = "") => ["bash", "shell", "sh", "zsh"].includes(language);
const getShellLines = (code: string) => code.replace(/\n+$/, "").split("\n").filter((line, index, lines) => line.trim() !== "" || index < lines.length - 1);
type ShellLine =
  | { kind: "command"; userHost: string; cwd: string; prompt: "$" | "#"; command: string }
  | { kind: "output"; output: string };

const parseShellLine = (line: string) => {
  const commandLine = line.trimStart();
  const fullPromptMatch = commandLine.match(/^([A-Za-z0-9._-]+@[A-Za-z0-9._-]+):([^\s$#]+)([$#])\s?(.*)$/);
  if (fullPromptMatch) {
    return {
      kind: "command",
      userHost: fullPromptMatch[1],
      cwd: fullPromptMatch[2],
      prompt: fullPromptMatch[3] as "$" | "#",
      command: fullPromptMatch[4],
    } satisfies ShellLine;
  }

  const cwdPromptMatch = commandLine.match(/^((?:~|\.{1,2}|\/)?[\w./-]+)([$#])\s+(.*)$/);
  if (cwdPromptMatch) {
    return {
      kind: "command",
      userHost: "",
      cwd: cwdPromptMatch[1],
      prompt: cwdPromptMatch[2] as "$" | "#",
      command: cwdPromptMatch[3],
    } satisfies ShellLine;
  }

  const barePromptMatch = commandLine.match(/^([$#])\s?(.*)$/);
  if (barePromptMatch) {
    return {
      kind: "command",
      userHost: "",
      cwd: "",
      prompt: barePromptMatch[1] as "$" | "#",
      command: barePromptMatch[2],
    } satisfies ShellLine;
  }

  return {
    kind: "output",
    output: line,
  } satisfies ShellLine;
};
const highlightShellLine = (line: string) => {
  const shellLine = parseShellLine(line);
  if (shellLine.kind === "output") return escapeHtml(shellLine.output);

  const { command } = shellLine;
  let tokenIndex = 0;

  return escapeHtml(command).replace(/\$\{?[\w_]+\}?|"[^"]*"|'[^']*'|--?[\w-]+|(?:~|\.{1,2})?\/[^\s]+|\b\d+(?:\.\d+)?\b|[|&;<>]+|\S+/g, (token) => {
    let className = "shell-arg";
    if (token.startsWith('"') || token.startsWith("'")) className = "shell-string";
    else if (token.startsWith("$")) className = "shell-variable";
    else if (token.startsWith("-")) className = "shell-flag";
    else if (/^(?:~|\.{1,2})?\//.test(token)) className = "shell-path";
    else if (/^\d/.test(token)) className = "shell-number";
    else if (/^[|&;<>]+$/.test(token)) className = "shell-operator";
    else if (tokenIndex === 0) className = "shell-command";
    tokenIndex += 1;
    return `<span class="${className}">${token}</span>`;
  });
};

const getFileTreeRows = (tree: string) =>
  tree
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const leadingWhitespace = line.match(/^[\t ]*/)?.[0] ?? "";
      const depth = Math.floor(leadingWhitespace.replaceAll("\t", "  ").length / 2);
      const label = line.trim().replace(/^[├└│─\s]+/, "").trim();
      return {
        depth,
        label,
        isFolder: /\/$/.test(label),
      };
    })
    .filter((row) => row.label.length > 0);

const getTableRows = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(line.includes("\t") ? "\t" : ",").map((cell) => cell.trim()));

const makeCurvedArrowElement = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  zIndex: number,
  preferences: Partial<Pick<SlideElement, "fill" | "stroke">>,
): SlideElement => {
  const minSize = 24;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const rawWidth = Math.abs(end.x - start.x);
  const rawHeight = Math.abs(end.y - start.y);
  const width = Math.max(minSize, rawWidth);
  const height = Math.max(minSize, rawHeight);

  return {
    id: makeId(),
    type: "curved-arrow",
    x: Math.round(clamp(x, 0, canvasWidth - width)),
    y: Math.round(clamp(y, 0, canvasHeight - height)),
    width,
    height,
    rotation: 0,
    zIndex,
    reveal: 1,
    animation: "fade",
    fill: "transparent",
    stroke: preferences.stroke ?? "#111827",
    strokeWidth: 5,
    radius: 16,
    curveStart: { x: start.x - x, y: start.y - y },
    curveEnd: { x: end.x - x, y: end.y - y },
  };
};

const getDefaultBendArrowPoints = (width: number, height: number, strokeWidth: number) => ({
  start: { x: strokeWidth / 2, y: height / 2 },
  control: { x: width / 2, y: height / 2 },
  end: { x: Math.max(strokeWidth / 2, width - strokeWidth / 2), y: height / 2 },
});

const getGridColor = (background: string) => {
  const hex = background.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "rgba(17, 24, 39, 0.11)";
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.52 ? "rgba(17, 24, 39, 0.14)" : "rgba(255, 255, 255, 0.18)";
};

const normalizeHexColor = (value: string) => {
  const hex = value.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex
      .split("")
      .map((character) => `${character}${character}`)
      .join("")
      .toLowerCase()}`;
  }
  return "#000000";
};

const parseColorValue = (value: string) => {
  const trimmed = value.trim();
  const hex = trimmed.replace(/^#/, "");

  if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{3}$/.test(hex)) return normalizeHexColor(trimmed);

  const channels = trimmed.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (channels.length >= 3) {
    return rgbToHex({
      red: clamp(channels[0], 0, 255),
      green: clamp(channels[1], 0, 255),
      blue: clamp(channels[2], 0, 255),
    });
  }

  return null;
};

const hexToRgb = (value: string): RgbColor => {
  const hex = normalizeHexColor(value).slice(1);
  return {
    red: parseInt(hex.slice(0, 2), 16),
    green: parseInt(hex.slice(2, 4), 16),
    blue: parseInt(hex.slice(4, 6), 16),
  };
};

const rgbToHex = ({ red, green, blue }: RgbColor) =>
  `#${[red, green, blue].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0")).join("")}`;

const rgbToHsv = ({ red, green, blue }: RgbColor): HsvColor => {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === normalizedRed) hue = ((normalizedGreen - normalizedBlue) / delta) % 6;
    if (max === normalizedGreen) hue = (normalizedBlue - normalizedRed) / delta + 2;
    if (max === normalizedBlue) hue = (normalizedRed - normalizedGreen) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
};

const hsvToRgb = ({ hue, saturation, value }: HsvColor): RgbColor => {
  const chroma = value * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) [red, green, blue] = [chroma, x, 0];
  else if (huePrime < 2) [red, green, blue] = [x, chroma, 0];
  else if (huePrime < 3) [red, green, blue] = [0, chroma, x];
  else if (huePrime < 4) [red, green, blue] = [0, x, chroma];
  else if (huePrime < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return {
    red: Math.round((red + match) * 255),
    green: Math.round((green + match) * 255),
    blue: Math.round((blue + match) * 255),
  };
};

const wrapParagraph = (paragraph: string, fontSize: number, maxLineWidth: number, context: CanvasRenderingContext2D | null) => {
  if (!paragraph) return [""];
  const lines: string[] = [];
  let currentLine = "";

  paragraph.split(/(\s+)/).forEach((token) => {
    if (!token) return;
    const nextLine = `${currentLine}${token}`;
    if (!currentLine || measureTextWidth(nextLine.trimEnd(), fontSize, context) <= maxLineWidth) {
      currentLine = nextLine;
      return;
    }

    lines.push(currentLine.trimEnd());
    currentLine = token.trimStart();

    while (measureTextWidth(currentLine, fontSize, context) > maxLineWidth && currentLine.length > 1) {
      let sliceEnd = currentLine.length;
      while (sliceEnd > 1 && measureTextWidth(currentLine.slice(0, sliceEnd), fontSize, context) > maxLineWidth) {
        sliceEnd -= 1;
      }
      lines.push(currentLine.slice(0, sliceEnd));
      currentLine = currentLine.slice(sliceEnd);
    }
  });

  lines.push(currentLine.trimEnd());
  return lines;
};

const getWrappedTextLines = (text: string, fontSize = 36, maxWidth?: number, fontWeight = 800) => {
  const context = getTextMeasureContext(fontSize, fontWeight);
  const maxLineWidth = typeof maxWidth === "number" ? Math.max(1, maxWidth - textPaddingX) : undefined;
  return (text || " ")
    .split("\n")
    .flatMap((paragraph) => (maxLineWidth ? wrapParagraph(paragraph, fontSize, maxLineWidth, context) : [paragraph]));
};

const estimateTextBounds = (text: string, fontSize = 36, maxWidth?: number, fontWeight = 800): Pick<SlideElement, "width" | "height"> => {
  const context = getTextMeasureContext(fontSize, fontWeight);
  const lines = getWrappedTextLines(text, fontSize, maxWidth, fontWeight);
  const measuredWidth = Math.max(...lines.map((line) => measureTextWidth(line || " ", fontSize, context)));

  return {
    width: Math.ceil(typeof maxWidth === "number" ? maxWidth : measuredWidth + textPaddingX),
    height: Math.ceil(lines.length * fontSize * textLineHeight + textPaddingY),
  };
};

const sortByReveal = (elements: SlideElement[]) =>
  [...elements].sort(
    (first, second) => first.reveal - second.reveal || first.zIndex - second.zIndex || first.id.localeCompare(second.id),
  );
const getBounds = (elements: Array<Pick<Bounds, "x" | "y" | "width" | "height">>): Bounds | null => {
  if (elements.length === 0) return null;

  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const normalizeBounds = (first: { x: number; y: number }, second: { x: number; y: number }): Bounds => ({
  x: Math.min(first.x, second.x),
  y: Math.min(first.y, second.y),
  width: Math.abs(second.x - first.x),
  height: Math.abs(second.y - first.y),
});

const resizeBoundsAnchored = (
  startBounds: Bounds,
  point: { x: number; y: number },
  startPoint: { x: number; y: number },
  handle: ResizeHandle,
  minimumSize: Partial<Pick<Bounds, "width" | "height">> = {},
): Bounds => {
  const deltaX = point.x - startPoint.x;
  const deltaY = point.y - startPoint.y;
  const minWidth = minimumSize.width ?? 32;
  const minHeight = minimumSize.height ?? 20;
  const startRight = startBounds.x + startBounds.width;
  const startBottom = startBounds.y + startBounds.height;
  let left = startBounds.x;
  let right = startRight;
  let top = startBounds.y;
  let bottom = startBottom;

  if (handle.includes("w")) {
    left = clamp(startBounds.x + deltaX, 0, startRight - minWidth);
  }

  if (handle.includes("e")) {
    right = clamp(startRight + deltaX, startBounds.x + minWidth, canvasWidth);
  }

  if (handle.includes("n")) {
    top = clamp(startBounds.y + deltaY, 0, startBottom - minHeight);
  }

  if (handle.includes("s")) {
    bottom = clamp(startBottom + deltaY, startBounds.y + minHeight, canvasHeight);
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
};

const resizeRotatedBoundsAnchored = (
  startBounds: Bounds,
  point: { x: number; y: number },
  startPoint: { x: number; y: number },
  handle: ResizeHandle,
  rotation: number,
  minimumSize: Partial<Pick<Bounds, "width" | "height">> = {},
): Bounds => {
  if (Math.abs(rotation % 360) < 0.001) {
    return resizeBoundsAnchored(startBounds, point, startPoint, handle, minimumSize);
  }

  const angle = rotation * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const deltaX = point.x - startPoint.x;
  const deltaY = point.y - startPoint.y;
  const localDelta = {
    x: deltaX * cos + deltaY * sin,
    y: -deltaX * sin + deltaY * cos,
  };
  const localBounds = resizeBoundsAnchored(
    { x: 0, y: 0, width: startBounds.width, height: startBounds.height },
    localDelta,
    { x: 0, y: 0 },
    handle,
    minimumSize,
  );
  const localCenterShift = {
    x: localBounds.x + localBounds.width / 2 - startBounds.width / 2,
    y: localBounds.y + localBounds.height / 2 - startBounds.height / 2,
  };
  const centerShift = {
    x: localCenterShift.x * cos - localCenterShift.y * sin,
    y: localCenterShift.x * sin + localCenterShift.y * cos,
  };
  const startCenter = {
    x: startBounds.x + startBounds.width / 2,
    y: startBounds.y + startBounds.height / 2,
  };
  const width = localBounds.width;
  const height = localBounds.height;
  const x = clamp(startCenter.x + centerShift.x - width / 2, 0, canvasWidth - width);
  const y = clamp(startCenter.y + centerShift.y - height / 2, 0, canvasHeight - height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
  };
};

const getTextAutoBounds = (
  element: Pick<SlideElement, "text" | "fontSize" | "fontWeight">,
  origin: Pick<Bounds, "x" | "y">,
): Bounds => {
  const measured = estimateTextBounds(element.text ?? "", element.fontSize ?? 36, undefined, element.fontWeight ?? 800);
  const width = Math.max(minTextWidth, measured.width);

  return {
    x: origin.x,
    y: origin.y,
    width: Math.min(width, canvasWidth - origin.x),
    height: Math.min(measured.height, canvasHeight - origin.y),
  };
};

const anchorTextBounds = (bounds: Bounds, fitted: Pick<Bounds, "width" | "height">, handle: ResizeHandle): Bounds => {
  const startRight = bounds.x + bounds.width;
  const startBottom = bounds.y + bounds.height;
  let x = bounds.x;
  let y = bounds.y;

  if (handle.includes("w")) x = startRight - fitted.width;
  if (handle.includes("n")) y = startBottom - fitted.height;

  x = clamp(x, 0, canvasWidth - fitted.width);
  y = clamp(y, 0, canvasHeight - fitted.height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(fitted.width),
    height: Math.round(fitted.height),
  };
};

const fitResizedTextElement = (
  element: Pick<SlideElement, "text" | "fontSize" | "fontWeight" | "textHtml">,
  startElement: Pick<SlideElement, "width" | "height" | "fontSize" | "fontWeight" | "text" | "textHtml">,
  bounds: Bounds,
  handle: ResizeHandle,
) => {
  const text = element.text ?? htmlToPlainText(element.textHtml ?? startElement.textHtml ?? "");
  const fontWeight = element.fontWeight ?? startElement.fontWeight ?? 800;
  const startFontSize = startElement.fontSize ?? element.fontSize ?? 36;
  const width = Math.max(minTextWidth, Math.min(bounds.width, canvasWidth - bounds.x));
  const measured = estimateTextBounds(text, startFontSize, width, fontWeight);
  const fitted = anchorTextBounds(
    bounds,
    {
      width,
      height: Math.max(measured.height, Math.min(bounds.height, canvasHeight - bounds.y)),
    },
    handle,
  );

  return {
    bounds: fitted,
    fontSize: Math.round(startFontSize * 10) / 10,
    textHtml: startElement.textHtml ?? element.textHtml,
  };
};

const getSnapAnchors = (bounds: Bounds) => ({
  vertical: [
    { position: bounds.x, offset: 0 },
    { position: bounds.x + bounds.width / 2, offset: bounds.width / 2 },
    { position: bounds.x + bounds.width, offset: bounds.width },
  ],
  horizontal: [
    { position: bounds.y, offset: 0 },
    { position: bounds.y + bounds.height / 2, offset: bounds.height / 2 },
    { position: bounds.y + bounds.height, offset: bounds.height },
  ],
});

type ThreeShapeProps = {
  type: ElementType;
  fill: string;
  stroke: string;
  pitch?: number;
  yaw?: number;
  roll?: number;
};

const createThreeGeometry = (type: ElementType) => {
  if (type === "sphere") return new THREE.SphereGeometry(0.82, 32, 16);
  if (type === "cylinder") return new THREE.CylinderGeometry(0.68, 0.68, 1.42, 32, 1);
  return new THREE.BoxGeometry(1.28, 1.28, 1.28, 1, 1, 1);
};

const toThreeColor = (value: string, fallback: string) => parseColorValue(value) ?? fallback;

const ThreeShape = memo(function ThreeShape({ type, fill, stroke, pitch, yaw, roll }: ThreeShapeProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const renderRef = useRef<() => void>(() => {});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "three-shape-canvas";
    mount.appendChild(renderer.domElement);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(-2.4, 3.2, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.6);
    fillLight.position.set(3, -2, 2.5);
    scene.add(fillLight);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;

    renderRef.current = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };

    const observer = new ResizeObserver(() => renderRef.current());
    observer.observe(mount);
    renderRef.current();

    return () => {
      observer.disconnect();
      if (groupRef.current) {
        scene.remove(groupRef.current);
        groupRef.current.traverse((object) => {
          const renderable = object as THREE.Mesh | THREE.LineSegments;
          renderable.geometry?.dispose();
        });
      }
      materialRef.current?.dispose();
      edgeMaterialRef.current?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      groupRef.current = null;
      materialRef.current = null;
      edgeMaterialRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current.traverse((object) => {
        const renderable = object as THREE.Mesh | THREE.LineSegments;
        renderable.geometry?.dispose();
      });
      materialRef.current?.dispose();
      edgeMaterialRef.current?.dispose();
    }

    const material = new THREE.MeshStandardMaterial({
      color: toThreeColor(fill, "#ffffff"),
      roughness: 0.58,
      metalness: 0.03,
      transparent: fill === "transparent",
      opacity: fill === "transparent" ? 0.08 : 1,
      side: THREE.DoubleSide,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: toThreeColor(stroke, "#111827"),
      transparent: true,
      opacity: 0.92,
    });
    const geometry = createThreeGeometry(type);
    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, type === "sphere" ? 14 : 1), edgeMaterial);
    const group = new THREE.Group();
    group.add(mesh, edges);
    scene.add(group);

    groupRef.current = group;
    materialRef.current = material;
    edgeMaterialRef.current = edgeMaterial;
    renderRef.current();
  }, [fill, stroke, type]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.set(
      THREE.MathUtils.degToRad(pitch ?? defaultThreeAngles.pitch),
      THREE.MathUtils.degToRad(yaw ?? defaultThreeAngles.yaw),
      THREE.MathUtils.degToRad(roll ?? defaultThreeAngles.roll),
      "XYZ",
    );
    renderRef.current();
  }, [pitch, roll, yaw]);

  return <div className="three-shape" ref={mountRef} aria-hidden="true" />;
});

type NumberInputProps = {
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
};

const NumberInput = ({ value, min, max, step, onCommit }: NumberInputProps) => {
  const normalizedValue = value ?? min ?? 0;
  const [draft, setDraft] = useState(String(normalizedValue));

  const commitDraft = (nextDraft: string) => {
    if (nextDraft.trim() === "" || nextDraft === "-") return;
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) return;
    onCommit(clamp(parsed, min ?? -Infinity, max ?? Infinity));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        commitDraft(nextDraft);
      }}
      onBlur={() => {
        if (draft.trim() === "" || !Number.isFinite(Number(draft))) {
          setDraft(String(normalizedValue));
          return;
        }
        const nextValue = clamp(Number(draft), min ?? -Infinity, max ?? Infinity);
        setDraft(String(nextValue));
        onCommit(nextValue);
      }}
    />
  );
};

type TextFontSizeControlProps = {
  value?: number;
  onCommit: (value: number) => void;
};

const TextFontSizeControl = ({ value, onCommit }: TextFontSizeControlProps) => {
  const normalizedValue = clamp(Math.round(value ?? 36), minTextFontSize, maxTextFontSize);
  const options = [...new Set([...textFontSizeOptions, normalizedValue])].sort((first, second) => first - second);
  const commit = (nextValue: number) => onCommit(clamp(Math.round(nextValue), minTextFontSize, maxTextFontSize));

  return (
    <div className="text-size-control">
      <select value={normalizedValue} onChange={(event) => commit(Number(event.target.value))} aria-label="Text size">
        {options.map((option) => (
          <option key={option} value={option}>
            {option}px
          </option>
        ))}
      </select>
      <div className="text-size-steppers" aria-label="Fine tune text size">
        <button type="button" title="Decrease size by 1" aria-label="Decrease size by 1" onClick={() => commit(normalizedValue - 1)}>
          -
        </button>
        <button type="button" title="Increase size by 1" aria-label="Increase size by 1" onClick={() => commit(normalizedValue + 1)}>
          +
        </button>
      </div>
    </div>
  );
};

type TextFontWeightControlProps = {
  value?: number;
  onCommit: (value: number) => void;
};

const TextFontWeightControl = ({ value, onCommit }: TextFontWeightControlProps) => {
  const normalizedValue = clamp(Math.round(value ?? 800), 100, 900);
  const hasNamedValue = textFontWeightOptions.some((option) => option.value === normalizedValue);
  const options = hasNamedValue
    ? textFontWeightOptions
    : [...textFontWeightOptions, { value: normalizedValue, label: `Custom ${normalizedValue}` }].sort((first, second) => first.value - second.value);

  return (
    <select
      className="text-weight-select"
      value={normalizedValue}
      onChange={(event) => onCommit(clamp(Number(event.target.value), 100, 900))}
      aria-label="Text weight"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

type ColorInputProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
};

const ColorInput = ({ value, onChange, label }: ColorInputProps) => {
  const normalizedValue = normalizeHexColor(value);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const hsv = rgbToHsv(hexToRgb(normalizedValue));
  const hueColor = rgbToHex(hsvToRgb({ hue: hsv.hue, saturation: 1, value: 1 }));
  const rgb = hexToRgb(normalizedValue);

  const placePicker = () => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const left = clamp(rect.right - colorPickerWidth, 8, window.innerWidth - colorPickerWidth - 8);
    const topBelow = rect.bottom + 8;
    const topAbove = rect.top - colorPickerHeight - 8;
    const top = topBelow + colorPickerHeight <= window.innerHeight - 8 ? topBelow : Math.max(8, topAbove);
    setPosition({ left, top });
  };

  useEffect(() => {
    if (!open) return;
    placePicker();

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (pickerRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      setOpen(false);
    };
    const updatePlacement = () => placePicker();

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  const commitHsv = (nextHsv: HsvColor) => onChange(rgbToHex(hsvToRgb(nextHsv)));

  const updateSaturationValue = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    commitHsv({
      hue: hsv.hue,
      saturation: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      value: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    });
  };

  const updateHue = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    commitHsv({
      ...hsv,
      hue: clamp((event.clientX - rect.left) / rect.width, 0, 1) * 360,
    });
  };

  const updateRgbChannel = (channel: keyof RgbColor, channelValue: number) => {
    onChange(rgbToHex({ ...rgb, [channel]: clamp(channelValue, 0, 255) }));
  };

  const pasteColor = (value: string) => {
    const nextColor = parseColorValue(value);
    if (!nextColor) return;

    onChange(nextColor);
    setCopied(false);
  };

  const copyColor = async () => {
    try {
      await navigator.clipboard?.writeText(normalizedValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const popover = (
    <div
      ref={pickerRef}
      className="color-popover"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onPaste={(event) => {
        event.preventDefault();
        pasteColor(event.clipboardData.getData("text/plain"));
      }}
    >
      <div
        className="color-area"
        style={{ backgroundColor: hueColor }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateSaturationValue(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationValue(event);
        }}
      >
        <span
          className="color-area-thumb"
          style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.value) * 100}%` }}
        />
      </div>
      <div className="color-slider-row">
        <span className="color-preview" style={{ background: normalizedValue }} />
        <div
          className="hue-slider"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            updateHue(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHue(event);
          }}
        >
          <span className="hue-thumb" style={{ left: `${(hsv.hue / 360) * 100}%` }} />
        </div>
      </div>
      <div className="rgb-grid">
        <div className="rgb-channel">
          <input aria-label="Red" type="number" min={0} max={255} value={rgb.red} onChange={(event) => updateRgbChannel("red", Number(event.target.value))} />
          <span>R</span>
        </div>
        <div className="rgb-channel">
          <input aria-label="Green" type="number" min={0} max={255} value={rgb.green} onChange={(event) => updateRgbChannel("green", Number(event.target.value))} />
          <span>G</span>
        </div>
        <div className="rgb-channel">
          <input aria-label="Blue" type="number" min={0} max={255} value={rgb.blue} onChange={(event) => updateRgbChannel("blue", Number(event.target.value))} />
          <span>B</span>
        </div>
      </div>
      <div className="color-hex-row">
        <div className={`color-hex-control ${copied ? "is-copied" : ""}`}>
          <input
            className="color-hex-value"
            aria-label="HEX color"
            value={copied ? "Copied to clipboard" : normalizedValue}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            onPaste={(event) => {
              event.preventDefault();
              pasteColor(event.clipboardData.getData("text/plain"));
            }}
          />
          <button type="button" className="color-copy-button" aria-label="Copy HEX color" onClick={copyColor}>
            <span className="color-copy-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="color-control">
      <button
        type="button"
        ref={triggerRef}
        className="color-swatch-button"
        aria-label={label}
        onClick={() => {
          setOpen((current) => !current);
          queueMicrotask(placePicker);
        }}
      >
        <span style={{ background: normalizedValue }} />
      </button>
      {open && typeof document !== "undefined" ? createPortal(popover, document.body) : null}
    </div>
  );
};

const normalizeProjects = (projects: StoredProject[]): Project[] =>
  projects.map((project) => ({
    ...project,
    slides: project.slides.map((slide) => ({
      ...slide,
      transition: slide.transition ?? "fade",
      elements: slide.elements.map((element, index) => ({
        fill: element.type === "text" ? "#111827" : element.type === "code" ? "#282c34" : element.type === "file-tree" || element.type === "table" ? "#ffffff" : "#ffffff",
        stroke: "#111827",
        strokeWidth: ["border-rect", "border-circle"].includes(element.type) ? 4 : element.type === "arrow" || element.type === "line" || element.type === "dashed-line" ? 8 : element.type === "code" ? 1 : 0,
        reveal: 1,
        rotation: 0,
        pitch: isThreeShapeType(element.type) ? defaultThreeAngles.pitch : undefined,
        yaw: isThreeShapeType(element.type) ? defaultThreeAngles.yaw : undefined,
        roll: isThreeShapeType(element.type) ? defaultThreeAngles.roll : undefined,
        zIndex: index + 1,
        animation: "fade" as RevealAnimation,
        radius: 16,
        fontSize: element.type === "code" ? 14 : element.type === "file-tree" || element.type === "table" ? 18 : 36,
        fontWeight: element.type === "text" ? 800 : undefined,
        textAlign: element.type === "text" ? "left" : undefined,
        language: element.type === "code" ? "javascript" : undefined,
        ...element,
        textHtml: element.type === "text" ? element.textHtml ?? textToHtml(element.text ?? "") : undefined,
      })),
    })),
  }));

const makeDefaultNamespace = (projects: Project[], updatedAt = getProjectsUpdatedAt(projects)): WorkspaceNamespace => ({
  id: defaultNamespaceId,
  name: defaultNamespaceName,
  updatedAt,
  projects,
});

const normalizeNamespaces = (workspace: StoredWorkspace | StoredNamespace[] | StoredProject[] | null | undefined): WorkspaceNamespace[] => {
  if (!workspace) return [makeDefaultNamespace([starterProject()], Date.now())];
  if (Array.isArray(workspace)) {
    const firstItem = workspace[0] as StoredNamespace | StoredProject | undefined;
    if (firstItem && "projects" in firstItem) {
      const namespaces = (workspace as StoredNamespace[]).map((namespace, index) => {
        const projects = normalizeProjects(namespace.projects ?? []);
        const safeProjects = projects.length > 0 ? projects : [starterProject()];
        const fallbackName = index === 0 ? defaultNamespaceName : `Namespace ${index + 1}`;
        return {
          id: typeof namespace.id === "string" && namespace.id ? namespace.id : makeId(),
          name: typeof namespace.name === "string" && namespace.name.trim() ? namespace.name : fallbackName,
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
        {
          id: makeId(),
          type: "rect",
          x: 104,
          y: 255,
          width: 290,
          height: 155,
          rotation: 0,
          zIndex: 2,
          reveal: 1,
          animation: "fade",
          fill: "#ffffff",
          stroke: "#2f6fed",
          strokeWidth: 5,
          radius: 18,
        },
        {
          id: makeId(),
          type: "text",
          x: 135,
          y: 304,
          width: 220,
          height: 58,
          rotation: -2,
          zIndex: 3,
          reveal: 1,
          animation: "fade",
          text: "Slide",
          fontSize: 38,
          fontWeight: 800,
          textAlign: "left",
          fill: "#111827",
          stroke: "#111827",
          strokeWidth: 0,
        },
        {
          id: makeId(),
          type: "arrow",
          x: 438,
          y: 315,
          width: 250,
          height: 18,
          rotation: 0,
          zIndex: 4,
          reveal: 2,
          animation: "slide-left",
          fill: "#f97316",
          stroke: "#f97316",
          strokeWidth: 8,
        },
        {
          id: makeId(),
          type: "circle",
          x: 740,
          y: 245,
          width: 182,
          height: 182,
          rotation: 0,
          zIndex: 5,
          reveal: 2,
          animation: "zoom",
          fill: "#14b8a6",
          stroke: "#0f766e",
          strokeWidth: 5,
        },
      ],
    },
  ],
});

export default function Home() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const slideCarouselRef = useRef<HTMLDivElement | null>(null);
  const undoStackRef = useRef<WorkspaceNamespace[][]>([]);
  const saveProjectsTimerRef = useRef<number | null>(null);
  const editingTextDraftRef = useRef("");
  const editingTextHtmlDraftRef = useRef("");
  const editingTextNodeRef = useRef<HTMLDivElement | null>(null);
  const editingTextFocusModeRef = useRef<TextEditFocusMode>("end");
  const editingTextPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastTextPointerDownRef = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  const savedTextSelectionRef = useRef<Range | null>(null);
  const textStyleControlPointerDownRef = useRef(false);
  const canvasPanRef = useRef<CanvasPanState | null>(null);
  const centeredCanvasSlideRef = useRef("");
  const spacePanRef = useRef(false);
  const [namespaces, setNamespaces] = useState<WorkspaceNamespace[]>([]);
  const [elementPreferences, setElementPreferences] = useState<ElementStylePreferences>(defaultElementPreferences);
  const [activeNamespaceId, setActiveNamespaceId] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeSlideId, setActiveSlideId] = useState("");
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [editingTextId, setEditingTextId] = useState("");
  const [editingTextValue, setEditingTextValue] = useState("");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [slideContextMenu, setSlideContextMenu] = useState<SlideContextMenuState>(null);
  const [namespaceContextMenu, setNamespaceContextMenu] = useState<NamespaceContextMenuState>(null);
  const [contextSubmenu, setContextSubmenu] = useState<ContextSubmenu>(null);
  const [clipboardElements, setClipboardElements] = useState<SlideElement[]>([]);
  const [clipboardSlide, setClipboardSlide] = useState<Slide | null>(null);
  const [draggedSlideId, setDraggedSlideId] = useState("");
  const [slideDropIndicator, setSlideDropIndicator] = useState<SlideDropIndicator>(null);
  const [slideDeleteCandidateId, setSlideDeleteCandidateId] = useState("");
  const [presenting, setPresenting] = useState(false);
  const [presentReveal, setPresentReveal] = useState(1);
  const [namespaceMenuOpen, setNamespaceMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasBaseWidth, setCanvasBaseWidth] = useState(1180);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [showRevealNumbers, setShowRevealNumbers] = useState(defaultUserSettings().showRevealNumbers);
  const [showEditGrid, setShowEditGrid] = useState(defaultUserSettings().showEditGrid);
  const [showPreviewGrid, setShowPreviewGrid] = useState(defaultUserSettings().showPreviewGrid);
  const [renamingNamespaceId, setRenamingNamespaceId] = useState("");
  const [renamingNamespaceName, setRenamingNamespaceName] = useState("");
  const [namespaceDeleteCandidateId, setNamespaceDeleteCandidateId] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
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
          if (!nextNamespaces.some((namespace) => namespace.id === nextActiveNamespaceId)) {
            nextActiveNamespaceId = nextNamespaces[0].id;
          }
        }
        const savedPreferences = window.localStorage.getItem(preferencesKey);
        if (savedPreferences) {
          setElementPreferences(normalizeElementPreferences(JSON.parse(savedPreferences) as Partial<Record<ElementType, Partial<SlideElement>>>));
        }
        try {
          const savedSettings = window.localStorage.getItem(userSettingsKey);
          if (savedSettings) {
            const nextSettings = normalizeUserSettings(JSON.parse(savedSettings) as Partial<UserSettings>);
            setShowRevealNumbers(nextSettings.showRevealNumbers);
            setShowEditGrid(nextSettings.showEditGrid);
            setShowPreviewGrid(nextSettings.showPreviewGrid);
          }
        } catch {
          window.localStorage.removeItem(userSettingsKey);
        }
      } catch {
        nextNamespaces = [makeDefaultNamespace([starterProject()], Date.now())];
        nextActiveNamespaceId = nextNamespaces[0].id;
      }
      if (cancelled) return;
      const routeParams = new URLSearchParams(window.location.search);
      const requestedNamespaceId = routeParams.get("namespace") ?? "";
      const requestedProjectId = routeParams.get("project") ?? "";
      const requestedSlideId = routeParams.get("slide") ?? "";
      const requestedNamespace = requestedNamespaceId
        ? nextNamespaces.find((namespace) => namespace.id === requestedNamespaceId)
        : undefined;
      const namespaceWithRequestedProject = requestedProjectId
        ? nextNamespaces.find((namespace) => namespace.projects.some((project) => project.id === requestedProjectId))
        : undefined;
      const nextActiveNamespace = requestedNamespace ?? namespaceWithRequestedProject ?? nextNamespaces.find((namespace) => namespace.id === nextActiveNamespaceId) ?? nextNamespaces[0];
      const nextProject = (requestedProjectId
        ? nextActiveNamespace.projects.find((project) => project.id === requestedProjectId)
        : undefined) ?? nextActiveNamespace.projects[0];
      const nextSlide = (requestedSlideId
        ? nextProject?.slides.find((slide) => slide.id === requestedSlideId)
        : undefined) ?? nextProject?.slides[0];
      setNamespaces(nextNamespaces);
      setActiveNamespaceId(nextActiveNamespace.id);
      setActiveProjectId(nextProject?.id ?? "");
      setActiveSlideId(nextSlide?.id ?? "");
      setLoaded(true);
    };

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveProjectsTimerRef.current !== null) window.clearTimeout(saveProjectsTimerRef.current);
    const namespacesToSave = namespaces;
    const activeNamespaceToSave = activeNamespaceId;

    saveProjectsTimerRef.current = window.setTimeout(() => {
      const workspace = { namespaces: namespacesToSave, activeNamespaceId: activeNamespaceToSave };
      void writeWorkspaceToDb(workspace);
      void writeNamespacesToRemote(namespacesToSave, activeNamespaceToSave);
      if (namespacesToSave.some((namespace) => hasLargeEmbeddedMedia(namespace.projects))) return;

      try {
        window.localStorage.setItem(namespaceStorageKey, JSON.stringify(workspace));
      } catch {
        // Large pasted images are persisted in IndexedDB; localStorage is only a small compatibility cache.
      }
    }, 500);

    return () => {
      if (saveProjectsTimerRef.current !== null) {
        window.clearTimeout(saveProjectsTimerRef.current);
        saveProjectsTimerRef.current = null;
      }
    };
  }, [activeNamespaceId, loaded, namespaces]);

  useEffect(() => {
    if (!loaded) return;
    try {
      const savedPreferences = JSON.parse(window.localStorage.getItem(preferencesKey) ?? "{}") as Partial<Record<ElementType, Partial<SlideElement>>>;
      const nextPreferences: Partial<Record<ElementType, Partial<SlideElement>>> = { ...savedPreferences };
      (Object.keys(elementPreferences) as ElementType[]).forEach((type) => {
        nextPreferences[type] = {
          ...(savedPreferences[type] ?? {}),
          ...elementPreferences[type],
        };
      });
      window.localStorage.setItem(preferencesKey, JSON.stringify(nextPreferences));
    } catch {
      window.localStorage.setItem(preferencesKey, JSON.stringify(elementPreferences));
    }
  }, [elementPreferences, loaded]);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(userSettingsKey, JSON.stringify({
      showRevealNumbers,
      showEditGrid,
      showPreviewGrid,
    }));
  }, [loaded, showEditGrid, showPreviewGrid, showRevealNumbers]);

  useEffect(() => {
    if (!activeSlideId) return;
    slideCarouselRef.current
      ?.querySelector(`[data-slide-id="${CSS.escape(activeSlideId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSlideId]);

  useEffect(() => {
    if (!loaded) return;
    const node = canvasWrapRef.current;
    if (!node) return;

    const handleCanvasWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const contentX = node.scrollLeft + cursorX;
      const contentY = node.scrollTop + cursorY;
      const panPadding = Math.max(420, Math.round(canvasBaseWidth * 0.45));

      setCanvasZoom((current) => {
        const next = clamp(current * Math.exp(-event.deltaY * 0.0015), minCanvasZoom, maxCanvasZoom);
        if (Math.abs(next - current) < 0.001) return current;
        const zoomRatio = next / current;

        window.requestAnimationFrame(() => {
          node.scrollLeft = (contentX - panPadding) * zoomRatio + panPadding - cursorX;
          node.scrollTop = (contentY - panPadding) * zoomRatio + panPadding - cursorY;
        });

        return Number(next.toFixed(3));
      });
    };

    node.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleCanvasWheel);
  }, [canvasBaseWidth, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const node = canvasWrapRef.current;
    if (!node) return;

    const updateCanvasBaseWidth = () => {
      const style = window.getComputedStyle(node);
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const availableWidth = Math.max(320, node.clientWidth - horizontalPadding);
      setCanvasBaseWidth(Math.min(1180, availableWidth));
    };

    updateCanvasBaseWidth();
    const resizeObserver = new ResizeObserver(updateCanvasBaseWidth);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [loaded]);

  useEffect(() => {
    const centerKey = `${activeSlideId}:${canvasBaseWidth}`;
    if (!loaded || !activeSlideId || centeredCanvasSlideRef.current === centerKey) return;
    const node = canvasWrapRef.current;
    if (!node) return;

    centeredCanvasSlideRef.current = centerKey;
    window.requestAnimationFrame(() => {
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
      node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) / 2);
    });
  }, [activeSlideId, loaded, canvasBaseWidth]);

  useEffect(() => {
    const targetIsEditing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        editingTextId ||
          element?.tagName === "INPUT" ||
          element?.tagName === "TEXTAREA" ||
          element?.tagName === "SELECT" ||
          element?.isContentEditable,
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || targetIsEditing(event.target)) return;
      spacePanRef.current = true;
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePanRef.current = false;
    };
    const clearSpacePan = () => {
      spacePanRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearSpacePan);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearSpacePan);
    };
  }, [editingTextId]);

  const startCanvasPan = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const startedOnStage = Boolean(target?.closest(".stage"));
    const shouldPan = event.button === 1 || spacePanRef.current || !startedOnStage;
    if (!shouldPan) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    canvasPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    setIsCanvasPanning(true);
    setContextMenu(null);
    setContextSubmenu(null);
    setSlideContextMenu(null);
    setNamespaceContextMenu(null);
  };

  const moveCanvasPan = (event: PointerEvent<HTMLDivElement>) => {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const stopCanvasPan = (event: PointerEvent<HTMLDivElement>) => {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    canvasPanRef.current = null;
    setIsCanvasPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const preventMiddleMouseAutoscroll = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
  };

  const activeNamespace = namespaces.find((namespace) => namespace.id === activeNamespaceId) ?? namespaces[0];
  const projects = activeNamespace?.projects ?? [];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const activeSlide = activeProject?.slides.find((slide) => slide.id === activeSlideId) ?? activeProject?.slides[0];
  const selectedElements = activeSlide?.elements.filter((element) => selectedElementIds.includes(element.id)) ?? [];
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const selectionBounds = getBounds(selectedElements);
  const activeSlideIndex = activeProject?.slides.findIndex((slide) => slide.id === activeSlide?.id) ?? 0;
  const getElementMaxReveal = (element: SlideElement) =>
    element.type === "file-tree"
      ? element.reveal + Math.max(0, getFileTreeRows(element.text ?? "").length - 1)
      : element.reveal;
  const maxReveal = Math.max(1, ...(activeSlide?.elements.map(getElementMaxReveal) ?? [1]));
  const expandElementIds = (ids: string[]) => {
    if (!activeSlide) return ids;
    const expanded = new Set<string>();

    ids.forEach((id) => {
      const element = activeSlide.elements.find((item) => item.id === id);
      if (!element?.groupId) {
        expanded.add(id);
        return;
      }

      activeSlide.elements
        .filter((item) => item.groupId === element.groupId)
        .forEach((item) => expanded.add(item.id));
    });

    return [...expanded];
  };
  const getContextTargetIds = () => {
    const ids =
      contextMenu?.elementId && !selectedElementIds.includes(contextMenu.elementId)
        ? [contextMenu.elementId]
        : selectedElementIds.length > 0
          ? selectedElementIds
          : contextMenu?.elementId
            ? [contextMenu.elementId]
            : [];

    return expandElementIds(ids);
  };
  const contextTargetIds = contextMenu ? getContextTargetIds() : [];
  const contextTargets = activeSlide?.elements.filter((element) => contextTargetIds.includes(element.id)) ?? [];
  const canGroupContextTargets = contextTargets.length > 1;
  const canUngroupContextTargets = contextTargets.some((element) => element.groupId);

  const pushUndoSnapshot = (snapshot = namespaces) => {
    const historyLimit = snapshot.some((namespace) => hasLargeEmbeddedMedia(namespace.projects)) ? 12 : 80;
    undoStackRef.current = [...undoStackRef.current.slice(-(historyLimit - 1)), cloneNamespaces(snapshot)];
  };

  const undoLastChange = () => {
    const previousNamespaces = undoStackRef.current.at(-1);
    if (!previousNamespaces) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setDragState(null);
    setMarqueeSelection(null);
    setPendingPlacement(null);
    setAlignmentGuides([]);
    setContextMenu(null);
    setNamespaceContextMenu(null);
    setSlideContextMenu(null);
    finishTextEditing(false);
    setNamespaces(previousNamespaces);
    const nextActiveNamespace = previousNamespaces.find((namespace) => namespace.id === activeNamespaceId) ?? previousNamespaces[0];
    const nextProjects = nextActiveNamespace?.projects ?? [];
    const nextActiveProject = nextProjects.find((project) => project.id === activeProjectId) ?? nextProjects[0];
    const nextActiveSlide = nextActiveProject?.slides.find((slide) => slide.id === activeSlideId) ?? nextActiveProject?.slides[0];
    setActiveNamespaceId(nextActiveNamespace?.id ?? "");
    setActiveProjectId(nextActiveProject?.id ?? "");
    setActiveSlideId(nextActiveSlide?.id ?? "");
    setSelectedElementIds((current) =>
      current.filter((id) => nextActiveSlide?.elements.some((element) => element.id === id)),
    );
  };

  const commitProjects = (updater: (project: Project) => Project, options: { history?: boolean } = {}) => {
    if (!activeProject || !activeNamespace) return;
    setNamespaces((current) =>
      current.map((namespace) => {
        if (namespace.id !== activeNamespace.id) return namespace;
        const nextProjects = namespace.projects.map((project) => {
        if (project.id !== activeProject.id) return project;
        if (options.history !== false) pushUndoSnapshot(current);
        return { ...updater(project), updatedAt: Date.now() };
        });
        return { ...namespace, updatedAt: Date.now(), projects: nextProjects };
      }),
    );
  };

  const commitSlide = (updater: (slide: Slide) => Slide, options?: { history?: boolean }) => {
    if (!activeSlide) return;
    commitProjects((project) => ({
      ...project,
      slides: project.slides.map((slide) => (slide.id === activeSlide.id ? updater(slide) : slide)),
    }), options);
  };

  const commitElement = (elementId: string, patch: Partial<SlideElement>, options?: { history?: boolean }) => {
    const elementType = activeSlide?.elements.find((element) => element.id === elementId)?.type;
    const preferencePatch: ElementStylePreferences[ElementType] = {};
    (["fill", "stroke"] as const).forEach((key) => {
      if (key in patch) {
        preferencePatch[key] = patch[key] as never;
      }
    });
    if (elementType && Object.keys(preferencePatch).length > 0) {
      setElementPreferences((current) => ({
        ...current,
        [elementType]: { ...current[elementType], ...preferencePatch },
      }));
    }
    commitSlide((slide) => ({
      ...slide,
      elements: slide.elements.map((element) => (element.id === elementId ? { ...element, ...patch } : element)),
    }), options);
  };

  const snapBounds = (bounds: Bounds, ignoredIds: string[]) => {
    const candidates = {
      vertical: [0, canvasWidth / 2, canvasWidth],
      horizontal: [0, canvasHeight / 2, canvasHeight],
    };
    activeSlide?.elements
      .filter((element) => !ignoredIds.includes(element.id))
      .forEach((element) => {
        const anchors = getSnapAnchors(element);
        candidates.vertical.push(...anchors.vertical.map((anchor) => anchor.position));
        candidates.horizontal.push(...anchors.horizontal.map((anchor) => anchor.position));
      });

    const anchors = getSnapAnchors(bounds);
    let snapX = 0;
    let snapY = 0;
    let bestX = snapThreshold + 1;
    let bestY = snapThreshold + 1;
    const guides: AlignmentGuide[] = [];

    anchors.vertical.forEach((anchor) => {
      candidates.vertical.forEach((candidate) => {
        const delta = candidate - anchor.position;
        if (Math.abs(delta) < Math.abs(bestX)) {
          bestX = delta;
          snapX = delta;
        }
      });
    });

    anchors.horizontal.forEach((anchor) => {
      candidates.horizontal.forEach((candidate) => {
        const delta = candidate - anchor.position;
        if (Math.abs(delta) < Math.abs(bestY)) {
          bestY = delta;
          snapY = delta;
        }
      });
    });

    const gridDeltaX = Math.round(bounds.x / gridSize) * gridSize - bounds.x;
    const gridDeltaY = Math.round(bounds.y / gridSize) * gridSize - bounds.y;
    if (Math.abs(gridDeltaX) < Math.abs(bestX)) snapX = gridDeltaX;
    if (Math.abs(gridDeltaY) < Math.abs(bestY)) snapY = gridDeltaY;

    const snappedBounds = {
      ...bounds,
      x: Math.round(clamp(bounds.x + (Math.abs(snapX) <= snapThreshold ? snapX : 0), 0, canvasWidth - bounds.width)),
      y: Math.round(clamp(bounds.y + (Math.abs(snapY) <= snapThreshold ? snapY : 0), 0, canvasHeight - bounds.height)),
    };
    const snappedAnchors = getSnapAnchors(snappedBounds);

    if (Math.abs(snapX) <= snapThreshold) {
      const position = snappedAnchors.vertical.find((anchor) =>
        candidates.vertical.some((candidate) => Math.abs(candidate - anchor.position) < 0.5),
      )?.position;
      if (typeof position === "number") guides.push({ orientation: "vertical", position });
    }

    if (Math.abs(snapY) <= snapThreshold) {
      const position = snappedAnchors.horizontal.find((anchor) =>
        candidates.horizontal.some((candidate) => Math.abs(candidate - anchor.position) < 0.5),
      )?.position;
      if (typeof position === "number") guides.push({ orientation: "horizontal", position });
    }

    return { bounds: snappedBounds, guides };
  };

  const setSelectedAnimation = (animation: RevealAnimation) => {
    const ids = getContextTargetIds();
    ids.forEach((id) => commitElement(id, { animation }));
    setContextMenu(null);
  };

  const setContextElementsPatch = (patch: Partial<SlideElement>) => {
    const ids = getContextTargetIds();
    ids.forEach((id) => commitElement(id, patch));
    setContextMenu(null);
  };

  const moveContextElementsZ = (direction: "front" | "back" | "forward" | "backward") => {
    if (!activeSlide) return;
    const ids = getContextTargetIds();
    const selectedIds = new Set(ids);
    const orderedElements = [...activeSlide.elements].sort((first, second) => first.zIndex - second.zIndex || first.id.localeCompare(second.id));

    if (direction === "front") {
      orderedElements.sort((first, second) => Number(selectedIds.has(first.id)) - Number(selectedIds.has(second.id)));
    } else if (direction === "back") {
      orderedElements.sort((first, second) => Number(selectedIds.has(second.id)) - Number(selectedIds.has(first.id)));
    } else if (direction === "forward") {
      for (let index = orderedElements.length - 2; index >= 0; index -= 1) {
        if (!selectedIds.has(orderedElements[index].id) || selectedIds.has(orderedElements[index + 1].id)) continue;
        [orderedElements[index], orderedElements[index + 1]] = [orderedElements[index + 1], orderedElements[index]];
      }
    } else {
      for (let index = 1; index < orderedElements.length; index += 1) {
        if (!selectedIds.has(orderedElements[index].id) || selectedIds.has(orderedElements[index - 1].id)) continue;
        [orderedElements[index], orderedElements[index - 1]] = [orderedElements[index - 1], orderedElements[index]];
      }
    }

    const nextZById = new Map(orderedElements.map((element, index) => [element.id, index + 1]));
    commitSlide((slide) => ({
      ...slide,
      elements: slide.elements.map((element) => ({
        ...element,
        zIndex: nextZById.get(element.id) ?? Math.max(1, element.zIndex),
      })),
    }));
    setContextMenu(null);
  };

  const handleIndentTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();

    const textarea = event.currentTarget;
    const indent = "  ";
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const selectionLineEnd = value.indexOf("\n", selectionEnd);
    const lineEnd = selectionLineEnd === -1 ? value.length : selectionLineEnd;

    if (!event.shiftKey && selectionStart === selectionEnd) {
      const nextValue = `${value.slice(0, selectionStart)}${indent}${value.slice(selectionEnd)}`;
      commitElement(selectedElement!.id, { text: nextValue });
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + indent.length;
        textarea.selectionEnd = selectionStart + indent.length;
      });
      return;
    }

    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    let lineOffset = 0;
    let selectionStartDelta = 0;
    let selectionEndDelta = 0;
    const nextLines = event.shiftKey
      ? lines.map((line) => {
          const removed = line.startsWith(indent) ? indent.length : line.startsWith(" ") ? 1 : 0;
          if (selectionStart > lineStart + lineOffset) selectionStartDelta -= removed;
          if (selectionEnd > lineStart + lineOffset) selectionEndDelta -= removed;
          lineOffset += line.length + 1;
          return line.slice(removed);
        })
      : lines.map((line) => {
          if (selectionStart > lineStart + lineOffset) selectionStartDelta += indent.length;
          if (selectionEnd > lineStart + lineOffset) selectionEndDelta += indent.length;
          lineOffset += line.length + 1;
          return `${indent}${line}`;
        });
    const nextBlock = nextLines.join("\n");
    const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;

    commitElement(selectedElement!.id, { text: nextValue });
    requestAnimationFrame(() => {
      textarea.selectionStart = Math.max(lineStart, selectionStart + selectionStartDelta);
      textarea.selectionEnd = Math.max(textarea.selectionStart, selectionEnd + selectionEndDelta);
    });
  };

  const groupContextElements = () => {
    if (!activeSlide) return;
    const ids = getContextTargetIds();
    if (ids.length < 2) return;
    const selectedReveal = Math.min(...activeSlide.elements.filter((element) => ids.includes(element.id)).map((element) => element.reveal));
    const groupId = makeId();

    commitSlide((slide) => ({
      ...slide,
      elements: slide.elements.map((element) =>
        ids.includes(element.id)
          ? {
              ...element,
              groupId,
              reveal: selectedReveal,
            }
          : element,
      ),
    }));
    setSelectedElementIds(ids);
    setContextMenu(null);
    setContextSubmenu(null);
  };

  const ungroupContextElements = () => {
    const ids = getContextTargetIds();
    if (ids.length === 0) return;

    commitSlide((slide) => ({
      ...slide,
      elements: slide.elements.map((element) =>
        ids.includes(element.id)
          ? {
              ...element,
              groupId: undefined,
            }
          : element,
      ),
    }));
    setSelectedElementIds(ids);
    setContextMenu(null);
    setContextSubmenu(null);
  };

  const startTextEditing = (
    element: SlideElement,
    focusMode: TextEditFocusMode = "end",
    pointer?: { x: number; y: number },
  ) => {
    if (element.type !== "text" && element.type !== "code") return;
    const nextHtml = element.textHtml ?? textToHtml(element.text ?? "");
    setSelectedElementIds([element.id]);
    setEditingTextId(element.id);
    editingTextFocusModeRef.current = focusMode;
    editingTextPointerRef.current = pointer ?? null;
    editingTextDraftRef.current = element.text ?? "";
    editingTextHtmlDraftRef.current = element.type === "code" ? element.text ?? "" : nextHtml;
    setEditingTextValue(element.type === "code" ? element.text ?? "" : nextHtml);
    setDragState(null);
  };

  const finishTextEditing = (save: boolean) => {
    if (editingTextId && save) {
      const element = activeSlide?.elements.find((item) => item.id === editingTextId);
      if (element?.type === "code") {
        commitElement(editingTextId, { text: editingTextDraftRef.current });
        setEditingTextId("");
        setEditingTextValue("");
        editingTextDraftRef.current = "";
        editingTextHtmlDraftRef.current = "";
        editingTextFocusModeRef.current = "end";
        editingTextPointerRef.current = null;
        editingTextNodeRef.current = null;
        savedTextSelectionRef.current = null;
        return;
      }
      const fontSize = element?.fontSize ?? 36;
      const fontWeight = element?.fontWeight ?? 800;
      const nextHtml = sanitizeRichTextHtml(editingTextHtmlDraftRef.current);
      const nextText = htmlToPlainText(nextHtml);
      const richMetrics = getRichTextMetrics(nextHtml, fontSize, fontWeight);
      const nextBounds = element?.textAutoSize
        ? getTextAutoBounds({ text: nextText, fontSize: richMetrics.fontSize, fontWeight: richMetrics.fontWeight }, { x: element.x, y: element.y })
        : estimateTextBounds(nextText, richMetrics.fontSize, element?.width, richMetrics.fontWeight);
      commitElement(editingTextId, {
        text: nextText,
        textHtml: nextHtml,
        ...nextBounds,
      });
    }
    setEditingTextId("");
    setEditingTextValue("");
    editingTextDraftRef.current = "";
    editingTextHtmlDraftRef.current = "";
    editingTextFocusModeRef.current = "end";
    editingTextPointerRef.current = null;
    editingTextNodeRef.current = null;
    savedTextSelectionRef.current = null;
  };

  const textRangeBelongsToEditor = (range: Range | null, editor: HTMLDivElement) => {
    try {
      return Boolean(range && editor.contains(range.commonAncestorContainer));
    } catch {
      return false;
    }
  };

  const getTextRangeInEditor = (editor: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    return textRangeBelongsToEditor(range, editor) ? range.cloneRange() : null;
  };

  const restoreTextRange = (editor: HTMLDivElement, range: Range | null) => {
    if (!textRangeBelongsToEditor(range, editor)) return null;

    const selection = window.getSelection();
    if (!selection) return null;

    try {
      editor.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(range!);
      savedTextSelectionRef.current = range!.cloneRange();
      return range!;
    } catch {
      return null;
    }
  };

  const selectRichTextNodeContents = (node: Node) => {
    const nextRange = document.createRange();
    nextRange.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    savedTextSelectionRef.current = nextRange.cloneRange();
  };

  const syncRichTextDraftFromEditor = (editor: HTMLDivElement) => {
    editingTextHtmlDraftRef.current = sanitizeRichTextHtml(editor.innerHTML);
    editingTextDraftRef.current = editor.innerText.replace(/\n$/, "");
  };

  const saveTextSelection = () => {
    const editor = editingTextNodeRef.current;
    if (!editor) return;
    const range = getTextRangeInEditor(editor);
    if (range) savedTextSelectionRef.current = range;
  };

  useEffect(() => {
    if (!editingTextId) return;
    document.addEventListener("selectionchange", saveTextSelection);
    return () => document.removeEventListener("selectionchange", saveTextSelection);
  });

  const runTextStyleControl = (event: PointerEvent<HTMLButtonElement>, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    textStyleControlPointerDownRef.current = true;
    action();
    requestAnimationFrame(() => {
      textStyleControlPointerDownRef.current = false;
    });
  };

  const applyRichTextCommand = (command: "bold" | "italic") => {
    const editor = editingTextNodeRef.current;
    if (!editor) return;

    const range = restoreTextRange(editor, getTextRangeInEditor(editor) ?? savedTextSelectionRef.current);
    if (!range) return;

    if (range.collapsed) {
      document.execCommand(command);
      syncRichTextDraftFromEditor(editor);
      saveTextSelection();
      return;
    }

    const wrapper = document.createElement(command === "bold" ? "strong" : "em");
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
    selectRichTextNodeContents(wrapper);
    syncRichTextDraftFromEditor(editor);
  };

  const applyRichTextStyle = (style: Partial<Pick<CSSStyleDeclaration, "fontSize" | "fontWeight">>) => {
    const editor = editingTextNodeRef.current;
    if (!editor) return;

    const range = restoreTextRange(editor, getTextRangeInEditor(editor) ?? savedTextSelectionRef.current);
    if (!range || range.collapsed) return;

    const span = document.createElement("span");
    if (style.fontSize) span.style.fontSize = style.fontSize;
    if (style.fontWeight) span.style.fontWeight = style.fontWeight;
    span.append(range.extractContents());
    range.insertNode(span);

    selectRichTextNodeContents(span);
    syncRichTextDraftFromEditor(editor);
  };

  const getSelectedRichTextStyle = () => {
    const editor = editingTextNodeRef.current;
    const range = savedTextSelectionRef.current;
    const baseFontSize = selectedElement?.fontSize ?? 36;
    const baseFontWeight = selectedElement?.fontWeight ?? 800;
    if (!editor || !range) return { fontSize: baseFontSize, fontWeight: baseFontWeight };

    const boundaryNode =
      range.startContainer instanceof Element && range.startContainer.childNodes[range.startOffset]
        ? range.startContainer.childNodes[range.startOffset]
        : range.startContainer;
    let element = boundaryNode instanceof HTMLElement ? boundaryNode : boundaryNode.parentElement;

    while (element && element !== editor) {
      const style = element.getAttribute("style") ?? "";
      const fontSize = /font-size\s*:/i.test(style) ? parseRichTextFontSize(style, baseFontSize) : undefined;
      const fontWeight = style.match(/font-weight:\s*(\d+)/i)?.[1];
      if (fontSize || fontWeight) {
        return {
          fontSize: fontSize ?? baseFontSize,
          fontWeight: fontWeight ? Number(fontWeight) : baseFontWeight,
        };
      }
      element = element.parentElement;
    }

    return { fontSize: baseFontSize, fontWeight: baseFontWeight };
  };

  const applySelectedTextFontDelta = (delta: number) => {
    const baseSize = selectedElement?.fontSize ?? 36;
    const currentSize = getSelectedRichTextStyle().fontSize;
    applyRichTextStyle({ fontSize: formatRichTextFontSizePercent(currentSize + delta, baseSize) });
  };

  const applySelectedTextWeightDelta = (delta: number) => {
    const currentWeight = getSelectedRichTextStyle().fontWeight;
    applyRichTextStyle({ fontWeight: String(clamp(currentWeight + delta, 100, 900)) });
  };

  const focusTextEditor = (node: HTMLDivElement, focusMode: TextEditFocusMode) => {
    node.focus();
    const range = document.createRange();
    const pointer = editingTextPointerRef.current;
    if (focusMode === "pointer" && pointer) {
      const caretPosition = document.caretPositionFromPoint?.(pointer.x, pointer.y);
      const legacyDocument = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const caretRange = caretPosition
        ? (() => {
            const nextRange = document.createRange();
            nextRange.setStart(caretPosition.offsetNode, caretPosition.offset);
            nextRange.collapse(true);
            return nextRange;
          })()
        : legacyDocument.caretRangeFromPoint?.(pointer.x, pointer.y);
      if (caretRange && node.contains(caretRange.commonAncestorContainer)) {
        range.setStart(caretRange.startContainer, caretRange.startOffset);
        range.collapse(true);
      } else {
        range.selectNodeContents(node);
        range.collapse(false);
      }
    } else {
      range.selectNodeContents(node);
      if (focusMode === "end") range.collapse(false);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    saveTextSelection();
  };

  const syncTextEditorDraft = (node: HTMLDivElement, type: ElementType) => {
    if (type === "code") {
      editingTextDraftRef.current = node.innerText.replace(/\n$/, "");
      editingTextHtmlDraftRef.current = editingTextDraftRef.current;
      return;
    }
    editingTextDraftRef.current = node.innerText.replace(/\n$/, "");
    editingTextHtmlDraftRef.current = sanitizeRichTextHtml(node.innerHTML);
  };

  const bindTextEditorNode = (node: HTMLDivElement | null, element: SlideElement) => {
    if (!node) return;
    const isNewEditor = editingTextNodeRef.current !== node;
    if (!isNewEditor) return;

    editingTextNodeRef.current = node;
    if (element.type === "code") {
      if (node.textContent !== editingTextValue) node.textContent = editingTextValue;
    } else if (node.innerHTML !== editingTextValue) {
      node.innerHTML = editingTextValue;
    }

    const focusMode = editingTextFocusModeRef.current;
    focusTextEditor(node, focusMode);
    requestAnimationFrame(() => {
      if (editingTextNodeRef.current !== node) return;
      focusTextEditor(node, focusMode);
      editingTextFocusModeRef.current = "end";
      editingTextPointerRef.current = null;
    });
  };

  const stagePoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - rect.left) * (canvasWidth / rect.width), 0, canvasWidth),
      y: clamp((clientY - rect.top) * (canvasHeight / rect.height), 0, canvasHeight),
    };
  };

  const elementLocalPoint = (element: SlideElement, point: { x: number; y: number }) => {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const angle = -(element.rotation ?? 0) * (Math.PI / 180);
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: clamp(dx * Math.cos(angle) - dy * Math.sin(angle) + element.width / 2, 0, element.width),
      y: clamp(dx * Math.sin(angle) + dy * Math.cos(angle) + element.height / 2, 0, element.height),
    };
  };

  const activeSlideMaxReveal = (slide: Slide) => Math.max(1, ...slide.elements.map(getElementMaxReveal));

  const showSlide = (slideId: string, reveal = 1) => {
    setActiveSlideId(slideId);
    setSelectedElementIds([]);
    setPresentReveal(reveal);
    setContextMenu(null);
    setSlideContextMenu(null);
  };

  const updateCanvasRoute = (namespaceId: string, projectId: string, slideId?: string) => {
    const params = new URLSearchParams();
    params.set("namespace", namespaceId);
    params.set("project", projectId);
    if (slideId) params.set("slide", slideId);
    window.history.replaceState(null, "", `/canvas?${params.toString()}`);
  };

  const presentNext = () => {
    if (!activeProject || !activeSlide) return;
    if (presentReveal < maxReveal) {
      setPresentReveal((current) => current + 1);
      return;
    }

    const nextSlide = activeProject.slides[activeSlideIndex + 1];
    if (nextSlide) showSlide(nextSlide.id, 1);
  };

  const presentPrev = () => {
    if (!activeProject) return;
    if (presentReveal > 1) {
      setPresentReveal((current) => current - 1);
      return;
    }

    const previousSlide = activeProject.slides[activeSlideIndex - 1];
    if (previousSlide) showSlide(previousSlide.id, activeSlideMaxReveal(previousSlide));
  };

  const switchNamespace = (namespaceId: string) => {
    const namespace = namespaces.find((item) => item.id === namespaceId);
    if (!namespace) return;
    const project = namespace.projects[0];
    setActiveNamespaceId(namespace.id);
    setActiveProjectId(project?.id ?? "");
    setActiveSlideId(project?.slides[0]?.id ?? "");
    setSelectedElementIds([]);
    setNamespaceMenuOpen(false);
    setProjectMenuOpen(false);
    setNamespaceContextMenu(null);
    if (project) updateCanvasRoute(namespace.id, project.id, project.slides[0]?.id);
  };

  const switchProject = (projectId: string) => {
    if (!activeNamespace) return;
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const slide = project.slides[0];
    setActiveProjectId(project.id);
    setActiveSlideId(slide?.id ?? "");
    setSelectedElementIds([]);
    setProjectMenuOpen(false);
    setContextMenu(null);
    setSlideContextMenu(null);
    updateCanvasRoute(activeNamespace.id, project.id, slide?.id);
  };

  const addNamespace = () => {
    const project = starterProject();
    const namespace: WorkspaceNamespace = {
      id: makeId(),
      name: `Namespace ${namespaces.length + 1}`,
      updatedAt: project.updatedAt,
      projects: [project],
    };
    pushUndoSnapshot();
    setNamespaces((current) => [namespace, ...current]);
    setActiveNamespaceId(namespace.id);
    setActiveProjectId(project.id);
    setActiveSlideId(project.slides[0]?.id ?? "");
    setSelectedElementIds([]);
    setNamespaceMenuOpen(false);
    setProjectMenuOpen(false);
    setNamespaceContextMenu(null);
  };

  const startRenameNamespace = (namespace: WorkspaceNamespace) => {
    setRenamingNamespaceId(namespace.id);
    setRenamingNamespaceName(namespace.name);
    setNamespaceContextMenu(null);
  };

  const commitNamespaceRename = () => {
    const nextName = renamingNamespaceName.trim();
    const namespaceId = renamingNamespaceId;
    if (!namespaceId) return;

    setRenamingNamespaceId("");
    setRenamingNamespaceName("");
    if (!nextName) return;

    setNamespaces((current) => {
      const target = current.find((namespace) => namespace.id === namespaceId);
      if (!target || target.name === nextName) return current;
      pushUndoSnapshot(current);
      return current.map((namespace) =>
        namespace.id === namespaceId
          ? { ...namespace, name: nextName, updatedAt: Date.now() }
          : namespace,
      );
    });
  };

  const cancelNamespaceRename = () => {
    setRenamingNamespaceId("");
    setRenamingNamespaceName("");
  };

  const requestDeleteNamespace = (namespaceId: string) => {
    setNamespaceDeleteCandidateId(namespaceId);
    setNamespaceContextMenu(null);
  };

  const deleteNamespace = (namespaceId: string) => {
    pushUndoSnapshot();
    const remainingNamespaces = namespaces.filter((namespace) => namespace.id !== namespaceId);
    const fallbackProject = starterProject();
    const fallbackNamespace = makeDefaultNamespace([fallbackProject], fallbackProject.updatedAt);
    const nextNamespaces = remainingNamespaces.length > 0 ? remainingNamespaces : [fallbackNamespace];
    const nextActiveNamespace =
      activeNamespaceId === namespaceId
        ? nextNamespaces[0]
        : nextNamespaces.find((namespace) => namespace.id === activeNamespaceId) ?? nextNamespaces[0];
    const nextProject = nextActiveNamespace.projects[0];

    setNamespaces(nextNamespaces);
    setActiveNamespaceId(nextActiveNamespace.id);
    setActiveProjectId(nextProject?.id ?? "");
    setActiveSlideId(nextProject?.slides[0]?.id ?? "");
    setSelectedElementIds([]);
    setNamespaceMenuOpen(false);
    setNamespaceContextMenu(null);
    setNamespaceDeleteCandidateId("");
    if (renamingNamespaceId === namespaceId) cancelNamespaceRename();
  };

  const addSlide = () => {
    if (!activeProject) return;
    const slide: Slide = {
      id: makeId(),
      title: `Slide ${activeProject.slides.length + 1}`,
      background: "#ffffff",
      transition: "fade",
      elements: [],
    };
    commitProjects((project) => ({ ...project, slides: [...project.slides, slide] }));
    showSlide(slide.id);
  };

  const deleteSlide = (slideId: string) => {
    if (!activeProject || activeProject.slides.length <= 1) return;
    const slideIndex = activeProject.slides.findIndex((slide) => slide.id === slideId);
    if (slideIndex < 0) return;

    const remainingSlides = activeProject.slides.filter((slide) => slide.id !== slideId);
    const nextActiveSlide =
      activeSlideId === slideId
        ? remainingSlides[Math.min(slideIndex, remainingSlides.length - 1)]
        : remainingSlides.find((slide) => slide.id === activeSlideId) ?? remainingSlides[0];

    commitProjects((project) => ({
      ...project,
      slides: project.slides.filter((slide) => slide.id !== slideId),
    }));
    setActiveSlideId(nextActiveSlide.id);
    setSelectedElementIds([]);
    setPresentReveal(1);
    setDraggedSlideId("");
    setSlideDropIndicator(null);
    setSlideContextMenu(null);
  };

  const requestDeleteSlide = (slideId: string) => {
    if (!activeProject || activeProject.slides.length <= 1) return;
    setSlideDeleteCandidateId(slideId);
    setSlideContextMenu(null);
  };

  const cloneSlideForInsert = (slide: Slide, title = `${slide.title} copy`): Slide => {
    const groupIdMap = new Map<string, string>();

    return {
      ...structuredClone(slide),
      id: makeId(),
      title,
      elements: slide.elements.map((element) => {
        const nextGroupId = element.groupId
          ? groupIdMap.get(element.groupId) ?? (() => {
              const id = makeId();
              groupIdMap.set(element.groupId, id);
              return id;
            })()
          : undefined;

        return {
          ...structuredClone(element),
          id: makeId(),
          groupId: nextGroupId,
        };
      }),
    };
  };

  const insertSlideAfterActive = (sourceSlide: Slide) => {
    if (!activeProject || !activeSlide) return;
    const sourceTitle = sourceSlide.title.trim() || "Untitled slide";
    const slide = cloneSlideForInsert(sourceSlide, `${sourceTitle} copy`);
    const insertIndex = activeProject.slides.findIndex((item) => item.id === activeSlide.id) + 1;
    commitProjects((project) => {
      const slides = [...project.slides];
      slides.splice(Math.max(0, insertIndex), 0, slide);
      return { ...project, slides };
    });
    setSelectedElementIds([]);
    setClipboardSlide(slide);
    showSlide(slide.id);
  };

  const duplicateActiveSlide = () => {
    if (!activeSlide) return;
    insertSlideAfterActive(activeSlide);
  };

  const handleSlideContextMenu = (event: MouseEvent<HTMLElement>, slideId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 170;
    const menuHeight = 48;
    const gap = 8;
    const rightX = rect.right + gap;
    const x = rightX + menuWidth <= window.innerWidth - gap ? rightX : Math.max(gap, rect.left - menuWidth - gap);
    const y = clamp(rect.top, gap, window.innerHeight - menuHeight - gap);

    showSlide(slideId);
    setContextSubmenu(null);
    setContextMenu(null);
    setSlideContextMenu({ x, y, slideId });
  };

  const getSlideInsertionIndex = (slides: Slide[], draggedId: string, targetId: string, placement: "before" | "after") => {
    const draggedIndex = slides.findIndex((slide) => slide.id === draggedId);
    const targetIndex = slides.findIndex((slide) => slide.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return null;

    const rawInsertionIndex = targetIndex + (placement === "after" ? 1 : 0);
    const insertionIndex = rawInsertionIndex > draggedIndex ? rawInsertionIndex - 1 : rawInsertionIndex;
    return insertionIndex === draggedIndex ? null : insertionIndex;
  };

  const moveSlideToPosition = (draggedId: string, targetId: string, placement: "before" | "after") => {
    if (!activeProject) return;
    const insertionIndex = getSlideInsertionIndex(activeProject.slides, draggedId, targetId, placement);
    if (insertionIndex === null) return;

    commitProjects((project) => {
      const draggedIndex = project.slides.findIndex((slide) => slide.id === draggedId);
      if (draggedIndex < 0) return project;
      const slides = [...project.slides];
      const [draggedSlide] = slides.splice(draggedIndex, 1);
      slides.splice(insertionIndex, 0, draggedSlide);
      return { ...project, slides };
    });
  };

  const handleSlideDragStart = (event: ReactDragEvent<HTMLElement>, slideId: string) => {
    setDraggedSlideId(slideId);
    setSlideDropIndicator(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slideId);
  };

  const handleSlideDragOver = (event: ReactDragEvent<HTMLElement>, slideId: string) => {
    const draggedId = draggedSlideId || event.dataTransfer.getData("text/plain");
    if (!activeProject || !draggedId || draggedId === slideId) {
      setSlideDropIndicator(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = rect.width > rect.height
      ? event.clientX < rect.left + rect.width / 2 ? "before" : "after"
      : event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (getSlideInsertionIndex(activeProject.slides, draggedId, slideId, placement) === null) {
      setSlideDropIndicator(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSlideDropIndicator({ slideId, placement });
  };

  const handleSlideDrop = (event: ReactDragEvent<HTMLElement>, slideId: string) => {
    event.preventDefault();
    const draggedId = draggedSlideId || event.dataTransfer.getData("text/plain");
    const rect = event.currentTarget.getBoundingClientRect();
    const fallbackPlacement = rect.width > rect.height
      ? event.clientX < rect.left + rect.width / 2 ? "before" : "after"
      : event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const placement = slideDropIndicator?.slideId === slideId ? slideDropIndicator.placement : fallbackPlacement;
    setDraggedSlideId("");
    setSlideDropIndicator(null);
    moveSlideToPosition(draggedId, slideId, placement);
  };

  const handleSlideDragEnd = () => {
    setDraggedSlideId("");
    setSlideDropIndicator(null);
  };

  const makeElement = (type: ElementType, textPreset?: TextPreset, center?: { x: number; y: number }): SlideElement => {
    const isLine = type === "line" || type === "dashed-line" || arrowTypes.includes(type);
    const isBorderOnly = type === "border-rect" || type === "border-circle" || isLine;
    const isSolidShape = ["cube", "sphere", "cylinder"].includes(type);
    const isCode = type === "code";
    const isFileTree = type === "file-tree";
    const isTable = type === "table";
    const offset = ((activeSlide?.elements.length ?? 0) % 6) * 28;
    const preset = textPreset ? textPresets[textPreset] : textPresets.body;
    const preferences = elementPreferences[type];
    const defaultText = isCode
      ? "const hello = 'world';"
      : isFileTree
        ? "src/\n  app/\n    page.tsx\n    globals.css\n  components/\n    Button.tsx\npackage.json"
        : isTable
          ? "Metric\tQ1\tQ2\tQ3\nUsers\t12k\t18k\t24k\nRevenue\t$42k\t$58k\t$73k\nGrowth\t14%\t22%\t26%"
        : preset.text;
    const fontSize = type === "text" ? preset.fontSize : isCode ? 14 : isFileTree || isTable ? 18 : 36;
    const fontWeight = type === "text" ? preset.fontWeight : undefined;
    const textBounds = estimateTextBounds(defaultText, fontSize, undefined, fontWeight);
    const width = type === "text" ? textBounds.width : isCode ? 480 : isFileTree ? 420 : isTable ? 560 : isLine ? 280 : isSolidShape ? 170 : 210;
    const height = type === "text" ? textBounds.height : isCode ? 240 : isFileTree ? 280 : isTable ? 260 : type === "bend-arrow" ? 120 : isLine ? 24 : isSolidShape ? 170 : 140;
    const x = center ? center.x - width / 2 : 180 + offset;
    const y = center ? center.y - height / 2 : 150 + offset;
    const bendArrowPoints = type === "bend-arrow" ? getDefaultBendArrowPoints(width, height, 8) : null;

    return {
      id: makeId(),
      type,
      x: Math.round(clamp(x, 0, canvasWidth - width)),
      y: Math.round(clamp(y, 0, canvasHeight - height)),
      width,
      height,
      rotation: 0,
      pitch: isSolidShape ? defaultThreeAngles.pitch : undefined,
      yaw: isSolidShape ? defaultThreeAngles.yaw : undefined,
      roll: isSolidShape ? defaultThreeAngles.roll : undefined,
      zIndex: Math.max(0, ...(activeSlide?.elements.map((element) => element.zIndex) ?? [0])) + 1,
      reveal: 1,
      animation: "fade",
      text: type === "text" || isCode || isFileTree || isTable ? defaultText : undefined,
      textHtml: type === "text" ? textToHtml(defaultText) : undefined,
      fontSize,
      fontWeight,
      textAlign: type === "text" ? "left" : undefined,
      textAutoSize: type === "text" ? true : undefined,
      fill: type === "text" ? preferences.fill ?? "#111827" : isBorderOnly ? "transparent" : preferences.fill ?? "#ffffff",
      stroke: preferences.stroke ?? "#111827",
      strokeWidth: type === "text" ? 0 : isCode ? 1 : isLine ? 8 : isBorderOnly ? 4 : 0,
      radius: isCode || isFileTree || isTable ? 8 : 16,
      language: isCode ? "javascript" : undefined,
      curveStart: bendArrowPoints?.start,
      curveEnd: bendArrowPoints?.end,
      curveControl: bendArrowPoints?.control,
    };
  };

  const insertElement = (element: SlideElement) => {
    commitSlide((slide) => ({ ...slide, elements: [...slide.elements, element] }));
    if (element.type === "text" || element.type === "code") {
      startTextEditing(element, "select-all");
      return;
    }
    setSelectedElementIds([element.id]);
  };

  const addElement = (type: ElementType, textPreset?: TextPreset, center?: { x: number; y: number }) => {
    const element = makeElement(type, textPreset, center);
    insertElement(element);
  };

  const addCurvedArrow = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const element = makeCurvedArrowElement(
      start,
      end,
      Math.max(0, ...(activeSlide?.elements.map((item) => item.zIndex) ?? [0])) + 1,
      elementPreferences["curved-arrow"],
    );
    insertElement(element);
  };

  const activatePlacementTool = (type: ElementType, textPreset?: TextPreset) => {
    if (type === "curved-arrow") {
      setPendingPlacement({ type, textPreset, point: pendingPlacement?.point ?? null });
      setSelectedElementIds([]);
      setContextMenu(null);
      setContextSubmenu(null);
      return;
    }

    if (selectionBounds) {
      addElement(type, textPreset, {
        x: selectionBounds.x + selectionBounds.width / 2,
        y: selectionBounds.y + selectionBounds.height / 2,
      });
      setPendingPlacement(null);
      return;
    }

    setPendingPlacement({ type, textPreset, point: pendingPlacement?.point ?? null });
    setSelectedElementIds([]);
    setContextMenu(null);
    setContextSubmenu(null);
  };

  const placePendingElement = (point: { x: number; y: number }) => {
    if (!pendingPlacement) return;
    if (pendingPlacement.type === "curved-arrow") {
      if (!pendingPlacement.startPoint) {
        setPendingPlacement({ ...pendingPlacement, startPoint: point, point });
        return;
      }

      addCurvedArrow(pendingPlacement.startPoint, point);
      setPendingPlacement(null);
      return;
    }

    addElement(pendingPlacement.type, pendingPlacement.textPreset, point);
    setPendingPlacement(null);
  };

  const addImageElement = (src: string, center?: { x: number; y: number }) => {
    const id = makeId();
    const offset = ((activeSlide?.elements.length ?? 0) % 6) * 28;
    const addWithSize = (naturalWidth: number, naturalHeight: number) => {
      const maxWidth = 520;
      const maxHeight = 340;
      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
      const width = Math.max(80, Math.round(naturalWidth * scale));
      const height = Math.max(60, Math.round(naturalHeight * scale));
      const x = center ? center.x - width / 2 : 180 + offset;
      const y = center ? center.y - height / 2 : 150 + offset;
      const imageElement: SlideElement = {
        id,
        type: "image",
        src,
        x: Math.round(clamp(x, 0, canvasWidth - width)),
        y: Math.round(clamp(y, 0, canvasHeight - height)),
        width,
        height,
        rotation: 0,
        zIndex: Math.max(0, ...(activeSlide?.elements.map((element) => element.zIndex) ?? [0])) + 1,
        reveal: 1,
        animation: "fade",
        fill: "transparent",
        stroke: "#111827",
        strokeWidth: 0,
        radius: 0,
      };
      commitSlide((slide) => ({ ...slide, elements: [...slide.elements, imageElement] }));
      setSelectedElementIds([id]);
    };

    const image = new Image();
    image.onload = () => addWithSize(image.naturalWidth || 360, image.naturalHeight || 220);
    image.onerror = () => addWithSize(360, 220);
    image.src = src;
  };

  const deleteElement = () => {
    if (selectedElementIds.length === 0) return;
    commitSlide((slide) => ({ ...slide, elements: slide.elements.filter((element) => !selectedElementIds.includes(element.id)) }));
    setSelectedElementIds([]);
  };

  const normalizeElementForClipboard = (element: SlideElement): SlideElement => {
    const copy = structuredClone(element) as SlideElement;
    if (copy.type !== "text") return copy;

    const text = copy.text ?? htmlToPlainText(copy.textHtml ?? "");
    const fontSize = copy.fontSize ?? 36;
    const fontWeight = copy.fontWeight ?? 800;
    const naturalBounds = estimateTextBounds(text, fontSize, undefined, fontWeight);
    const hasManualBreaks = text.includes("\n");
    const shouldShrinkToText = !hasManualBreaks && copy.width > naturalBounds.width * 1.35;
    const width = shouldShrinkToText ? naturalBounds.width : Math.max(minTextWidth, copy.width);
    const fittedBounds = estimateTextBounds(text, fontSize, width, fontWeight);

    return {
      ...copy,
      text,
      textHtml: copy.textHtml ?? textToHtml(text),
      width,
      height: fittedBounds.height,
    };
  };

  const getElementsForClipboard = () =>
    selectedElements
      .map(normalizeElementForClipboard)
      .sort((first, second) => first.zIndex - second.zIndex || first.id.localeCompare(second.id));

  const cloneElementsWithOffset = (elements: SlideElement[], offset = 34) => {
    const normalizedElements = elements.map(normalizeElementForClipboard);
    const sourceBounds = getBounds(normalizedElements) ?? { x: 0, y: 0, width: 0, height: 0 };
    const deltaX = clamp(offset, -sourceBounds.x, canvasWidth - sourceBounds.x - sourceBounds.width);
    const deltaY = clamp(offset, -sourceBounds.y, canvasHeight - sourceBounds.y - sourceBounds.height);
    const maxZ = Math.max(0, ...(activeSlide?.elements.map((element) => element.zIndex) ?? [0]));
    const groupIdMap = new Map<string, string>();

    return normalizedElements.map((element, index) => {
      const sourceGroupId = element.groupId;
      const nextGroupId = sourceGroupId
        ? groupIdMap.get(sourceGroupId) ?? (() => {
            const id = makeId();
            groupIdMap.set(sourceGroupId, id);
            return id;
          })()
        : undefined;

      return {
        ...element,
        id: makeId(),
        groupId: nextGroupId,
        x: Math.round(element.x + deltaX),
        y: Math.round(element.y + deltaY),
        zIndex: maxZ + index + 1,
      };
    });
  };

  const duplicateElement = () => {
    if (selectedElements.length === 0) return;
    const duplicated = cloneElementsWithOffset(getElementsForClipboard());
    commitSlide((slide) => ({ ...slide, elements: [...slide.elements, ...duplicated] }));
    setSelectedElementIds(duplicated.map((element) => element.id));
  };

  const pasteElements = (elements: SlideElement[]) => {
    if (elements.length === 0) return;
    const pasted = cloneElementsWithOffset(elements);
    commitSlide((slide) => ({ ...slide, elements: [...slide.elements, ...pasted] }));
    setSelectedElementIds(pasted.map((element) => element.id));
    setClipboardElements(pasted.map(normalizeElementForClipboard));
  };

  const pasteElement = () => pasteElements(clipboardElements);

  const elementContainsPoint = (element: SlideElement, point: { x: number; y: number }) =>
    point.x >= element.x &&
    point.x <= element.x + element.width &&
    point.y >= element.y &&
    point.y <= element.y + element.height;

  const elementUnclampedLocalPoint = (element: SlideElement, point: { x: number; y: number }) => {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const angle = -(element.rotation ?? 0) * (Math.PI / 180);
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: dx * Math.cos(angle) - dy * Math.sin(angle) + element.width / 2,
      y: dx * Math.sin(angle) + dy * Math.cos(angle) + element.height / 2,
    };
  };

  const localPointInElementBounds = (element: SlideElement, localPoint: { x: number; y: number }) =>
    localPoint.x >= 0 &&
    localPoint.x <= element.width &&
    localPoint.y >= 0 &&
    localPoint.y <= element.height;

  const distanceToSegment = (
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
  };

  const distanceToQuadraticCurve = (
    point: { x: number; y: number },
    start: { x: number; y: number },
    control: { x: number; y: number },
    end: { x: number; y: number },
  ) => {
    let best = Number.POSITIVE_INFINITY;
    let previous = start;
    for (let index = 1; index <= 28; index += 1) {
      const t = index / 28;
      const inv = 1 - t;
      const current = {
        x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
        y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
      };
      best = Math.min(best, distanceToSegment(point, previous, current));
      previous = current;
    }
    return best;
  };

  const shouldPassThroughElement = (element: SlideElement, point: { x: number; y: number }) => {
    const localPoint = elementUnclampedLocalPoint(element, point);
    if (!localPointInElementBounds(element, localPoint)) return true;
    const localX = localPoint.x;
    const localY = localPoint.y;
    const hitPadding = Math.max(8, element.strokeWidth + 5);

    if (element.type === "border-rect") {
      return (
        localX > hitPadding &&
        localX < element.width - hitPadding &&
        localY > hitPadding &&
        localY < element.height - hitPadding
      );
    }

    if (element.type === "border-circle") {
      const radiusX = element.width / 2;
      const radiusY = element.height / 2;
      const normalizedX = (localX - radiusX) / Math.max(1, radiusX);
      const normalizedY = (localY - radiusY) / Math.max(1, radiusY);
      const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      const ringWidth = hitPadding / Math.max(1, Math.min(radiusX, radiusY));
      return distance < 1 - ringWidth;
    }

    if (element.type === "diamond") {
      const normalizedX = Math.abs(localX - element.width / 2) / Math.max(1, element.width / 2);
      const normalizedY = Math.abs(localY - element.height / 2) / Math.max(1, element.height / 2);
      return normalizedX + normalizedY > 1;
    }

    if (element.type === "triangle") {
      const top = { x: element.width / 2, y: 0 };
      const left = { x: 0, y: element.height };
      const right = { x: element.width, y: element.height };
      const sign = (first: typeof top, second: typeof top, third: typeof top) =>
        (first.x - third.x) * (second.y - third.y) - (second.x - third.x) * (first.y - third.y);
      const d1 = sign(localPoint, top, left);
      const d2 = sign(localPoint, left, right);
      const d3 = sign(localPoint, right, top);
      return (d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0);
    }

    if (element.type === "line" || element.type === "dashed-line") {
      const y = Math.max(element.strokeWidth / 2, element.height / 2);
      const start = { x: element.strokeWidth / 2, y };
      const end = { x: Math.max(element.strokeWidth / 2, element.width - element.strokeWidth / 2), y };
      return distanceToSegment(localPoint, start, end) > hitPadding;
    }

    if (element.type === "arrow" || element.type === "dashed-arrow" || element.type === "double-arrow") {
      const strokeWidth = Math.max(1, element.strokeWidth);
      const arrowHeadLength = Math.min(Math.max(strokeWidth * 3.1, 14), Math.max(8, element.width * 0.35));
      const arrowHeadHalfHeight = Math.min(Math.max(strokeWidth * 1.9, 9), Math.max(5, element.height * 0.48));
      const centerY = Math.max(strokeWidth / 2, element.height / 2);
      const lineStartX = element.type === "double-arrow" ? arrowHeadLength : strokeWidth / 2;
      const lineEndX = Math.max(lineStartX + 1, element.width - arrowHeadLength);
      const onLine = distanceToSegment(localPoint, { x: lineStartX, y: centerY }, { x: lineEndX, y: centerY }) <= hitPadding;
      const inEndHead =
        localX >= element.width - arrowHeadLength - hitPadding &&
        localX <= element.width + hitPadding &&
        Math.abs(localY - centerY) <= arrowHeadHalfHeight + hitPadding;
      const inStartHead =
        element.type === "double-arrow" &&
        localX >= -hitPadding &&
        localX <= arrowHeadLength + hitPadding &&
        Math.abs(localY - centerY) <= arrowHeadHalfHeight + hitPadding;
      return !(onLine || inEndHead || inStartHead);
    }

    if (element.type === "curved-arrow" || element.type === "bend-arrow") {
      const strokeWidth = Math.max(1, element.strokeWidth);
      const start = element.curveStart ?? { x: strokeWidth / 2, y: element.height - strokeWidth / 2 };
      const end = element.curveEnd ?? { x: Math.max(strokeWidth / 2, element.width - strokeWidth / 2), y: strokeWidth / 2 };
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      const bend = Math.min(Math.max(length * 0.18, 16), 80, Math.max(16, Math.max(element.width, element.height) * 0.72));
      const control = element.type === "bend-arrow"
        ? element.curveControl ?? { x: midX + normalX * bend, y: midY + normalY * bend }
        : { x: midX + normalX * bend, y: midY + normalY * bend };
      const onCurve = distanceToQuadraticCurve(localPoint, start, control, end) <= hitPadding;
      const inHead = Math.hypot(localX - end.x, localY - end.y) <= Math.max(hitPadding * 1.6, strokeWidth * 3);
      return !(onCurve || inHead);
    }

    return false;
  };

  const findTopElementAtPoint = (point: { x: number; y: number }, excludedIds: string[]) =>
    [...(activeSlide?.elements ?? [])]
      .filter((item) => !excludedIds.includes(item.id) && elementContainsPoint(item, point) && !shouldPassThroughElement(item, point))
      .sort((first, second) => second.zIndex - first.zIndex || second.reveal - first.reveal)[0];

  const selectElementsInBounds = (bounds: Bounds, baseSelectedIds: string[] = [], excludedIds: string[] = []) => {
    const baseIds = new Set(baseSelectedIds);
    const matchedIds =
      activeSlide?.elements
        .filter((element) => {
          if (excludedIds.includes(element.id)) return false;
          const center = {
            x: element.x + element.width / 2,
            y: element.y + element.height / 2,
          };
          return center.x >= bounds.x &&
            center.x <= bounds.x + bounds.width &&
            center.y >= bounds.y &&
            center.y <= bounds.y + bounds.height;
        })
        .map((element) => element.id) ?? [];

    setSelectedElementIds(expandElementIds([...baseIds, ...matchedIds.filter((id) => !baseIds.has(id))]));
  };

  const startMarqueeSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (editingTextId || event.button !== 0) return;
    const point = stagePoint(event.clientX, event.clientY);
    if (pendingPlacement) {
      event.stopPropagation();
      placePendingElement(point);
      return;
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const baseSelectedIds = additive ? expandElementIds(selectedElementIds) : [];

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState(null);
    setAlignmentGuides([]);
    setContextMenu(null);
    setContextSubmenu(null);
    setSelectedElementIds(baseSelectedIds);
    setMarqueeSelection({
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      baseSelectedIds,
      additive,
    });
  };

  const updateMarqueeSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (pendingPlacement && !marqueeSelection) {
      const point = stagePoint(event.clientX, event.clientY);
      setPendingPlacement((current) => (current ? { ...current, point } : current));
      return;
    }

    if (!marqueeSelection || event.pointerId !== marqueeSelection.pointerId) return;
    const point = stagePoint(event.clientX, event.clientY);
    const nextMarquee = {
      ...marqueeSelection,
      currentX: point.x,
      currentY: point.y,
    };
    const bounds = normalizeBounds(
      { x: nextMarquee.startX, y: nextMarquee.startY },
      { x: nextMarquee.currentX, y: nextMarquee.currentY },
    );

    setMarqueeSelection(nextMarquee);
    selectElementsInBounds(bounds, nextMarquee.baseSelectedIds, nextMarquee.excludedIds);
  };

  const stopMarqueeSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!marqueeSelection || event.pointerId !== marqueeSelection.pointerId) return;
    const bounds = normalizeBounds(
      { x: marqueeSelection.startX, y: marqueeSelection.startY },
      { x: marqueeSelection.currentX, y: marqueeSelection.currentY },
    );

    if (bounds.width < 4 && bounds.height < 4) {
      if (marqueeSelection.clickToggleIds?.length) {
        const selected = new Set(marqueeSelection.baseSelectedIds);
        const allSelected = marqueeSelection.clickToggleIds.every((id) => selected.has(id));
        if (allSelected) {
          marqueeSelection.clickToggleIds.forEach((id) => selected.delete(id));
        } else {
          marqueeSelection.clickToggleIds.forEach((id) => selected.add(id));
        }
        setSelectedElementIds([...selected]);
      } else {
        setSelectedElementIds(marqueeSelection.baseSelectedIds);
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMarqueeSelection(null);
  };

  const startMove = (event: PointerEvent<HTMLElement>, element: SlideElement, ignoredIds: string[] = []) => {
    if (editingTextId) return;
    const point = stagePoint(event.clientX, event.clientY);
    const topElement = findTopElementAtPoint(point, ignoredIds);
    if (topElement && topElement.id !== element.id) {
      startMove(event, topElement, [...ignoredIds, element.id]);
      return;
    }

    if ((element.type === "text" || element.type === "code") && event.button === 0 && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      const now = window.performance.now();
      const lastTextPointerDown = lastTextPointerDownRef.current;
      const isSameTextDoubleClick =
        lastTextPointerDown?.id === element.id &&
        now - lastTextPointerDown.time < 520 &&
        Math.hypot(event.clientX - lastTextPointerDown.x, event.clientY - lastTextPointerDown.y) < 10;

      lastTextPointerDownRef.current = {
        id: element.id,
        time: now,
        x: event.clientX,
        y: event.clientY,
      };

      if (event.detail >= 2 || isSameTextDoubleClick) {
        event.preventDefault();
        event.stopPropagation();
        setDragState(null);
        startTextEditing(element, "pointer", { x: event.clientX, y: event.clientY });
        return;
      }
    }

    if (event.ctrlKey && element.groupId && !event.shiftKey && !event.metaKey) {
      event.stopPropagation();
      setAlignmentGuides([]);
      setSelectedElementIds([element.id]);
      setContextMenu(null);
      setDragState(null);
      return;
    }

    const elementGroupIds = expandElementIds([element.id]);
    const elementIsSelected = elementGroupIds.every((id) => selectedElementIds.includes(id));
    if ((event.shiftKey || event.metaKey) && event.button === 0) {
      event.stopPropagation();
      stageRef.current?.setPointerCapture(event.pointerId);
      setDragState(null);
      setAlignmentGuides([]);
      setContextMenu(null);
      setContextSubmenu(null);
      setMarqueeSelection({
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        baseSelectedIds: expandElementIds(selectedElementIds),
        additive: true,
        clickToggleIds: elementGroupIds,
        excludedIds: [element.id],
      });
      return;
    }

    if (shouldPassThroughElement(element, point) && !elementIsSelected) {
      const nextIgnoredIds = [...ignoredIds, element.id];
      const passthroughTarget = findTopElementAtPoint(point, nextIgnoredIds);
      if (passthroughTarget) {
        startMove(event, passthroughTarget, nextIgnoredIds);
        return;
      }
      event.stopPropagation();
      setAlignmentGuides([]);
      setSelectedElementIds([]);
      setContextMenu(null);
      return;
    }

    event.stopPropagation();
    setAlignmentGuides([]);
    const isMultiSelect = event.shiftKey || event.metaKey;
    const nextSelectedIds = isMultiSelect
      ? elementIsSelected
        ? selectedElementIds.filter((id) => !elementGroupIds.includes(id))
        : expandElementIds([...selectedElementIds, ...elementGroupIds])
      : elementIsSelected
        ? selectedElementIds
        : elementGroupIds;
    if (isMultiSelect || !nextSelectedIds.includes(element.id)) {
      setSelectedElementIds(nextSelectedIds);
      setContextMenu(null);
      setDragState(null);
      return;
    }

    const movingIds = selectedElementIds.length === 1 && selectedElementIds[0] === element.id
      ? [element.id]
      : expandElementIds(nextSelectedIds);
    const movingElements = activeSlide?.elements.filter((item) => movingIds.includes(item.id)) ?? [element];

    pushUndoSnapshot();
    setSelectedElementIds(nextSelectedIds);
    setDragState({
      mode: "move",
      elementIds: movingIds,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startElements: movingElements.map((item) => ({
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        text: item.text,
        textHtml: item.textHtml,
        textAutoSize: item.textAutoSize,
        curveStart: item.curveStart,
        curveEnd: item.curveEnd,
        curveControl: item.curveControl,
      })),
    });
  };

  const startSelectionMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!selectionBounds || selectedElements.length === 0 || event.button !== 0) return;
    const point = stagePoint(event.clientX, event.clientY);
    const drillTarget = event.ctrlKey && !event.shiftKey && !event.metaKey
      ? findTopElementAtPoint(point, [])
      : null;

    if (drillTarget?.groupId) {
      setAlignmentGuides([]);
      setSelectedElementIds([drillTarget.id]);
      setContextMenu(null);
      setContextSubmenu(null);
      setDragState(null);
      return;
    }

    pushUndoSnapshot();
    setAlignmentGuides([]);
    setContextMenu(null);
    setContextSubmenu(null);
    setDragState({
      mode: "move",
      elementIds: selectedElementIds,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startElements: selectedElements.map((item) => ({
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        text: item.text,
        textHtml: item.textHtml,
        textAutoSize: item.textAutoSize,
        curveStart: item.curveStart,
        curveEnd: item.curveEnd,
        curveControl: item.curveControl,
      })),
    });
  };

  const handleElementDoubleClick = (event: MouseEvent<HTMLElement>, element: SlideElement) => {
    event.preventDefault();
    event.stopPropagation();
    const point = stagePoint(event.clientX, event.clientY);
    if (shouldPassThroughElement(element, point)) {
      const passthroughTarget = findTopElementAtPoint(point, [element.id]);
      if (passthroughTarget?.type === "text" || passthroughTarget?.type === "code") {
        startTextEditing(passthroughTarget, "pointer", { x: event.clientX, y: event.clientY });
      }
      return;
    }

    if (element.type === "text" || element.type === "code") {
      startTextEditing(element, "pointer", { x: event.clientX, y: event.clientY });
    }
  };

  const handleElementContextMenu = (event: MouseEvent<HTMLElement>, element: SlideElement) => {
    event.preventDefault();
    event.stopPropagation();
    const point = stagePoint(event.clientX, event.clientY);
    const target = shouldPassThroughElement(element, point) ? findTopElementAtPoint(point, [element.id]) ?? element : element;
    if (!selectedElementIds.includes(target.id)) {
      setSelectedElementIds(expandElementIds([target.id]));
    }
    setContextSubmenu(null);
    setContextMenu({ x: event.clientX, y: event.clientY, elementId: target.id });
  };

  const handleSelectionContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const elementId = selectedElementIds[0];
    if (!elementId) return;
    setContextSubmenu(null);
    setContextMenu({ x: event.clientX, y: event.clientY, elementId });
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>, element: SlideElement, handle: ResizeHandle) => {
    event.stopPropagation();
    setAlignmentGuides([]);
    const point = stagePoint(event.clientX, event.clientY);
    pushUndoSnapshot();
    setSelectedElementIds([element.id]);
    setDragState({
      mode: "single-resize",
      elementId: element.id,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      handle,
      startElement: {
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        text: element.text,
        textHtml: element.textHtml,
        textAutoSize: element.textAutoSize,
        curveStart: element.curveStart,
        curveEnd: element.curveEnd,
        curveControl: element.curveControl,
      },
    });
  };

  const startRotate = (event: PointerEvent<HTMLButtonElement>, element: SlideElement) => {
    event.stopPropagation();
    const point = stagePoint(event.clientX, event.clientY);
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const startAngle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI) - 90;

    setAlignmentGuides([]);
    pushUndoSnapshot();
    setSelectedElementIds([element.id]);
    setDragState({
      mode: "rotate",
      elementId: element.id,
      pointerId: event.pointerId,
      startAngle,
      startRotation: element.rotation,
    });
  };

  const startGroupRotate = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!selectionBounds || selectedElements.length < 2) return;
    const point = stagePoint(event.clientX, event.clientY);
    const centerX = selectionBounds.x + selectionBounds.width / 2;
    const centerY = selectionBounds.y + selectionBounds.height / 2;
    const startAngle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI) - 90;

    setAlignmentGuides([]);
    pushUndoSnapshot();
    setDragState({
      mode: "group-rotate",
      elementIds: selectedElementIds,
      pointerId: event.pointerId,
      startAngle,
      startBounds: selectionBounds,
      startElements: selectedElements.map((item) => ({
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        text: item.text,
        textHtml: item.textHtml,
        textAutoSize: item.textAutoSize,
        curveStart: item.curveStart,
        curveEnd: item.curveEnd,
        curveControl: item.curveControl,
      })),
    });
  };

  const startGroupResize = (event: PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.stopPropagation();
    if (!selectionBounds || selectedElements.length === 0) return;
    setAlignmentGuides([]);
    const point = stagePoint(event.clientX, event.clientY);
    pushUndoSnapshot();
    setDragState({
      mode: "resize",
      elementIds: selectedElementIds,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      handle,
      startBounds: selectionBounds,
      startElements: selectedElements.map((item) => ({
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        text: item.text,
        textHtml: item.textHtml,
        textAutoSize: item.textAutoSize,
        curveStart: item.curveStart,
        curveEnd: item.curveEnd,
        curveControl: item.curveControl,
      })),
    });
  };

  const startCurveControlDrag = (event: PointerEvent<HTMLButtonElement>, element: SlideElement) => {
    event.preventDefault();
    event.stopPropagation();
    pushUndoSnapshot();
    setSelectedElementIds([element.id]);
    setDragState({
      mode: "curve-control",
      elementId: element.id,
      pointerId: event.pointerId,
    });
  };

  const applyDrag = (pointerId: number, clientX: number, clientY: number) => {
    if (!dragState || pointerId !== dragState.pointerId) return;
    const point = stagePoint(clientX, clientY);

    if (dragState.mode === "curve-control") {
      const element = activeSlide?.elements.find((item) => item.id === dragState.elementId);
      if (!element) return;
      commitElement(
        element.id,
        {
          curveControl: elementLocalPoint(element, point),
        },
        { history: false },
      );
      return;
    }

    if (dragState.mode === "move") {
      const deltaX = point.x - dragState.startX;
      const deltaY = point.y - dragState.startY;
      const startBounds = getBounds(dragState.startElements);
      const rawBounds = startBounds
        ? { ...startBounds, x: startBounds.x + deltaX, y: startBounds.y + deltaY }
        : null;
      const snapped = rawBounds ? snapBounds(rawBounds, dragState.elementIds) : null;
      const snappedDeltaX = snapped && startBounds ? snapped.bounds.x - startBounds.x : deltaX;
      const snappedDeltaY = snapped && startBounds ? snapped.bounds.y - startBounds.y : deltaY;
      setAlignmentGuides(snapped?.guides ?? []);
      commitSlide((slide) => ({
        ...slide,
        elements: slide.elements.map((element) => {
          const startElement = dragState.startElements.find((item) => item.id === element.id);
          if (!startElement) return element;

          return {
            ...element,
            x: Math.round(clamp(startElement.x + snappedDeltaX, 0, canvasWidth - startElement.width)),
            y: Math.round(clamp(startElement.y + snappedDeltaY, 0, canvasHeight - startElement.height)),
          };
        }),
      }), { history: false });
    }

    if (dragState.mode === "resize") {
      const rawBounds = resizeBoundsAnchored(
        dragState.startBounds,
        point,
        { x: dragState.startX, y: dragState.startY },
        dragState.handle,
      );
      const snapped = snapBounds(rawBounds, dragState.elementIds);
      const nextBounds = snapped.bounds;
      setAlignmentGuides(snapped.guides);
      const scaleX = nextBounds.width / dragState.startBounds.width;
      const scaleY = nextBounds.height / dragState.startBounds.height;
      commitSlide((slide) => ({
        ...slide,
        elements: slide.elements.map((element) => {
          const startElement = dragState.startElements.find((item) => item.id === element.id);
          if (!startElement) return element;
          const resizedBounds = {
            x: Math.round(nextBounds.x + (startElement.x - dragState.startBounds.x) * scaleX),
            y: Math.round(nextBounds.y + (startElement.y - dragState.startBounds.y) * scaleY),
            width: Math.round(Math.max(16, startElement.width * scaleX)),
            height: Math.round(Math.max(16, startElement.height * scaleY)),
          };
          const resizedCurve = {
            curveStart: startElement.curveStart
              ? { x: startElement.curveStart.x * scaleX, y: startElement.curveStart.y * scaleY }
              : undefined,
            curveEnd: startElement.curveEnd
              ? { x: startElement.curveEnd.x * scaleX, y: startElement.curveEnd.y * scaleY }
              : undefined,
            curveControl: startElement.curveControl
              ? { x: startElement.curveControl.x * scaleX, y: startElement.curveControl.y * scaleY }
              : undefined,
          };
          if (startElement.type === "text") {
            const fittedText = fitResizedTextElement(element, startElement, resizedBounds, dragState.handle);

            return {
              ...element,
              ...fittedText.bounds,
              fontSize: fittedText.fontSize,
              textHtml: fittedText.textHtml,
              textAutoSize: false,
            };
          }

          return {
            ...element,
            ...resizedBounds,
            ...(startElement.type === "bend-arrow" ? resizedCurve : {}),
          };
        }),
      }), { history: false });
    }

    if (dragState.mode === "single-resize") {
      const element = activeSlide?.elements.find((item) => item.id === dragState.elementId);
      if (!element) return;
      const rawBounds = resizeRotatedBoundsAnchored(
        dragState.startElement,
        point,
        { x: dragState.startX, y: dragState.startY },
        dragState.handle,
        element.rotation,
        ["line", "dashed-line", "arrow", "dashed-arrow", "double-arrow"].includes(dragState.startElement.type)
          ? { height: 2 }
          : undefined,
      );
      const snapped = Math.abs((element.rotation ?? 0) % 360) < 0.001 ? snapBounds(rawBounds, [element.id]) : { bounds: rawBounds, guides: [] };
      const nextBounds = snapped.bounds;
      setAlignmentGuides(snapped.guides);
      if (dragState.startElement.type === "text") {
        const fittedText = fitResizedTextElement(element, dragState.startElement, nextBounds, dragState.handle);
        commitElement(
          element.id,
          {
            ...fittedText.bounds,
            fontSize: fittedText.fontSize,
            textHtml: fittedText.textHtml,
            textAutoSize: false,
          },
          { history: false },
        );
        return;
      }

      commitElement(
        element.id,
        {
          ...nextBounds,
          ...(dragState.startElement.type === "bend-arrow"
            ? {
                curveStart: dragState.startElement.curveStart
                  ? {
                      x: dragState.startElement.curveStart.x * (nextBounds.width / Math.max(1, dragState.startElement.width)),
                      y: dragState.startElement.curveStart.y * (nextBounds.height / Math.max(1, dragState.startElement.height)),
                    }
                  : undefined,
                curveEnd: dragState.startElement.curveEnd
                  ? {
                      x: dragState.startElement.curveEnd.x * (nextBounds.width / Math.max(1, dragState.startElement.width)),
                      y: dragState.startElement.curveEnd.y * (nextBounds.height / Math.max(1, dragState.startElement.height)),
                    }
                  : undefined,
                curveControl: dragState.startElement.curveControl
                  ? {
                      x: dragState.startElement.curveControl.x * (nextBounds.width / Math.max(1, dragState.startElement.width)),
                      y: dragState.startElement.curveControl.y * (nextBounds.height / Math.max(1, dragState.startElement.height)),
                    }
                  : undefined,
              }
            : {}),
        },
        { history: false },
      );
    }

    if (dragState.mode === "rotate") {
      const element = activeSlide?.elements.find((item) => item.id === dragState.elementId);
      if (!element) return;
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      const currentAngle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI) - 90;
      const deltaAngle = currentAngle - dragState.startAngle;
      const nextRotation = snapRotationAngle(dragState.startRotation + deltaAngle);
      setAlignmentGuides([]);
      commitElement(element.id, { rotation: Math.round(nextRotation) }, { history: false });
    }

    if (dragState.mode === "group-rotate") {
      const centerX = dragState.startBounds.x + dragState.startBounds.width / 2;
      const centerY = dragState.startBounds.y + dragState.startBounds.height / 2;
      const rawAngle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI) - 90;
      const rawDeltaAngle = rawAngle - dragState.startAngle;
      const firstElementRotation = dragState.startElements[0]?.rotation ?? 0;
      const snappedFirstRotation = snapRotationAngle(firstElementRotation + rawDeltaAngle);
      const deltaAngle = snappedFirstRotation - firstElementRotation;
      const radians = deltaAngle * (Math.PI / 180);
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      setAlignmentGuides([]);
      commitSlide((slide) => ({
        ...slide,
        elements: slide.elements.map((element) => {
          const startElement = dragState.startElements.find((item) => item.id === element.id);
          if (!startElement) return element;

          const elementCenterX = startElement.x + startElement.width / 2;
          const elementCenterY = startElement.y + startElement.height / 2;
          const relativeX = elementCenterX - centerX;
          const relativeY = elementCenterY - centerY;
          const nextCenterX = centerX + relativeX * cos - relativeY * sin;
          const nextCenterY = centerY + relativeX * sin + relativeY * cos;

          return {
            ...element,
            x: Math.round(clamp(nextCenterX - startElement.width / 2, 0, canvasWidth - startElement.width)),
            y: Math.round(clamp(nextCenterY - startElement.height / 2, 0, canvasHeight - startElement.height)),
            rotation: Math.round(startElement.rotation + deltaAngle),
          };
        }),
      }), { history: false });
    }
  };

  useEffect(() => {
    if (!dragState) return;

    const handleWindowMove = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      applyDrag(event.pointerId, event.clientX, event.clientY);
    };
    const stopDrag = () => {
      setDragState(null);
      setAlignmentGuides([]);
    };

    window.addEventListener("pointermove", handleWindowMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointermove", handleWindowMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        Boolean(editingTextId) ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditing) return;

      if (!presenting && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastChange();
        return;
      }

      if (event.key === "Escape") {
        if (slideDeleteCandidateId) {
          setSlideDeleteCandidateId("");
          return;
        }
        if (pendingPlacement) {
          setPendingPlacement(null);
          return;
        }
        setPresenting(false);
        return;
      }

      if (!presenting && selectedElements.length > 0 && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        deleteElement();
        return;
      }

      if (!presenting && selectedElements.length === 0 && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        requestDeleteSlide(activeSlide?.id ?? "");
        return;
      }

      if (!presenting && selectedElements.length > 0 && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateElement();
        return;
      }

      if (
        !presenting &&
        selectedElements.length === 1 &&
        (selectedElements[0].type === "text" || selectedElements[0].type === "code") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.length === 1
      ) {
        event.preventDefault();
        const element = selectedElements[0];
        const text = event.key;
        let editedElement: SlideElement;
        if (element.type === "code") {
          editedElement = { ...element, text };
          commitElement(element.id, { text });
        } else {
          const patch = {
            text,
            textHtml: textToHtml(text),
            ...estimateTextBounds(text, element.fontSize ?? 36, element.textAutoSize ? undefined : element.width, element.fontWeight ?? 800),
          };
          editedElement = { ...element, ...patch };
          commitElement(element.id, patch);
        }
        requestAnimationFrame(() => {
          startTextEditing(editedElement, "end");
        });
        return;
      }

      if (!presenting && selectedElements.length === 0 && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateActiveSlide();
        return;
      }

      if (!presenting && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "c") {
          event.preventDefault();
          activatePlacementTool("border-circle");
          return;
        }
        if (key === "r") {
          event.preventDefault();
          activatePlacementTool("rect");
          return;
        }
        if (key === "t") {
          event.preventDefault();
          activatePlacementTool("text", "body");
          return;
        }
      }

      if (!presenting) return;
      if (["ArrowRight", " ", "PageDown"].includes(event.key)) {
        event.preventDefault();
        presentNext();
      }
      if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        presentPrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        Boolean(editingTextId) ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditing || presenting) return;

      event.preventDefault();

      if (selectedElements.length > 0) {
        const elements = getElementsForClipboard();
        const serializedElements = JSON.stringify(elements);
        setClipboardElements(elements);
        setClipboardSlide(null);
        event.clipboardData?.setData(internalClipboardType, serializedElements);
        event.clipboardData?.setData("text/plain", `REVEALS_ELEMENTS:${serializedElements}`);
        return;
      }

      if (!activeSlide) return;
      const slide = structuredClone(activeSlide) as Slide;
      const serializedSlide = JSON.stringify(slide);
      setClipboardElements([]);
      setClipboardSlide(slide);
      event.clipboardData?.setData(internalSlideClipboardType, serializedSlide);
      event.clipboardData?.setData("text/plain", `REVEALS_SLIDE:${serializedSlide}`);
    };

    window.addEventListener("copy", handleCopy);
    return () => window.removeEventListener("copy", handleCopy);
  });

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        Boolean(editingTextId) ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditing || presenting) return;

      const slideClipboard =
        event.clipboardData?.getData(internalSlideClipboardType) ||
        event.clipboardData?.getData("text/plain")?.replace(/^REVEALS_SLIDE:/, "");
      if (slideClipboard && slideClipboard !== event.clipboardData?.getData("text/plain")) {
        try {
          const slide = JSON.parse(slideClipboard) as Slide;
          event.preventDefault();
          insertSlideAfterActive(slide);
          return;
        } catch {
          // Fall back to element/image paste below.
        }
      }

      const internalClipboard =
        event.clipboardData?.getData(internalClipboardType) ||
        event.clipboardData?.getData("text/plain")?.replace(/^REVEALS_ELEMENTS:/, "");
      if (internalClipboard && internalClipboard !== event.clipboardData?.getData("text/plain")) {
        try {
          const elements = JSON.parse(internalClipboard) as SlideElement[];
          event.preventDefault();
          pasteElements(elements.map(normalizeElementForClipboard));
          return;
        } catch {
          // Fall back to the in-memory editor clipboard or image paste below.
        }
      }

      const clipboardItems = Array.from(event.clipboardData?.items ?? []);
      const clipboardFiles = Array.from(event.clipboardData?.files ?? []);
      const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile() ?? clipboardFiles.find((item) => item.type.startsWith("image/"));

      if (file) {
        event.preventDefault();
        const center = selectionBounds
          ? { x: selectionBounds.x + selectionBounds.width / 2, y: selectionBounds.y + selectionBounds.height / 2 }
          : { x: canvasWidth / 2, y: canvasHeight / 2 };
        const reader = new FileReader();
        reader.onload = async () => {
          if (typeof reader.result === "string") {
            addImageElement(await downscaleImageDataUrl(reader.result), center);
          }
        };
        reader.readAsDataURL(file);
        return;
      }

      if (clipboardElements.length > 0) {
        event.preventDefault();
        pasteElement();
        return;
      }

      if (clipboardSlide) {
        event.preventDefault();
        insertSlideAfterActive(clipboardSlide);
      }

    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });

  const renderElement = (element: SlideElement, interactive: boolean, visibleReveal = maxReveal) => {
    const isSelected = selectedElementIds.includes(element.id) && interactive;
    const isEditingText = editingTextId === element.id && interactive;
    const hiddenInEditor = interactive && element.reveal > visibleReveal;
    const style: CSSProperties = {
      left: `${(element.x / canvasWidth) * 100}%`,
      top: `${(element.y / canvasHeight) * 100}%`,
      width: `${(element.width / canvasWidth) * 100}%`,
      height: `${(element.height / canvasHeight) * 100}%`,
      opacity: hiddenInEditor ? 0.08 : 1,
      pointerEvents: interactive ? "auto" : "none",
      transform: `rotate(${element.rotation}deg)`,
      zIndex: element.zIndex,
    };
    const animationClass = !interactive && element.reveal === visibleReveal ? `reveal-${element.animation}` : "";
    const strokeWidth = Math.max(1, element.strokeWidth);
    const strokeSize = `calc(${strokeWidth / canvasWidth} * 100cqw)`;
    const arrowHeadLength = Math.min(Math.max(strokeWidth * 3.1, 14), Math.max(8, element.width * 0.35));
    const arrowHeadHalfHeight = Math.min(Math.max(strokeWidth * 1.9, 9), Math.max(5, element.height * 0.48));
    const arrowCenterY = Math.max(strokeWidth / 2, element.height / 2);
    const arrowLineStart = element.type === "double-arrow" ? arrowHeadLength : strokeWidth / 2;
    const arrowLineEnd = Math.max(arrowLineStart + 1, element.width - arrowHeadLength);
    const arrowDash = `${Math.max(8, strokeWidth * 2)} ${Math.max(6, strokeWidth * 1.4)}`;
    const curveStart = element.curveStart ?? { x: strokeWidth / 2, y: element.height - strokeWidth / 2 };
    const curveEnd = element.curveEnd ?? { x: Math.max(strokeWidth / 2, element.width - strokeWidth / 2), y: strokeWidth / 2 };
    const curveMidX = (curveStart.x + curveEnd.x) / 2;
    const curveMidY = (curveStart.y + curveEnd.y) / 2;
    const curveDx = curveEnd.x - curveStart.x;
    const curveDy = curveEnd.y - curveStart.y;
    const curveLength = Math.max(1, Math.hypot(curveDx, curveDy));
    const normalX = -curveDy / curveLength;
    const normalY = curveDx / curveLength;
    const positiveSpace = Math.min(
      normalX >= 0 ? element.width - curveMidX : curveMidX,
      normalY >= 0 ? element.height - curveMidY : curveMidY,
    );
    const negativeSpace = Math.min(
      normalX <= 0 ? element.width - curveMidX : curveMidX,
      normalY <= 0 ? element.height - curveMidY : curveMidY,
    );
    const curveDirection = positiveSpace >= negativeSpace ? 1 : -1;
    const curveBend = Math.min(Math.max(curveLength * 0.18, 16), 80, Math.max(16, Math.max(positiveSpace, negativeSpace) * 0.72));
    const autoCurveControl = {
      x: clamp(curveMidX + normalX * curveBend * curveDirection, 0, element.width),
      y: clamp(curveMidY + normalY * curveBend * curveDirection, 0, element.height),
    };
    const curveControl = element.type === "bend-arrow" ? element.curveControl ?? autoCurveControl : autoCurveControl;
    const curveControlX = curveControl.x;
    const curveControlY = curveControl.y;
    const tangentX = curveEnd.x - curveControlX;
    const tangentY = curveEnd.y - curveControlY;
    const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
    const unitTangentX = tangentX / tangentLength;
    const unitTangentY = tangentY / tangentLength;
    const unitNormalX = -unitTangentY;
    const unitNormalY = unitTangentX;
    const curvedHeadLength = Math.min(Math.max(strokeWidth * 2.15, 8), Math.max(7, curveLength * 0.18));
    const curvedHeadHalfWidth = Math.min(Math.max(strokeWidth * 1.25, 4), Math.max(4, curveLength * 0.08));
    const curvedHeadBaseX = curveEnd.x - unitTangentX * curvedHeadLength;
    const curvedHeadBaseY = curveEnd.y - unitTangentY * curvedHeadLength;
    const curvedHeadPoints = [
      `${curveEnd.x},${curveEnd.y}`,
      `${curvedHeadBaseX + unitNormalX * curvedHeadHalfWidth},${curvedHeadBaseY + unitNormalY * curvedHeadHalfWidth}`,
      `${curvedHeadBaseX - unitNormalX * curvedHeadHalfWidth},${curvedHeadBaseY - unitNormalY * curvedHeadHalfWidth}`,
    ].join(" ");

    return (
      <div
        key={`${element.id}-${interactive ? "edit" : "present"}`}
        className={`element element-${element.type} ${animationClass} ${isSelected ? "is-selected" : ""}`}
        style={style}
        onContextMenu={
          interactive
            ? (event) => handleElementContextMenu(event, element)
            : undefined
        }
        onDoubleClick={interactive ? (event) => handleElementDoubleClick(event, element) : undefined}
        onPointerDown={interactive && !isEditingText ? (event) => startMove(event, element) : undefined}
      >
        {element.type === "text" && (
          isEditingText ? (
            <div
              key={`${element.id}-code-editor`}
              autoFocus
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              spellCheck
              tabIndex={0}
              className="element-text element-text-editor"
              style={{
                color: element.fill,
                fontSize: `calc(${(element.fontSize ?? 32) / canvasWidth} * 100cqw)`,
                fontWeight: element.fontWeight ?? 800,
                textAlign: element.textAlign ?? "left",
              }}
              onInput={(event) => {
                syncTextEditorDraft(event.currentTarget, element.type);
                saveTextSelection();
              }}
              onCompositionEnd={(event) => {
                syncTextEditorDraft(event.currentTarget, element.type);
                saveTextSelection();
              }}
              onFocus={saveTextSelection}
              onMouseUp={saveTextSelection}
              onKeyUp={saveTextSelection}
              onPaste={(event) => {
                event.preventDefault();
                document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
              }}
              onBlur={() => {
                if (textStyleControlPointerDownRef.current) {
                  const editor = editingTextNodeRef.current;
                  if (editor) restoreTextRange(editor, savedTextSelectionRef.current);
                  return;
                }
                finishTextEditing(true);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              ref={(node) => bindTextEditorNode(node, element)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  finishTextEditing(false);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  finishTextEditing(true);
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
                  event.preventDefault();
                  applyRichTextCommand("bold");
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
                  event.preventDefault();
                  applyRichTextCommand("italic");
                }
              }}
            />
          ) : (
            <div
              className="element-text"
              style={{
                color: element.fill,
                fontSize: `calc(${(element.fontSize ?? 32) / canvasWidth} * 100cqw)`,
                fontWeight: element.fontWeight ?? 800,
                textAlign: element.textAlign ?? "left",
              }}
              dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(element.textHtml ?? textToHtml(element.text ?? "")) }}
            />
          )
        )}
        {element.type === "code" && (
          isEditingText ? (
            <div
              autoFocus
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              spellCheck={false}
              tabIndex={0}
              className="element-code element-code-editor"
              style={{
                backgroundColor: element.fill,
                fontSize: `calc(${(element.fontSize ?? 14) / canvasWidth} * 100cqw)`,
                borderColor: element.stroke,
                borderRadius: element.radius,
              }}
              onInput={(event) => {
                syncTextEditorDraft(event.currentTarget, element.type);
              }}
              onCompositionEnd={(event) => {
                syncTextEditorDraft(event.currentTarget, element.type);
                saveTextSelection();
              }}
              onFocus={saveTextSelection}
              onMouseUp={saveTextSelection}
              onKeyUp={saveTextSelection}
              onPaste={(event) => {
                event.preventDefault();
                document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
              }}
              onBlur={() => finishTextEditing(true)}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              ref={(node) => bindTextEditorNode(node, element)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  finishTextEditing(false);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  finishTextEditing(true);
                }
              }}
            />
          ) : (
            <div
              key={`${element.id}-code-view-${element.language ?? "javascript"}`}
              className={`element-code ${isShellLanguage(element.language) ? "element-code-shell" : ""}`}
              style={{
                backgroundColor: element.fill,
                fontSize: `calc(${(element.fontSize ?? 14) / canvasWidth} * 100cqw)`,
                borderColor: element.stroke,
                borderRadius: element.radius,
              }}
            >
              {isShellLanguage(element.language) ? (
                <div className="terminal-lines">
                  {getShellLines(element.text ?? "").map((line, index) =>
                    line.trim() === "" ? (
                      <div className="terminal-spacer" key={`${element.id}-line-${index}`} aria-hidden="true" />
                    ) : (() => {
                      const shellLine = parseShellLine(line);

                      return (
                        <div className={`terminal-line terminal-line-${shellLine.kind}`} key={`${element.id}-line-${index}`}>
                          {shellLine.kind === "command" && (
                            <span className="terminal-prompt-wrap">
                              {shellLine.userHost && (
                                <>
                                  <span className="terminal-user-host">{shellLine.userHost}</span>
                                  <span className="terminal-separator">:</span>
                                </>
                              )}
                              {shellLine.cwd && <span className="terminal-cwd">{shellLine.cwd}</span>}
                              <span className="terminal-prompt">{shellLine.prompt}</span>
                            </span>
                          )}
                          <code dangerouslySetInnerHTML={{ __html: highlightShellLine(line) }} />
                        </div>
                      );
                    })(),
                  )}
                </div>
              ) : (
                <pre>
                  <code
                    className={`language-${element.language ?? "javascript"}`}
                    dangerouslySetInnerHTML={{
                      __html: highlightCode(element.text ?? "", element.language ?? "javascript"),
                    }}
                  />
                </pre>
              )}
            </div>
          )
        )}
        {element.type === "file-tree" && (
          <div
            className="file-tree-panel"
            style={{
              backgroundColor: element.fill,
              color: element.stroke,
              fontSize: `calc(${(element.fontSize ?? 18) / canvasWidth} * 100cqw)`,
              borderRadius: element.radius,
            }}
          >
            {getFileTreeRows(element.text ?? "").map((row, index) => {
              const rowReveal = element.reveal + index;
              if (!interactive && rowReveal > visibleReveal) return null;

              return (
                <div
                  className={`file-tree-row ${row.isFolder ? "is-folder" : "is-file"} ${!interactive && rowReveal === visibleReveal ? "is-new-reveal" : ""}`}
                  key={`${element.id}-tree-${index}-${row.label}`}
                  style={{ "--tree-depth": row.depth } as CSSProperties}
                >
                  <span className="file-tree-guide" aria-hidden="true" />
                  <span className="file-tree-icon" aria-hidden="true" />
                  <span className="file-tree-label">{row.label.replace(/\/$/, "")}</span>
                </div>
              );
            })}
          </div>
        )}
        {element.type === "table" && (
          <div
            className="element-table-panel"
            style={{
              backgroundColor: element.fill,
              color: element.stroke,
              fontSize: `calc(${(element.fontSize ?? 18) / canvasWidth} * 100cqw)`,
              borderColor: element.stroke,
              borderRadius: element.radius,
            }}
          >
            <table>
              <tbody>
                {getTableRows(element.text ?? "").map((row, rowIndex) => (
                  <tr key={`${element.id}-table-row-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${element.id}-table-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(element.type === "rect" || element.type === "border-rect") && (
          <div
            className="shape rect"
            style={{
              background: element.fill,
              borderColor: element.stroke,
              borderWidth: element.type === "border-rect" ? strokeSize : 0,
              borderRadius: element.radius,
            }}
          />
        )}
        {(element.type === "circle" || element.type === "border-circle") && (
          <div
            className="shape circle"
            style={{
              background: element.fill,
              borderColor: element.stroke,
              borderWidth: element.type === "border-circle" ? strokeSize : 0,
            }}
          />
        )}
        {element.type === "diamond" && (
          <div
            className="shape diamond"
            style={{ background: element.fill, borderColor: element.stroke, borderWidth: 0 }}
          />
        )}
        {element.type === "triangle" && (
          <div
            className="shape triangle"
            style={
              {
                color: element.fill,
                "--triangle-stroke": element.stroke,
                "--triangle-stroke-width": strokeSize,
              } as CSSProperties
            }
          />
        )}
        {isThreeShapeType(element.type) && (
          <ThreeShape
            type={element.type}
            fill={element.fill}
            stroke={element.stroke}
            pitch={element.pitch}
            yaw={element.yaw}
            roll={element.roll}
          />
        )}
        {element.type === "line" && (
          <div
            className="line-shape"
            style={{ color: element.stroke, "--stroke-size": strokeSize } as CSSProperties}
          />
        )}
        {element.type === "dashed-line" && (
          <svg className="arrow-svg" viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none" aria-hidden="true">
            <line
              x1={strokeWidth / 2}
              y1={Math.max(strokeWidth / 2, element.height / 2)}
              x2={Math.max(strokeWidth / 2, element.width - strokeWidth / 2)}
              y2={Math.max(strokeWidth / 2, element.height / 2)}
              stroke={element.stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={`${Math.max(10, strokeWidth * 2.4)} ${Math.max(8, strokeWidth * 1.8)}`}
              strokeLinecap="round"
            />
          </svg>
        )}
        {arrowTypes.includes(element.type) && element.type !== "curved-arrow" && element.type !== "bend-arrow" && (
          <svg className="arrow-svg" viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none" aria-hidden="true">
            <line
              x1={arrowLineStart}
              y1={arrowCenterY}
              x2={arrowLineEnd}
              y2={arrowCenterY}
              stroke={element.stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={element.type === "dashed-arrow" ? arrowDash : undefined}
              strokeLinecap="round"
            />
            {element.type === "double-arrow" && (
              <polygon
                points={`${arrowHeadLength},${arrowCenterY - arrowHeadHalfHeight} 0,${arrowCenterY} ${arrowHeadLength},${arrowCenterY + arrowHeadHalfHeight}`}
                fill={element.stroke}
              />
            )}
            <polygon
              points={`${element.width - arrowHeadLength},${arrowCenterY - arrowHeadHalfHeight} ${element.width},${arrowCenterY} ${element.width - arrowHeadLength},${arrowCenterY + arrowHeadHalfHeight}`}
              fill={element.stroke}
            />
          </svg>
        )}
        {(element.type === "curved-arrow" || element.type === "bend-arrow") && (
          <svg className="arrow-svg" viewBox={`0 0 ${Math.max(1, element.width)} ${Math.max(1, element.height)}`} preserveAspectRatio="none" aria-hidden="true">
            <path
              d={`M ${curveStart.x} ${curveStart.y} Q ${curveControlX} ${curveControlY} ${curveEnd.x} ${curveEnd.y}`}
              fill="none"
              stroke={element.stroke}
              strokeLinecap="round"
              strokeWidth={strokeWidth}
            />
            <polygon points={curvedHeadPoints} fill={element.stroke} />
          </svg>
        )}
        {interactive && isSelected && element.type === "bend-arrow" && (
          <button
            type="button"
            className="curve-control-handle"
            title="Bend arrow"
            aria-label="Bend arrow"
            onPointerDown={(event) => startCurveControlDrag(event, element)}
            style={{
              left: `${(curveControlX / Math.max(1, element.width)) * 100}%`,
              top: `${(curveControlY / Math.max(1, element.height)) * 100}%`,
            }}
          />
        )}
        {element.type === "image" && element.src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="media-element" src={element.src} alt="" draggable={false} />
        )}
      </div>
    );
  };

  const renderRevealBadge = (element: SlideElement) => {
    if (!showRevealNumbers) return null;
    if (presenting) return null;
    if (editingTextId === element.id) return null;
    const groupElements = element.groupId
      ? (activeSlide?.elements ?? []).filter((item) => item.groupId === element.groupId)
      : [element];
    if (groupElements.length === 0) return null;
    if (element.groupId && groupElements[0]?.id !== element.id) return null;
    const badgeBounds = getBounds(groupElements) ?? element;
    const reveal = Math.min(...groupElements.map((item) => item.reveal));
    const revealColor = revealColors[(reveal - 1) % revealColors.length];
    const compactBadge = badgeBounds.width < 72 || badgeBounds.height < 72;
    const offset = compactBadge ? -12 : element.groupId || element.type === "text" ? -18 : 6;

    return (
      <span
        aria-hidden="true"
        className={`reveal-badge stage-reveal-badge ${compactBadge ? "compact-reveal-badge" : ""}`}
        key={`${element.id}-reveal-badge`}
        style={{
          background: revealColor,
          left: `${((badgeBounds.x + offset) / canvasWidth) * 100}%`,
          top: `${((badgeBounds.y + offset) / canvasHeight) * 100}%`,
        }}
      >
        {reveal}
      </span>
    );
  };

  const renderSlidePreview = (slide: Slide) => {
    const previewReveal = activeSlideMaxReveal(slide);

    return (
      <div
        className={`slide-preview-stage ${showPreviewGrid ? "" : "hide-grid"}`}
        style={
          {
            backgroundColor: slide.background,
            backgroundImage: showPreviewGrid ? undefined : "none",
            "--grid-color": getGridColor(slide.background),
          } as CSSProperties
        }
      >
        {sortByReveal(slide.elements)
          .filter((element) => element.reveal <= previewReveal)
          .map((element) => renderElement(element, false, previewReveal))}
      </div>
    );
  };

  const selectedHasStrokeControls = selectedElement
    ? ["border-rect", "border-circle", "line", "dashed-line", ...arrowTypes].includes(selectedElement.type)
    : false;
  const marqueeBounds = marqueeSelection
    ? normalizeBounds(
        { x: marqueeSelection.startX, y: marqueeSelection.startY },
        { x: marqueeSelection.currentX, y: marqueeSelection.currentY },
      )
    : null;
  const pendingPlacementPreview = pendingPlacement?.point
    ? makeElement(pendingPlacement.type, pendingPlacement.textPreset, pendingPlacement.point)
    : null;
  const pendingCurvedArrowPreview = pendingPlacement?.type === "curved-arrow" && pendingPlacement.startPoint && pendingPlacement.point
    ? makeCurvedArrowElement(pendingPlacement.startPoint, pendingPlacement.point, 1, elementPreferences["curved-arrow"])
    : null;
  const selectedSupportsOptionalFill = selectedElement ? ["border-rect", "border-circle"].includes(selectedElement.type) : false;
  const selectedHasFill = selectedElement?.fill !== "transparent";
  const selectedElementIsSmall = selectedElement ? selectedElement.width < 72 || selectedElement.height < 72 : false;
  const selectionBoundsIsSmall = selectionBounds ? selectionBounds.width < 72 || selectionBounds.height < 72 : false;
  const slideDeleteCandidate = activeProject?.slides.find((slide) => slide.id === slideDeleteCandidateId);
  const namespaceDeleteCandidate = namespaces.find((namespace) => namespace.id === namespaceDeleteCandidateId);
  const scaledCanvasWidth = Math.round(canvasBaseWidth * canvasZoom);
  const scaledCanvasHeight = Math.round((canvasBaseWidth * canvasHeight / canvasWidth) * canvasZoom);
  const canvasPanPadding = Math.max(420, Math.round(canvasBaseWidth * 0.45));
  const canvasPlaneWidth = scaledCanvasWidth + canvasPanPadding * 2;
  const canvasPlaneHeight = scaledCanvasHeight + canvasPanPadding * 2;

  if (!loaded || !activeNamespace || !activeProject || !activeSlide) {
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
    <main className="studio-app" onPointerDown={() => { setSlideContextMenu(null); setNamespaceContextMenu(null); setNamespaceMenuOpen(false); setProjectMenuOpen(false); setSettingsMenuOpen(false); }}>
      <header className="app-header">
        <nav className="app-menu" aria-label="Application menu" onPointerDown={(event) => event.stopPropagation()}>
          <Link className="app-logo" href="/" aria-label="Dashboard" title="Dashboard" />
          <button type="button" className="app-menu-item">File</button>
          <button type="button" className="app-menu-item">View</button>
          <div className="app-menu-popover">
            <button
              type="button"
              className={`app-menu-item ${settingsMenuOpen ? "active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={settingsMenuOpen}
              onClick={() => setSettingsMenuOpen((current) => !current)}
            >
              Settings
            </button>
            {settingsMenuOpen && (
              <div className="settings-menu" role="menu">
                <label className="settings-toggle" role="menuitemcheckbox" aria-checked={showRevealNumbers}>
                  <input
                    type="checkbox"
                    checked={showRevealNumbers}
                    onChange={(event) => setShowRevealNumbers(event.target.checked)}
                  />
                  <span className="settings-check" aria-hidden="true" />
                  <span>Show reveal numbers</span>
                </label>
                <label className="settings-toggle" role="menuitemcheckbox" aria-checked={showEditGrid}>
                  <input
                    type="checkbox"
                    checked={showEditGrid}
                    onChange={(event) => setShowEditGrid(event.target.checked)}
                  />
                  <span className="settings-check" aria-hidden="true" />
                  <span>Show edit grid</span>
                </label>
                <label className="settings-toggle" role="menuitemcheckbox" aria-checked={showPreviewGrid}>
                  <input
                    type="checkbox"
                    checked={showPreviewGrid}
                    onChange={(event) => setShowPreviewGrid(event.target.checked)}
                  />
                  <span className="settings-check" aria-hidden="true" />
                  <span>Show preview grid</span>
                </label>
              </div>
            )}
          </div>
        </nav>
        <div className="app-user">
          <span>demo@reveal.studio</span>
          <span className="app-user-icon" aria-hidden="true" />
        </div>
      </header>

      <div className="studio-shell">
        <aside className="sidebar">
        <div className="namespace-switcher" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`namespace-trigger ${namespaceMenuOpen ? "open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={namespaceMenuOpen}
            onClick={() => setNamespaceMenuOpen((current) => !current)}
          >
            <span>
              <strong>{activeNamespace.name}</strong>
              <small>{projects.length} projects</small>
            </span>
            <span className="project-chevron" aria-hidden="true" />
          </button>
          {namespaceMenuOpen && (
            <div className="namespace-menu" role="listbox" aria-label="Namespaces">
              {namespaces.map((namespace) => (
                <div
                  className={`namespace-option ${namespace.id === activeNamespace.id ? "active" : ""} ${renamingNamespaceId === namespace.id ? "renaming" : ""}`}
                  key={namespace.id}
                  role="option"
                  aria-selected={namespace.id === activeNamespace.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setNamespaceContextMenu({ x: event.clientX, y: event.clientY, namespaceId: namespace.id });
                  }}
                >
                  {renamingNamespaceId === namespace.id ? (
                    <input
                      autoFocus
                      className="project-rename-input"
                      value={renamingNamespaceName}
                      onChange={(event) => setRenamingNamespaceName(event.target.value)}
                      onBlur={commitNamespaceRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitNamespaceRename();
                        if (event.key === "Escape") cancelNamespaceRename();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="namespace-option-select"
                      onClick={() => switchNamespace(namespace.id)}
                    >
                      <span>{namespace.name}</span>
                      <small>{namespace.projects.length} projects</small>
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="project-new-option" onClick={addNamespace}>
                <span aria-hidden="true">+</span>
                <strong>New namespace</strong>
              </button>
            </div>
          )}
        </div>
        <div className="project-switcher" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`project-trigger ${projectMenuOpen ? "open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={projectMenuOpen}
            onClick={() => setProjectMenuOpen((current) => !current)}
          >
            <span>
              <strong>{activeProject.name}</strong>
              <small>{activeProject.slides.length} slides</small>
            </span>
            <span className="project-chevron" aria-hidden="true" />
          </button>
          {projectMenuOpen && (
            <div className="project-menu" role="listbox" aria-label="Projects">
              {projects.map((project) => (
                <div
                  className={`project-option ${project.id === activeProject.id ? "active" : ""}`}
                  key={project.id}
                  role="option"
                  aria-selected={project.id === activeProject.id}
                >
                  <button
                    type="button"
                    className="project-option-select"
                    onClick={() => switchProject(project.id)}
                  >
                    <span>{project.name}</span>
                    <small>{project.slides.length} slides</small>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel-section element-palette-section">
          <h2 className="palette-section-title">Text</h2>
          <div className="element-palette text-palette">
            {toolItems.filter((item) => item.type === "text").map((item) => (
              <button
                type="button"
                className="palette-button"
                key={`${item.type}-${item.label}`}
                title={item.label}
                aria-label={item.label}
                onClick={() => addElement(item.type, item.textPreset)}
              >
                <span className={`tool-icon tool-${item.icon}`} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="palette-divider" />
          <h2 className="palette-section-title">Shapes</h2>
          <div className="element-palette shape-palette">
            {toolItems.filter((item) => item.type !== "text" && !["code", "file-tree", "table"].includes(item.type)).map((item) => (
              <button
                type="button"
                className="palette-button shape-button"
                key={`${item.type}-${item.label}`}
                title={item.label}
                aria-label={item.label}
                onClick={() => {
                  if (item.type === "curved-arrow") {
                    activatePlacementTool(item.type, item.textPreset);
                    return;
                  }
                  addElement(item.type, item.textPreset);
                }}
              >
                <span className={`tool-icon tool-${item.icon}`} />
              </button>
            ))}
          </div>
          <div className="palette-divider" />
          <h2 className="palette-section-title">Rich elements</h2>
          <div className="element-palette content-palette">
            {toolItems.filter((item) => ["code", "file-tree", "table"].includes(item.type)).map((item) => (
              <button
                type="button"
                className="palette-button content-button"
                key={`${item.type}-${item.label}`}
                title={item.label}
                aria-label={item.label}
                onClick={() => addElement(item.type, item.textPreset)}
              >
                <span className={`tool-icon tool-${item.icon}`} />
              </button>
            ))}
          </div>
        </div>

      </aside>

        <section className="workspace">
        <header className="topbar">
          <strong>{activeSlide.title}</strong>
          <div className="toolbar">
            <button type="button" className="primary-button" onClick={() => { setPresentReveal(1); setPresenting(true); }}>Preview</button>
          </div>
        </header>

        <div
          className={`canvas-wrap ${isCanvasPanning ? "is-panning" : ""} ${dragState?.mode === "move" ? "is-moving-element" : ""}`}
          ref={canvasWrapRef}
          onPointerDownCapture={startCanvasPan}
          onPointerMove={moveCanvasPan}
          onPointerUp={stopCanvasPan}
          onPointerCancel={stopCanvasPan}
          onAuxClick={preventMiddleMouseAutoscroll}
          onMouseDown={preventMiddleMouseAutoscroll}
        >
          <div
            className="canvas-plane"
            style={{ height: `${canvasPlaneHeight}px`, width: `${canvasPlaneWidth}px` }}
          >
            <div
              className="stage-zoom-frame"
              style={{ height: `${scaledCanvasHeight}px`, width: `${scaledCanvasWidth}px` }}
            >
              <div
                ref={stageRef}
                className={`stage ${showEditGrid ? "" : "hide-grid"} ${marqueeSelection ? "is-marquee-selecting" : ""} ${pendingPlacement ? "is-placing-element" : ""}`}
                style={
                  {
                    backgroundColor: activeSlide.background,
                    backgroundImage: showEditGrid ? undefined : "none",
                    transform: `scale(${canvasZoom})`,
                    width: `${canvasBaseWidth}px`,
                    "--grid-color": getGridColor(activeSlide.background),
                  } as CSSProperties
                }
                onPointerDown={startMarqueeSelection}
                onPointerMove={updateMarqueeSelection}
                onPointerUp={stopMarqueeSelection}
                onPointerCancel={stopMarqueeSelection}
                onContextMenu={(event) => event.preventDefault()}
              >
            {alignmentGuides.map((guide, index) => (
              <span
                aria-hidden="true"
                className={`alignment-guide alignment-guide-${guide.orientation}`}
                key={`${guide.orientation}-${guide.position}-${index}`}
                style={
                  guide.orientation === "vertical"
                    ? { left: `${(guide.position / canvasWidth) * 100}%` }
                    : { top: `${(guide.position / canvasHeight) * 100}%` }
                }
              />
            ))}
            {sortByReveal(activeSlide.elements).map((element) => renderElement(element, true))}
            {activeSlide.elements.map((element) => renderRevealBadge(element))}
            {selectedElement && editingTextId !== selectedElement.id && (
              <div
                className={`selection-box single-selection-box ${selectedElementIsSmall ? "compact-selection-box" : ""}`}
                onPointerDown={(event) => startMove(event, selectedElement)}
                onContextMenu={(event) => handleElementContextMenu(event, selectedElement)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (selectedElement.type === "text" || selectedElement.type === "code") {
                    startTextEditing(selectedElement, "pointer", { x: event.clientX, y: event.clientY });
                  }
                }}
                style={{
                  left: `${(selectedElement.x / canvasWidth) * 100}%`,
                  top: `${(selectedElement.y / canvasHeight) * 100}%`,
                  width: `${(selectedElement.width / canvasWidth) * 100}%`,
                  height: `${(selectedElement.height / canvasHeight) * 100}%`,
                  transform: `rotate(${selectedElement.rotation}deg)`,
                }}
              >
                <button className="rotate-handle" type="button" title="Rotate" onPointerDown={(event) => startRotate(event, selectedElement)} />
                {dragState?.mode === "rotate" && dragState.elementId === selectedElement.id && (
                  <span
                    className="rotation-degree-badge"
                    style={{ transform: `translateX(-50%) rotate(${-selectedElement.rotation}deg)` }}
                  >
                    {formatDegrees(selectedElement.rotation)}°
                  </span>
                )}
                {resizeHandles.map((handle) => (
                  <button
                    className={`resize-handle resize-${handle}`}
                    key={handle}
                    type="button"
                    title="Resize"
                    onPointerDown={(event) => startResize(event, selectedElement, handle)}
                  />
                ))}
              </div>
            )}
            {pendingCurvedArrowPreview && (
              <div
                aria-hidden="true"
                className="placement-curved-arrow-preview"
              >
                {renderElement(pendingCurvedArrowPreview, false)}
              </div>
            )}
            {pendingPlacementPreview && pendingPlacement?.type !== "curved-arrow" && (
              <div
                aria-hidden="true"
                className={`placement-preview placement-preview-${pendingPlacementPreview.type}`}
                style={{
                  left: `${(pendingPlacementPreview.x / canvasWidth) * 100}%`,
                  top: `${(pendingPlacementPreview.y / canvasHeight) * 100}%`,
                  width: `${(pendingPlacementPreview.width / canvasWidth) * 100}%`,
                  height: `${(pendingPlacementPreview.height / canvasHeight) * 100}%`,
                  color: pendingPlacementPreview.stroke,
                  background:
                    pendingPlacementPreview.type === "rect" ? pendingPlacementPreview.fill : "transparent",
                  borderColor: pendingPlacementPreview.stroke,
                  borderRadius:
                    pendingPlacementPreview.type === "border-circle" ? "50%" : pendingPlacementPreview.radius,
                }}
              >
                {pendingPlacementPreview.type === "text" ? pendingPlacementPreview.text : null}
              </div>
            )}
            {marqueeBounds && (
              <span
                aria-hidden="true"
                className="marquee-selection"
                style={{
                  left: `${(marqueeBounds.x / canvasWidth) * 100}%`,
                  top: `${(marqueeBounds.y / canvasHeight) * 100}%`,
                  width: `${(marqueeBounds.width / canvasWidth) * 100}%`,
                  height: `${(marqueeBounds.height / canvasHeight) * 100}%`,
                }}
              />
            )}
              {selectionBounds && selectedElements.length > 1 && (
                <div
                  className={`selection-box ${selectionBoundsIsSmall ? "compact-selection-box" : ""}`}
                  onPointerDown={startSelectionMove}
                  onContextMenu={handleSelectionContextMenu}
                  style={{
                    left: `${(selectionBounds.x / canvasWidth) * 100}%`,
                    top: `${(selectionBounds.y / canvasHeight) * 100}%`,
                    width: `${(selectionBounds.width / canvasWidth) * 100}%`,
                    height: `${(selectionBounds.height / canvasHeight) * 100}%`,
                  }}
                >
                  <span className="selection-count">{selectedElements.length}</span>
                  <button className="rotate-handle" type="button" title="Rotate group" onPointerDown={startGroupRotate} />
                  {dragState?.mode === "group-rotate" && (
                    <span className="rotation-degree-badge">
                      {formatDegrees(selectedElements[0]?.rotation ?? 0)}°
                    </span>
                  )}
                  {resizeHandles.map((handle) => (
                    <button
                      className={`resize-handle resize-${handle}`}
                      key={handle}
                      type="button"
                      title="Resize group"
                      onPointerDown={(event) => startGroupResize(event, handle)}
                    />
                  ))}
                </div>
              )}
              </div>
            </div>
          </div>
        </div>

        <footer className="timeline" aria-label="Slide navigation">
          <div className="timeline-viewport" ref={slideCarouselRef}>
            {activeProject.slides.map((slide, index) => (
              <button
                type="button"
                key={slide.id}
                draggable
                data-slide-id={slide.id}
                className={`timeline-slide ${slide.id === activeSlide.id ? "active" : ""} ${slide.id === draggedSlideId ? "dragging" : ""} ${slideDropIndicator?.slideId === slide.id ? `drop-${slideDropIndicator.placement}` : ""}`}
                onClick={() => showSlide(slide.id)}
                onContextMenu={(event) => handleSlideContextMenu(event, slide.id)}
                onDragStart={(event) => handleSlideDragStart(event, slide.id)}
                onDragOver={(event) => handleSlideDragOver(event, slide.id)}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  if (slideDropIndicator?.slideId === slide.id) setSlideDropIndicator(null);
                }}
                onDrop={(event) => handleSlideDrop(event, slide.id)}
                onDragEnd={handleSlideDragEnd}
                onKeyDown={(event) => {
                  if (event.key !== "Backspace" && event.key !== "Delete") return;
                  event.preventDefault();
                  event.stopPropagation();
                  requestDeleteSlide(slide.id);
                }}
                title={slide.title}
              >
                <span className="timeline-slide-number">{index + 1}</span>
                {renderSlidePreview(slide)}
                <span className="timeline-slide-title">{slide.title}</span>
              </button>
            ))}
            <button type="button" className="timeline-new-slide" onClick={addSlide} aria-label="Add slide">
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </footer>
      </section>

        <aside className="inspector">
        <div className="panel-section">
          <h2>Element</h2>
          {selectedElement ? (
            <div className="inspector-grid">
              {selectedElement.type === "text" && (
                <>
                  <label className="field-label wide">Text<textarea value={getTextElementPlainText(selectedElement)} onChange={(event) => commitElement(selectedElement.id, { text: event.target.value, textHtml: textToHtml(event.target.value), ...estimateTextBounds(event.target.value, selectedElement.fontSize ?? 36, selectedElement.textAutoSize ? undefined : selectedElement.width, selectedElement.fontWeight ?? 800) })} /></label>
                  <div className="field-label wide">
                    <span>Selection</span>
                    <div className="text-style-controls">
                      <button type="button" onPointerDown={(event) => runTextStyleControl(event, () => applyRichTextCommand("bold"))}>B</button>
                      <button type="button" onPointerDown={(event) => runTextStyleControl(event, () => applyRichTextCommand("italic"))}><i>I</i></button>
                      {editingTextId === selectedElement.id && (
                        <>
                          <button type="button" onPointerDown={(event) => runTextStyleControl(event, () => applySelectedTextFontDelta(-4))}>A-</button>
                          <button type="button" onPointerDown={(event) => runTextStyleControl(event, () => applySelectedTextFontDelta(4))}>A+</button>
                          <button type="button" onPointerDown={(event) => runTextStyleControl(event, () => applySelectedTextWeightDelta(-100))}>W-</button>
                          <button type="button" onPointerDown={(event) => runTextStyleControl(event, () => applySelectedTextWeightDelta(100))}>W+</button>
                        </>
                      )}
                    </div>
                  </div>
                  <label className="field-label"><span>Size</span><TextFontSizeControl key={`${selectedElement.id}-font-size`} value={selectedElement.fontSize} onCommit={(value) => {
                    const fontSize = Math.max(8, value);
                    commitElement(selectedElement.id, { fontSize, ...estimateTextBounds(getTextElementPlainText(selectedElement), fontSize, selectedElement.textAutoSize ? undefined : selectedElement.width, selectedElement.fontWeight ?? 800) });
                  }} /></label>
                  <label className="field-label"><span>Weight</span><TextFontWeightControl key={`${selectedElement.id}-font-weight`} value={selectedElement.fontWeight ?? 800} onCommit={(value) => {
                    const fontWeight = clamp(value, 100, 900);
                    commitElement(selectedElement.id, { fontWeight, ...estimateTextBounds(getTextElementPlainText(selectedElement), selectedElement.fontSize ?? 36, selectedElement.textAutoSize ? undefined : selectedElement.width, fontWeight) });
                  }} /></label>
                  <label className="field-label compact-field">Color<ColorInput label="Text color" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <div className="field-label wide">
                    <span>Alignment</span>
                    <div className="segmented-control">
                      <button type="button" className={(selectedElement.textAlign ?? "left") === "left" ? "active" : ""} onClick={() => commitElement(selectedElement.id, { textAlign: "left" })}>Start</button>
                      <button type="button" className={selectedElement.textAlign === "center" ? "active" : ""} onClick={() => commitElement(selectedElement.id, { textAlign: "center" })}>Center</button>
                      <button type="button" className={selectedElement.textAlign === "right" ? "active" : ""} onClick={() => commitElement(selectedElement.id, { textAlign: "right" })}>End</button>
                    </div>
                  </div>
                </>
              )}
              {selectedElement.type === "code" && (
                <>
                  <label className="field-label wide">
                    Code
                    <textarea
                      className="code-textarea"
                      placeholder={isShellLanguage(selectedElement.language) ? "~/robot_ws$ colcon build\n~/robot_ws/src$ ros2 pkg create robot_description" : undefined}
                      spellCheck={false}
                      value={selectedElement.text ?? ""}
                      onChange={(event) => commitElement(selectedElement.id, { text: event.target.value })}
                      onKeyDown={handleIndentTextareaKeyDown}
                    />
                    {isShellLanguage(selectedElement.language) && <span className="field-hint">For bash, you can write terminal-style lines: directory$ command</span>}
                  </label>
                  <label className="field-label wide">
                    Language
                    <select
                      value={selectedElement.language ?? "javascript"}
                      onChange={(event) => commitElement(selectedElement.id, { language: event.target.value })}
                    >
                      {codeLanguages.map((language) => (
                        <option value={language} key={language}>{language}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    <span>Size</span>
                    <NumberInput
                      key={`${selectedElement.id}-code-font-size`}
                      min={8}
                      max={48}
                      value={selectedElement.fontSize ?? 14}
                      onCommit={(fontSize) => commitElement(selectedElement.id, { fontSize })}
                    />
                  </label>
                  <label className="field-label compact-field">Background<ColorInput label="Code background" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <label className="field-label compact-field">Border<ColorInput label="Code border color" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label">
                    <span>Radius</span>
                    <NumberInput key={`${selectedElement.id}-code-radius`} min={0} value={selectedElement.radius ?? 8} onCommit={(radius) => commitElement(selectedElement.id, { radius: Math.max(0, radius) })} />
                  </label>
                </>
              )}
              {selectedElement.type === "file-tree" && (
                <>
                  <label className="field-label wide">
                    Structure
                    <textarea
                      className="code-textarea"
                      spellCheck={false}
                      value={selectedElement.text ?? ""}
                      onChange={(event) => commitElement(selectedElement.id, { text: event.target.value })}
                      onKeyDown={handleIndentTextareaKeyDown}
                    />
                  </label>
                  <label className="field-label">
                    <span>Size</span>
                    <NumberInput
                      key={`${selectedElement.id}-tree-font-size`}
                      min={8}
                      max={48}
                      value={selectedElement.fontSize ?? 18}
                      onCommit={(fontSize) => commitElement(selectedElement.id, { fontSize })}
                    />
                  </label>
                  <label className="field-label compact-field">Background<ColorInput label="Structure background" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <label className="field-label compact-field">Text<ColorInput label="Structure text color" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label">
                    <span>Radius</span>
                    <NumberInput key={`${selectedElement.id}-tree-radius`} min={0} value={selectedElement.radius ?? 8} onCommit={(radius) => commitElement(selectedElement.id, { radius: Math.max(0, radius) })} />
                  </label>
                </>
              )}
              {selectedElement.type === "table" && (
                <>
                  <label className="field-label wide">
                    Table data
                    <textarea
                      className="code-textarea"
                      spellCheck={false}
                      value={selectedElement.text ?? ""}
                      onChange={(event) => commitElement(selectedElement.id, { text: event.target.value })}
                      onKeyDown={handleIndentTextareaKeyDown}
                    />
                    <span className="field-hint">Use tabs or commas to separate columns. First row is styled as the header.</span>
                  </label>
                  <label className="field-label">
                    <span>Size</span>
                    <NumberInput
                      key={`${selectedElement.id}-table-font-size`}
                      min={8}
                      max={48}
                      value={selectedElement.fontSize ?? 18}
                      onCommit={(fontSize) => commitElement(selectedElement.id, { fontSize })}
                    />
                  </label>
                  <label className="field-label compact-field">Background<ColorInput label="Table background" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <label className="field-label compact-field">Text<ColorInput label="Table text color" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label">
                    <span>Radius</span>
                    <NumberInput key={`${selectedElement.id}-table-radius`} min={0} value={selectedElement.radius ?? 8} onCommit={(radius) => commitElement(selectedElement.id, { radius: Math.max(0, radius) })} />
                  </label>
                </>
              )}
              {!selectedHasStrokeControls && (
                selectedElement.type !== "text" && selectedElement.type !== "code" && selectedElement.type !== "file-tree" && selectedElement.type !== "table" && (
                  <>
                    <label className="field-label compact-field">Fill<ColorInput label="Fill color" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                    {["rect", "diamond", "triangle", "circle", "cube", "sphere", "cylinder"].includes(selectedElement.type) && (
                      <label className="field-label compact-field">Stroke<ColorInput label="Stroke color" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                    )}
                    {selectedElement.type === "rect" && (
                      <label className="field-label"><span>Radius</span><NumberInput key={`${selectedElement.id}-radius`} min={0} value={selectedElement.radius ?? 0} onCommit={(value) => commitElement(selectedElement.id, { radius: Math.max(0, value) })} /></label>
                    )}
                    {isThreeShapeType(selectedElement.type) && (
                      <>
                        <label className="field-label"><span>Pitch</span><NumberInput key={`${selectedElement.id}-pitch`} min={-180} max={180} value={selectedElement.pitch ?? defaultThreeAngles.pitch} onCommit={(pitch) => commitElement(selectedElement.id, { pitch })} /></label>
                        <label className="field-label"><span>Yaw</span><NumberInput key={`${selectedElement.id}-yaw`} min={-180} max={180} value={selectedElement.yaw ?? defaultThreeAngles.yaw} onCommit={(yaw) => commitElement(selectedElement.id, { yaw })} /></label>
                        <label className="field-label"><span>Roll</span><NumberInput key={`${selectedElement.id}-roll`} min={-180} max={180} value={selectedElement.roll ?? defaultThreeAngles.roll} onCommit={(roll) => commitElement(selectedElement.id, { roll })} /></label>
                      </>
                    )}
                  </>
                )
              )}
              {selectedHasStrokeControls && (
                <>
                  {selectedSupportsOptionalFill && (
                    <div className="field-label wide">
                      <span>Fill</span>
                      <div className="segmented-control two-options">
                        <button type="button" className={!selectedHasFill ? "active" : ""} onClick={() => commitElement(selectedElement.id, { fill: "transparent" })}>None</button>
                        <button type="button" className={selectedHasFill ? "active" : ""} onClick={() => commitElement(selectedElement.id, { fill: selectedHasFill ? selectedElement.fill : "#ffffff" })}>On</button>
                      </div>
                    </div>
                  )}
                  {selectedSupportsOptionalFill && selectedHasFill && (
                    <label className="field-label compact-field">Fill color<ColorInput label="Fill color" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  )}
                  <label className="field-label compact-field">Color<ColorInput label="Line color" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label"><span>Width</span><NumberInput key={`${selectedElement.id}-stroke-width`} min={0} value={selectedElement.strokeWidth} onCommit={(value) => commitElement(selectedElement.id, { strokeWidth: Math.max(0, value) })} /></label>
                </>
              )}
              <label className="field-label wide">
                Reveal animation
                <select value={selectedElement.animation} onChange={(event) => commitElement(selectedElement.id, { animation: event.target.value as RevealAnimation })}>
                  <option value="none">No animation</option>
                  <option value="fade">Fade in</option>
                  <option value="fade-out">Fade out</option>
                  <option value="fade-up">Fade up</option>
                  <option value="zoom">Zoom</option>
                  <option value="slide-left">Slide left</option>
                </select>
              </label>
            </div>
          ) : selectedElements.length > 1 ? (
            <div className="inspector-grid">
              <p className="empty-state wide">Selected elements: {selectedElements.length}. Color and text controls are available after selecting one element.</p>
            </div>
          ) : (
            <div className="inspector-grid">
              <label className="field-label wide">
                Slide title
                <input value={activeSlide.title} onChange={(event) => commitSlide((slide) => ({ ...slide, title: event.target.value }))} />
              </label>
              <label className="field-label compact-field">
                Slide background
                <ColorInput label="Slide background" value={activeSlide.background} onChange={(background) => commitSlide((slide) => ({ ...slide, background }))} />
              </label>
              <label className="field-label wide">
                Slide transition
                <select value={activeSlide.transition} onChange={(event) => commitSlide((slide) => ({ ...slide, transition: event.target.value as SlideTransition }))}>
                  <option value="none">No animation</option>
                  <option value="fade">Fade</option>
                  <option value="slide">Slide</option>
                  <option value="zoom">Zoom</option>
                </select>
              </label>
            </div>
          )}
        </div>
        </aside>
      </div>

      {namespaceContextMenu && (
        <div
          className="context-menu namespace-context-menu"
          style={{ left: namespaceContextMenu.x, top: namespaceContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              const namespace = namespaces.find((item) => item.id === namespaceContextMenu.namespaceId);
              if (namespace) startRenameNamespace(namespace);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="danger-menu-item"
            onClick={() => requestDeleteNamespace(namespaceContextMenu.namespaceId)}
          >
            Delete
          </button>
        </div>
      )}

      {namespaceDeleteCandidate && (
        <div className="modal-backdrop" role="presentation" onPointerDown={() => setNamespaceDeleteCandidateId("")}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-namespace-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-namespace-title">Delete this namespace?</h2>
            <p>This will delete &quot;{namespaceDeleteCandidate.name}&quot; and its projects. You can undo the action with Ctrl+Z.</p>
            <div className="confirm-actions">
              <button type="button" className="small-button" onClick={() => setNamespaceDeleteCandidateId("")}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-confirm-button"
                onClick={() => deleteNamespace(namespaceDeleteCandidate.id)}
              >
                Delete namespace
              </button>
            </div>
          </div>
        </div>
      )}

      {slideContextMenu && (
        <div
          className="context-menu slide-context-menu"
          style={{ left: slideContextMenu.x, top: slideContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="danger-menu-item"
            disabled={activeProject.slides.length <= 1}
            onClick={() => requestDeleteSlide(slideContextMenu.slideId)}
          >
            Delete
          </button>
        </div>
      )}

      {slideDeleteCandidate && (
        <div className="modal-backdrop" role="presentation" onPointerDown={() => setSlideDeleteCandidateId("")}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-slide-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-slide-title">Delete this slide?</h2>
            <p>This will permanently delete &quot;{slideDeleteCandidate.title}&quot;. You can undo the action with Ctrl+Z.</p>
            <div className="confirm-actions">
              <button type="button" className="small-button" onClick={() => setSlideDeleteCandidateId("")}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-confirm-button"
                onClick={() => {
                  deleteSlide(slideDeleteCandidate.id);
                  setSlideDeleteCandidateId("");
                }}
              >
                Delete slide
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => { deleteElement(); setContextMenu(null); setContextSubmenu(null); }}>Delete</button>
          {canUngroupContextTargets ? (
            <button type="button" onClick={ungroupContextElements}>Ungroup elements</button>
          ) : canGroupContextTargets && (
            <button type="button" onClick={groupContextElements}>Group elements</button>
          )}
          <div className={`context-submenu ${contextSubmenu === "z-index" ? "open" : ""}`} onPointerEnter={() => setContextSubmenu("z-index")}>
            <button type="button" className="context-parent" onFocus={() => setContextSubmenu("z-index")}>Z-index</button>
            <div className="context-flyout">
              <button type="button" onClick={() => moveContextElementsZ("front")}>Bring to front</button>
              <button type="button" onClick={() => moveContextElementsZ("forward")}>Bring forward</button>
              <button type="button" onClick={() => moveContextElementsZ("backward")}>Send backward</button>
              <button type="button" onClick={() => moveContextElementsZ("back")}>Send to back</button>
            </div>
          </div>
          <div className={`context-submenu ${contextSubmenu === "reveal" ? "open" : ""}`} onPointerEnter={() => setContextSubmenu("reveal")}>
            <button type="button" className="context-parent" onFocus={() => setContextSubmenu("reveal")}>Reveal</button>
            <div className="context-flyout">
              {Array.from({ length: maxReveal + 1 }, (_, index) => index + 1).map((reveal) => (
                <button type="button" key={reveal} onClick={() => setContextElementsPatch({ reveal })}>{reveal}</button>
              ))}
            </div>
          </div>
          <div className={`context-submenu ${contextSubmenu === "animation" ? "open" : ""}`} onPointerEnter={() => setContextSubmenu("animation")}>
            <button type="button" className="context-parent" onFocus={() => setContextSubmenu("animation")}>Animation</button>
            <div className="context-flyout">
              <button type="button" onClick={() => setSelectedAnimation("fade")}>Fade in</button>
              <button type="button" onClick={() => setSelectedAnimation("fade-out")}>Fade out</button>
              <button type="button" onClick={() => setSelectedAnimation("fade-up")}>Fade up</button>
              <button type="button" onClick={() => setSelectedAnimation("zoom")}>Zoom</button>
              <button type="button" onClick={() => setSelectedAnimation("slide-left")}>Slide left</button>
              <button type="button" onClick={() => setSelectedAnimation("none")}>No animation</button>
            </div>
          </div>
        </div>
      )}

      {presenting && (
        <div className="presenter" onClick={presentNext}>
          <div
            key={activeSlide.id}
            className={`present-stage slide-${activeSlide.transition} ${showPreviewGrid ? "" : "hide-grid"}`}
            style={
              {
                backgroundColor: activeSlide.background,
                backgroundImage: showPreviewGrid ? undefined : "none",
                "--grid-color": getGridColor(activeSlide.background),
              } as CSSProperties
            }
          >
            {sortByReveal(activeSlide.elements)
              .filter((element) => element.reveal <= presentReveal)
              .map((element) => renderElement(element, false, presentReveal))}
          </div>
          <div className="present-controls" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={presentPrev}>Back</button>
            <span>{activeSlideIndex + 1}.{presentReveal} / {activeProject.slides.length}.{maxReveal}</span>
            <button type="button" onClick={() => setPresenting(false)}>Exit</button>
          </div>
        </div>
      )}
    </main>
  );
}
