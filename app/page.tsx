"use client";

import { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import hljs from "highlight.js";

type ElementType =
  | "text"
  | "rect"
  | "border-rect"
  | "circle"
  | "border-circle"
  | "diamond"
  | "triangle"
  | "line"
  | "arrow"
  | "dashed-arrow"
  | "double-arrow"
  | "image"
  | "code"
  | "file-tree";
type RevealAnimation = "none" | "fade" | "fade-out" | "fade-up" | "zoom" | "slide-left";
type SlideTransition = "none" | "fade" | "slide" | "zoom";
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type SlideElement = {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  reveal: number;
  animation: RevealAnimation;
  text?: string;
  textHtml?: string;
  src?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: "left" | "center" | "right";
  textAutoSize?: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
  language?: string;
  groupId?: string;
};

type ElementTransformSnapshot = Pick<
  SlideElement,
  "id" | "type" | "x" | "y" | "width" | "height" | "fontSize" | "fontWeight" | "text" | "textHtml" | "textAutoSize"
>;
type SingleElementTransformSnapshot = Omit<ElementTransformSnapshot, "id">;

type Slide = {
  id: string;
  title: string;
  background: string;
  transition: SlideTransition;
  elements: SlideElement[];
};

type Project = {
  id: string;
  name: string;
  updatedAt: number;
  slides: Slide[];
};

type DragState =
  | {
      mode: "move";
      elementIds: string[];
      pointerId: number;
      startX: number;
      startY: number;
      startElements: ElementTransformSnapshot[];
    }
  | {
      mode: "resize";
      elementIds: string[];
      pointerId: number;
      startX: number;
      startY: number;
      handle: ResizeHandle;
      startBounds: Bounds;
      startElements: ElementTransformSnapshot[];
    }
  | {
      mode: "single-resize";
      elementId: string;
      pointerId: number;
      startX: number;
      startY: number;
      handle: ResizeHandle;
      startElement: SingleElementTransformSnapshot;
    }
  | {
      mode: "rotate";
      elementId: string;
      pointerId: number;
    };

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AlignmentGuide = {
  orientation: "vertical" | "horizontal";
  position: number;
};

type MarqueeSelectionState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  baseSelectedIds: string[];
  additive: boolean;
};

type PendingPlacement = {
  type: ElementType;
  textPreset?: TextPreset;
  point: { x: number; y: number } | null;
};

type ContextMenuState = {
  x: number;
  y: number;
  elementId: string;
} | null;
type ContextSubmenu = "z-index" | "reveal" | "animation" | null;

type StoredProject = Omit<Project, "slides"> & {
  slides: Array<
    Omit<Partial<Slide>, "elements"> &
      Pick<Slide, "id" | "title" | "background"> & {
        elements: Array<Partial<SlideElement> & Pick<SlideElement, "id" | "type" | "x" | "y" | "width" | "height">>;
      }
  >;
};

type RemoteProjectsResponse = {
  configured: boolean;
  projects: StoredProject[] | null;
  updatedAt: number;
};

const canvasWidth = 1280;
const canvasHeight = 720;
const storageKey = "reveals-studio-projects-v1";
const projectDbName = "reveals-studio-db";
const projectDbStoreName = "kv";
const preferencesKey = "reveals-studio-element-preferences-v1";
const internalClipboardType = "application/x-reveals-elements";
const gridSize = 16;
const snapThreshold = 6;
const revealColors = ["#2f6fed", "#f97316", "#14b8a6", "#f43f5e", "#8b5cf6", "#0f766e", "#111827"];
const resizeHandles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const arrowTypes: ElementType[] = ["arrow", "dashed-arrow", "double-arrow"];
const codeLanguages = ["javascript", "typescript", "tsx", "css", "html", "json", "python", "bash", "cpp", "plaintext"];
type TextPreset = "title" | "subtitle" | "body";
const textPresets: Record<TextPreset, { label: string; text: string; fontSize: number; fontWeight: number }> = {
  title: { label: "Title", text: "Title", fontSize: 64, fontWeight: 900 },
  subtitle: { label: "Subtitle", text: "Subtitle", fontSize: 42, fontWeight: 750 },
  body: { label: "Text", text: "Text", fontSize: 28, fontWeight: 450 },
};
const toolItems: Array<{ type: ElementType; label: string; icon: string; textPreset?: TextPreset }> = [
  { type: "text", label: "Title", icon: "text-title", textPreset: "title" },
  { type: "text", label: "Subtitle", icon: "text-subtitle", textPreset: "subtitle" },
  { type: "text", label: "Text", icon: "text-body", textPreset: "body" },
  { type: "code", label: "Код", icon: "code" },
  { type: "file-tree", label: "Файлы", icon: "file-tree" },
  { type: "rect", label: "Прямоугольник", icon: "rect" },
  { type: "border-rect", label: "Рамка", icon: "border-rect" },
  { type: "circle", label: "Круг", icon: "circle" },
  { type: "border-circle", label: "Окружность", icon: "border-circle" },
  { type: "diamond", label: "Ромб", icon: "diamond" },
  { type: "triangle", label: "Треугольник", icon: "triangle" },
  { type: "line", label: "Линия", icon: "line" },
  { type: "arrow", label: "Стрелка", icon: "arrow" },
  { type: "dashed-arrow", label: "Пунктирная стрелка", icon: "dashed-arrow" },
  { type: "double-arrow", label: "Двухсторонняя стрелка", icon: "double-arrow" },
];

type ElementStylePreferences = Record<
  ElementType,
  Partial<Pick<SlideElement, "fill" | "stroke">>
>;

const defaultElementPreferences = (): ElementStylePreferences => ({
  text: { fill: "#111827", stroke: "#111827" },
  code: { fill: "#282c34", stroke: "#111827" },
  "file-tree": { fill: "#ffffff", stroke: "#111827" },
  rect: { fill: "#ffffff", stroke: "#111827" },
  "border-rect": { fill: "transparent", stroke: "#111827" },
  circle: { fill: "#ffffff", stroke: "#111827" },
  "border-circle": { fill: "transparent", stroke: "#111827" },
  diamond: { fill: "#ffffff", stroke: "#111827" },
  triangle: { fill: "#ffffff", stroke: "#111827" },
  line: { fill: "transparent", stroke: "#111827" },
  arrow: { fill: "transparent", stroke: "#111827" },
  "dashed-arrow": { fill: "transparent", stroke: "#111827" },
  "double-arrow": { fill: "transparent", stroke: "#111827" },
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

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
};

const cloneProjects = (projects: Project[]) => structuredClone(projects) as Project[];
const hasLargeEmbeddedMedia = (projects: Project[]) =>
  projects.some((project) =>
    project.slides.some((slide) =>
      slide.elements.some((element) => typeof element.src === "string" && element.src.startsWith("data:") && element.src.length > 120_000),
    ),
  );
const getProjectsUpdatedAt = (projects: Project[]) => Math.max(0, ...projects.map((project) => project.updatedAt));
const mergeProjectsByFreshness = (localProjects: Project[], remoteProjects: Project[]) => {
  const merged = new Map<string, Project>();
  localProjects.forEach((project) => merged.set(project.id, project));
  remoteProjects.forEach((project) => {
    const localProject = merged.get(project.id);
    if (!localProject || project.updatedAt > localProject.updatedAt) {
      merged.set(project.id, project);
    }
  });

  return [...merged.values()].sort((first, second) => second.updatedAt - first.updatedAt);
};
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const textPaddingX = 8;
const textPaddingY = 6;
const minTextWidth = 32;
const minTextFontSize = 8;
const maxTextFontSize = 160;
const colorPickerWidth = 246;
const colorPickerHeight = 248;

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
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

const readProjectsFromDb = async () => {
  const db = await openProjectDb();
  if (!db) return null;

  return new Promise<StoredProject[] | null>((resolve) => {
    const transaction = db.transaction(projectDbStoreName, "readonly");
    const request = transaction.objectStore(projectDbStoreName).get(storageKey);
    request.onsuccess = () => resolve((request.result as StoredProject[] | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const writeProjectsToDb = async (projects: Project[]) => {
  const db = await openProjectDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(projectDbStoreName, "readwrite");
    transaction.objectStore(projectDbStoreName).put(projects, storageKey);
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

const readProjectsFromRemote = async () => {
  try {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return null;
    const result = await response.json() as RemoteProjectsResponse;
    return result.configured && result.projects ? normalizeProjects(result.projects) : null;
  } catch {
    return null;
  }
};

const writeProjectsToRemote = async (projects: Project[]) => {
  try {
    await fetch("/api/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projects,
        updatedAt: getProjectsUpdatedAt(projects),
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
  if (typeof document === "undefined") return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.innerText;
};

const sanitizeRichTextHtml = (html: string) => {
  if (typeof document === "undefined") return textToHtml(htmlToPlainText(html));
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["B", "STRONG", "I", "EM", "BR", "DIV", "P", "SPAN"]);

  template.content.querySelectorAll("*").forEach((node) => {
    const style = node.getAttribute("style") ?? "";
    const fontSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)px/i)?.[1];
    const fontWeight = style.match(/font-weight:\s*(\d+)/i)?.[1];
    [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    if (node.tagName === "SPAN") {
      const safeStyles = [
        fontSize ? `font-size: ${clamp(Number(fontSize), minTextFontSize, maxTextFontSize)}px` : "",
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
    const nextFontSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)px/i)?.[1];
    const nextFontWeight = style.match(/font-weight:\s*(\d+)/i)?.[1];
    if (nextFontSize) fontSize = Math.max(fontSize, Number(nextFontSize));
    if (nextFontWeight) fontWeight = Math.max(fontWeight, Number(nextFontWeight));
  });

  return { fontSize, fontWeight };
};

const scaleRichTextHtmlFontSizes = (html: string | undefined, scale: number) => {
  if (!html || typeof document === "undefined" || !Number.isFinite(scale) || Math.abs(scale - 1) < 0.001) return html;
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll("[style]").forEach((node) => {
    const element = node as HTMLElement;
    const style = element.getAttribute("style") ?? "";
    const fontSize = style.match(/font-size:\s*(\d+(?:\.\d+)?)px/i)?.[1];
    if (!fontSize) return;
    element.style.fontSize = `${clamp(Number(fontSize) * scale, minTextFontSize, maxTextFontSize)}px`;
  });

  return sanitizeRichTextHtml(template.innerHTML);
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
    height: Math.ceil(lines.length * fontSize * 1.12 + textPaddingY),
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

const boundsIntersect = (first: Bounds, second: Bounds) =>
  first.x <= second.x + second.width &&
  first.x + first.width >= second.x &&
  first.y <= second.y + second.height &&
  first.y + first.height >= second.y;

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

const textFitsBounds = (text: string, fontSize: number, fontWeight: number, bounds: Bounds) => {
  const measured = estimateTextBounds(text, fontSize, bounds.width, fontWeight);
  return measured.width <= bounds.width + 0.5 && measured.height <= bounds.height + 0.5;
};

const findTextFontSizeForBounds = (
  text: string,
  fontWeight: number,
  bounds: Bounds,
  preferredFontSize: number,
) => {
  const width = Math.max(minTextWidth, bounds.width);
  const height = Math.max(textPaddingY + minTextFontSize * 1.12, bounds.height);
  const fitBounds = { ...bounds, width, height };
  let low = minTextFontSize;
  let high = maxTextFontSize;

  for (let index = 0; index < 14; index += 1) {
    const next = (low + high) / 2;
    if (textFitsBounds(text, next, fontWeight, fitBounds)) {
      low = next;
    } else {
      high = next;
    }
  }

  return clamp(Math.min(preferredFontSize, low), minTextFontSize, maxTextFontSize);
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

  if (handle.length === 1) {
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
  }

  const widthScale = Math.max(minTextWidth, bounds.width) / Math.max(minTextWidth, startElement.width);
  const heightScale = Math.max(1, bounds.height) / Math.max(1, startElement.height);
  const preferredScale = Math.min(widthScale, heightScale);
  const preferredFontSize = clamp(startFontSize * preferredScale, minTextFontSize, maxTextFontSize);
  const fontSize = findTextFontSizeForBounds(text, fontWeight, { ...bounds, width }, preferredFontSize);
  const measured = estimateTextBounds(text, fontSize, width, fontWeight);
  const fitted = anchorTextBounds(
    bounds,
    {
      width,
      height: Math.max(measured.height, Math.min(bounds.height, canvasHeight - bounds.y)),
    },
    handle,
  );
  const htmlScale = fontSize / startFontSize;

  return {
    bounds: fitted,
    fontSize: Math.round(fontSize * 10) / 10,
    textHtml: scaleRichTextHtmlFontSizes(startElement.textHtml ?? element.textHtml, htmlScale),
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
        fill: element.type === "text" ? "#111827" : element.type === "code" ? "#282c34" : element.type === "file-tree" ? "#ffffff" : "#ffffff",
        stroke: "#111827",
        strokeWidth: ["border-rect", "border-circle"].includes(element.type) ? 4 : element.type === "arrow" || element.type === "line" ? 8 : element.type === "code" ? 1 : 0,
        reveal: 1,
        rotation: 0,
        zIndex: index + 1,
        animation: "fade" as RevealAnimation,
        radius: 16,
        fontSize: element.type === "code" ? 14 : element.type === "file-tree" ? 18 : 36,
        fontWeight: element.type === "text" ? 800 : undefined,
        textAlign: element.type === "text" ? "left" : undefined,
        language: element.type === "code" ? "javascript" : undefined,
        ...element,
        textHtml: element.type === "text" ? element.textHtml ?? textToHtml(element.text ?? "") : undefined,
      })),
    })),
  }));

const starterProject = (): Project => ({
  id: makeId(),
  name: "ROS 2 Architecture Pitch",
  updatedAt: Date.now(),
  slides: [
    {
      id: makeId(),
      title: "Главная схема",
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
          text: "Динамическая презентация",
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
          text: "Слайд",
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
  const undoStackRef = useRef<Project[][]>([]);
  const saveProjectsTimerRef = useRef<number | null>(null);
  const editingTextDraftRef = useRef("");
  const editingTextHtmlDraftRef = useRef("");
  const editingTextNodeRef = useRef<HTMLDivElement | null>(null);
  const editingTextFocusModeRef = useRef<"end" | "select-all">("end");
  const savedTextSelectionRef = useRef<Range | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [elementPreferences, setElementPreferences] = useState<ElementStylePreferences>(defaultElementPreferences);
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
  const [contextSubmenu, setContextSubmenu] = useState<ContextSubmenu>(null);
  const [clipboardElements, setClipboardElements] = useState<SlideElement[]>([]);
  const [presenting, setPresenting] = useState(false);
  const [presentReveal, setPresentReveal] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      let nextProjects = [starterProject()];
      try {
        const savedFromDb = await readProjectsFromDb();
        const savedFromStorage = savedFromDb ? null : window.localStorage.getItem(storageKey);
        const saved = savedFromDb ?? (savedFromStorage ? JSON.parse(savedFromStorage) as StoredProject[] : null);
        nextProjects = saved ? normalizeProjects(saved) : nextProjects;
        const remoteProjects = await readProjectsFromRemote();
        if (remoteProjects) {
          nextProjects = mergeProjectsByFreshness(nextProjects, remoteProjects);
        }
        const savedPreferences = window.localStorage.getItem(preferencesKey);
        if (savedPreferences) {
          setElementPreferences(normalizeElementPreferences(JSON.parse(savedPreferences) as Partial<Record<ElementType, Partial<SlideElement>>>));
        }
      } catch {
        nextProjects = [starterProject()];
      }
      if (cancelled) return;
      setProjects(nextProjects);
      setActiveProjectId(nextProjects[0]?.id ?? "");
      setActiveSlideId(nextProjects[0]?.slides[0]?.id ?? "");
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
    const projectsToSave = projects;

    saveProjectsTimerRef.current = window.setTimeout(() => {
      void writeProjectsToDb(projectsToSave);
      void writeProjectsToRemote(projectsToSave);
      if (hasLargeEmbeddedMedia(projectsToSave)) return;

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(projectsToSave));
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
  }, [loaded, projects]);

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

  const revealGroups = (() => {
    const groups = new Map<number, number>();
    const countedGroups = new Set<string>();
    activeSlide?.elements.forEach((element) => {
      if (element.type === "file-tree") {
        getFileTreeRows(element.text ?? "").forEach((_, index) => {
          const reveal = element.reveal + index;
          groups.set(reveal, (groups.get(reveal) ?? 0) + 1);
        });
        return;
      }
      if (element.groupId) {
        if (countedGroups.has(element.groupId)) return;
        countedGroups.add(element.groupId);
      }
      groups.set(element.reveal, (groups.get(element.reveal) ?? 0) + 1);
    });
    return [...groups.entries()].sort((first, second) => first[0] - second[0]);
  })();

  const pushUndoSnapshot = (snapshot = projects) => {
    const historyLimit = hasLargeEmbeddedMedia(snapshot) ? 12 : 80;
    undoStackRef.current = [...undoStackRef.current.slice(-(historyLimit - 1)), cloneProjects(snapshot)];
  };

  const undoLastChange = () => {
    const previousProjects = undoStackRef.current.at(-1);
    if (!previousProjects) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setDragState(null);
    setMarqueeSelection(null);
    setPendingPlacement(null);
    setAlignmentGuides([]);
    setContextMenu(null);
    finishTextEditing(false);
    setProjects(previousProjects);
    const nextActiveProject = previousProjects.find((project) => project.id === activeProjectId) ?? previousProjects[0];
    const nextActiveSlide = nextActiveProject?.slides.find((slide) => slide.id === activeSlideId) ?? nextActiveProject?.slides[0];
    setActiveProjectId(nextActiveProject?.id ?? "");
    setActiveSlideId(nextActiveSlide?.id ?? "");
    setSelectedElementIds((current) =>
      current.filter((id) => nextActiveSlide?.elements.some((element) => element.id === id)),
    );
  };

  const commitProjects = (updater: (project: Project) => Project, options: { history?: boolean } = {}) => {
    if (!activeProject) return;
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== activeProject.id) return project;
        if (options.history !== false) pushUndoSnapshot(current);
        return { ...updater(project), updatedAt: Date.now() };
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
    const maxZ = Math.max(0, ...activeSlide.elements.map((element) => element.zIndex));
    const minZ = Math.min(0, ...activeSlide.elements.map((element) => element.zIndex));
    ids.forEach((id) => {
      const element = activeSlide.elements.find((item) => item.id === id);
      if (!element) return;
      const nextZ =
        direction === "front"
          ? maxZ + 1
          : direction === "back"
            ? minZ - 1
            : direction === "forward"
              ? element.zIndex + 1
              : element.zIndex - 1;
      commitElement(id, { zIndex: nextZ });
    });
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

  const startTextEditing = (element: SlideElement, focusMode: "end" | "select-all" = "end") => {
    if (element.type !== "text" && element.type !== "code") return;
    const nextHtml = element.textHtml ?? textToHtml(element.text ?? "");
    setSelectedElementIds([element.id]);
    setEditingTextId(element.id);
    editingTextFocusModeRef.current = focusMode;
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
    editingTextNodeRef.current = null;
    savedTextSelectionRef.current = null;
  };

  const saveTextSelection = () => {
    const editor = editingTextNodeRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedTextSelectionRef.current = range.cloneRange();
    }
  };

  const applyRichTextCommand = (command: "bold" | "italic") => {
    const editor = editingTextNodeRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const range = savedTextSelectionRef.current;
    if (selection && range) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand(command);
    editingTextHtmlDraftRef.current = sanitizeRichTextHtml(editor.innerHTML);
    editingTextDraftRef.current = editor.innerText.replace(/\n$/, "");
    saveTextSelection();
  };

  const applyRichTextStyle = (style: Partial<Pick<CSSStyleDeclaration, "fontSize" | "fontWeight">>) => {
    const editor = editingTextNodeRef.current;
    const range = savedTextSelectionRef.current;
    if (!editor || !range || range.collapsed) return;

    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const span = document.createElement("span");
    if (style.fontSize) span.style.fontSize = style.fontSize;
    if (style.fontWeight) span.style.fontWeight = style.fontWeight;
    span.append(range.extractContents());
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    savedTextSelectionRef.current = nextRange.cloneRange();
    editingTextHtmlDraftRef.current = sanitizeRichTextHtml(editor.innerHTML);
    editingTextDraftRef.current = editor.innerText.replace(/\n$/, "");
  };

  const applySelectedTextFontDelta = (delta: number) => {
    const baseSize = selectedElement?.fontSize ?? 36;
    applyRichTextStyle({ fontSize: `${clamp(baseSize + delta, 8, 160)}px` });
  };

  const applySelectedTextWeightDelta = (delta: number) => {
    const baseWeight = selectedElement?.fontWeight ?? 800;
    applyRichTextStyle({ fontWeight: String(clamp(baseWeight + delta, 100, 900)) });
  };

  const focusTextEditor = (node: HTMLDivElement, focusMode: "end" | "select-all") => {
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    if (focusMode === "end") range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    saveTextSelection();
  };

  const stagePoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - rect.left) * (canvasWidth / rect.width), 0, canvasWidth),
      y: clamp((clientY - rect.top) * (canvasHeight / rect.height), 0, canvasHeight),
    };
  };

  const activeSlideMaxReveal = (slide: Slide) => Math.max(1, ...slide.elements.map(getElementMaxReveal));

  const showSlide = (slideId: string, reveal = 1) => {
    setActiveSlideId(slideId);
    setSelectedElementIds([]);
    setPresentReveal(reveal);
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

  const addProject = () => {
    const project = starterProject();
    project.name = `Новый проект ${projects.length + 1}`;
    pushUndoSnapshot();
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    showSlide(project.slides[0].id);
  };

  const deleteProject = (projectId: string) => {
    pushUndoSnapshot();
    const remainingProjects = projects.filter((project) => project.id !== projectId);
    const nextProjects = remainingProjects.length > 0 ? remainingProjects : [starterProject()];
    const nextActiveProject =
      activeProjectId === projectId ? nextProjects[0] : nextProjects.find((project) => project.id === activeProjectId) ?? nextProjects[0];

    setProjects(nextProjects);
    setActiveProjectId(nextActiveProject.id);
    setActiveSlideId(nextActiveProject.slides[0]?.id ?? "");
    setSelectedElementIds([]);
  };

  const addSlide = () => {
    if (!activeProject) return;
    const slide: Slide = {
      id: makeId(),
      title: `Слайд ${activeProject.slides.length + 1}`,
      background: "#ffffff",
      transition: "fade",
      elements: [],
    };
    commitProjects((project) => ({ ...project, slides: [...project.slides, slide] }));
    showSlide(slide.id);
  };

  const makeElement = (type: ElementType, textPreset?: TextPreset, center?: { x: number; y: number }): SlideElement => {
    const isLine = type === "line" || arrowTypes.includes(type);
    const isBorderOnly = type === "border-rect" || type === "border-circle" || isLine;
    const isCode = type === "code";
    const isFileTree = type === "file-tree";
    const offset = ((activeSlide?.elements.length ?? 0) % 6) * 28;
    const preset = textPreset ? textPresets[textPreset] : textPresets.body;
    const preferences = elementPreferences[type];
    const defaultText = isCode
      ? "const hello = 'world';"
      : isFileTree
        ? "src/\n  app/\n    page.tsx\n    globals.css\n  components/\n    Button.tsx\npackage.json"
        : preset.text;
    const fontSize = type === "text" ? preset.fontSize : isCode ? 14 : isFileTree ? 18 : 36;
    const fontWeight = type === "text" ? preset.fontWeight : undefined;
    const textBounds = estimateTextBounds(defaultText, fontSize, undefined, fontWeight);
    const width = type === "text" ? textBounds.width : isCode ? 480 : isFileTree ? 420 : isLine ? 280 : 210;
    const height = type === "text" ? textBounds.height : isCode ? 240 : isFileTree ? 280 : isLine ? 24 : 140;
    const x = center ? center.x - width / 2 : 180 + offset;
    const y = center ? center.y - height / 2 : 150 + offset;

    return {
      id: makeId(),
      type,
      x: Math.round(clamp(x, 0, canvasWidth - width)),
      y: Math.round(clamp(y, 0, canvasHeight - height)),
      width,
      height,
      rotation: 0,
      zIndex: Math.max(0, ...(activeSlide?.elements.map((element) => element.zIndex) ?? [0])) + 1,
      reveal: 1,
      animation: "fade",
      text: type === "text" || isCode || isFileTree ? defaultText : undefined,
      textHtml: type === "text" ? textToHtml(defaultText) : undefined,
      fontSize,
      fontWeight,
      textAlign: type === "text" ? "left" : undefined,
      textAutoSize: type === "text" ? true : undefined,
      fill: type === "text" ? preferences.fill ?? "#111827" : isBorderOnly ? "transparent" : preferences.fill ?? "#ffffff",
      stroke: preferences.stroke ?? "#111827",
      strokeWidth: type === "text" ? 0 : isCode ? 1 : isLine ? 8 : isBorderOnly ? 4 : 0,
      radius: isCode || isFileTree ? 8 : 16,
      language: isCode ? "javascript" : undefined,
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

  const activatePlacementTool = (type: ElementType, textPreset?: TextPreset) => {
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

  const shouldPassThroughElement = (element: SlideElement, point: { x: number; y: number }) => {
    if (!elementContainsPoint(element, point)) return false;
    const localX = point.x - element.x;
    const localY = point.y - element.y;
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

    return false;
  };

  const findTopElementAtPoint = (point: { x: number; y: number }, excludedIds: string[]) =>
    [...(activeSlide?.elements ?? [])]
      .filter((item) => !excludedIds.includes(item.id) && elementContainsPoint(item, point) && !shouldPassThroughElement(item, point))
      .sort((first, second) => second.zIndex - first.zIndex || second.reveal - first.reveal)[0];

  const selectElementsInBounds = (bounds: Bounds, baseSelectedIds: string[] = []) => {
    const baseIds = new Set(baseSelectedIds);
    const matchedIds =
      activeSlide?.elements
        .filter((element) => boundsIntersect(bounds, element))
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
    selectElementsInBounds(bounds, nextMarquee.baseSelectedIds);
  };

  const stopMarqueeSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!marqueeSelection || event.pointerId !== marqueeSelection.pointerId) return;
    const bounds = normalizeBounds(
      { x: marqueeSelection.startX, y: marqueeSelection.startY },
      { x: marqueeSelection.currentX, y: marqueeSelection.currentY },
    );

    if (bounds.width < 4 && bounds.height < 4) {
      setSelectedElementIds(marqueeSelection.baseSelectedIds);
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setMarqueeSelection(null);
  };

  const startMove = (event: PointerEvent<HTMLElement>, element: SlideElement, ignoredIds: string[] = []) => {
    if (editingTextId) return;
    const point = stagePoint(event.clientX, event.clientY);
    const elementGroupIds = expandElementIds([element.id]);
    const elementIsSelected = elementGroupIds.every((id) => selectedElementIds.includes(id));
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
    const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey;
    const nextSelectedIds = isMultiSelect
      ? elementIsSelected
        ? selectedElementIds.filter((id) => !elementGroupIds.includes(id))
        : expandElementIds([...selectedElementIds, ...elementGroupIds])
      : elementIsSelected
        ? selectedElementIds
        : elementGroupIds;
    if (!nextSelectedIds.includes(element.id)) {
      setSelectedElementIds(nextSelectedIds);
      setDragState(null);
      return;
    }

    const movingIds = expandElementIds(nextSelectedIds);
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
        fontSize: item.fontSize,
      })),
    });
  };

  const startSelectionMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!selectionBounds || selectedElements.length === 0 || event.button !== 0) return;
    const point = stagePoint(event.clientX, event.clientY);

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
        fontSize: item.fontSize,
      })),
    });
  };

  const handleElementDoubleClick = (event: MouseEvent<HTMLElement>, element: SlideElement) => {
    event.stopPropagation();
    const point = stagePoint(event.clientX, event.clientY);
    if (shouldPassThroughElement(element, point)) {
      const passthroughTarget = findTopElementAtPoint(point, [element.id]);
      if (passthroughTarget?.type === "text" || passthroughTarget?.type === "code") startTextEditing(passthroughTarget);
      return;
    }

    if (element.type === "text" || element.type === "code") startTextEditing(element);
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
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        text: element.text,
        textHtml: element.textHtml,
        textAutoSize: element.textAutoSize,
      },
    });
  };

  const startRotate = (event: PointerEvent<HTMLButtonElement>, element: SlideElement) => {
    event.stopPropagation();
    setAlignmentGuides([]);
    pushUndoSnapshot();
    setSelectedElementIds([element.id]);
    setDragState({ mode: "rotate", elementId: element.id, pointerId: event.pointerId });
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
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        text: item.text,
        textHtml: item.textHtml,
        textAutoSize: item.textAutoSize,
      })),
    });
  };

  const applyDrag = (pointerId: number, clientX: number, clientY: number) => {
    if (!dragState || pointerId !== dragState.pointerId) return;
    const point = stagePoint(clientX, clientY);

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
        arrowTypes.includes(dragState.startElement.type) || dragState.startElement.type === "line"
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
        },
        { history: false },
      );
    }

    if (dragState.mode === "rotate") {
      const element = activeSlide?.elements.find((item) => item.id === dragState.elementId);
      if (!element) return;
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      const angle = Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI) - 90;
      setAlignmentGuides([]);
      commitElement(element.id, { rotation: Math.round(angle) }, { history: false });
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

      if (!presenting && selectedElements.length > 0 && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateElement();
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
      if (isEditing || presenting || selectedElements.length === 0) return;

      const elements = getElementsForClipboard();
      const serializedElements = JSON.stringify(elements);
      event.preventDefault();
      setClipboardElements(elements);
      event.clipboardData?.setData(internalClipboardType, serializedElements);
      event.clipboardData?.setData("text/plain", `REVEALS_ELEMENTS:${serializedElements}`);
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
              className="element-text element-text-editor"
              style={{
                color: element.fill,
                fontSize: `calc(${(element.fontSize ?? 32) / canvasWidth} * 100cqw)`,
                fontWeight: element.fontWeight ?? 800,
                textAlign: element.textAlign ?? "left",
              }}
              onInput={(event) => {
                editingTextDraftRef.current = event.currentTarget.innerText.replace(/\n$/, "");
                editingTextHtmlDraftRef.current = sanitizeRichTextHtml(event.currentTarget.innerHTML);
                saveTextSelection();
              }}
              onMouseUp={saveTextSelection}
              onKeyUp={saveTextSelection}
              onPaste={(event) => {
                event.preventDefault();
                document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
              }}
              onBlur={() => finishTextEditing(true)}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              ref={(node) => {
                if (!node) return;
                const isNewEditor = editingTextNodeRef.current !== node;
                editingTextNodeRef.current = node;
                if (node.innerHTML !== editingTextValue) node.innerHTML = editingTextValue;
                const focusMode = editingTextFocusModeRef.current;
                focusTextEditor(node, focusMode);
                if (isNewEditor) {
                  requestAnimationFrame(() => {
                    if (editingTextNodeRef.current !== node) return;
                    focusTextEditor(node, focusMode);
                    editingTextFocusModeRef.current = "end";
                  });
                }
              }}
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
              className="element-code element-code-editor"
              style={{
                backgroundColor: element.fill,
                fontSize: `calc(${(element.fontSize ?? 14) / canvasWidth} * 100cqw)`,
                borderColor: element.stroke,
                borderRadius: element.radius,
              }}
              onInput={(event) => {
                editingTextDraftRef.current = event.currentTarget.innerText.replace(/\n$/, "");
                editingTextHtmlDraftRef.current = editingTextDraftRef.current;
              }}
              onMouseUp={saveTextSelection}
              onKeyUp={saveTextSelection}
              onPaste={(event) => {
                event.preventDefault();
                document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
              }}
              onBlur={() => finishTextEditing(true)}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              ref={(node) => {
                if (!node) return;
                const isNewEditor = editingTextNodeRef.current !== node;
                editingTextNodeRef.current = node;
                if (node.textContent !== editingTextValue) node.textContent = editingTextValue;
                const focusMode = editingTextFocusModeRef.current;
                focusTextEditor(node, focusMode);
                if (isNewEditor) {
                  requestAnimationFrame(() => {
                    if (editingTextNodeRef.current !== node) return;
                    focusTextEditor(node, focusMode);
                    editingTextFocusModeRef.current = "end";
                  });
                }
              }}
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
        {(element.type === "rect" || element.type === "border-rect") && (
          <div
            className="shape rect"
            style={{
              background: element.type === "border-rect" ? "transparent" : element.fill,
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
              background: element.type === "border-circle" ? "transparent" : element.fill,
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
        {element.type === "line" && (
          <div
            className="line-shape"
            style={{ color: element.stroke, "--stroke-size": strokeSize } as CSSProperties}
          />
        )}
        {arrowTypes.includes(element.type) && (
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
        {element.type === "image" && element.src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="media-element" src={element.src} alt="" draggable={false} />
        )}
      </div>
    );
  };

  const renderRevealBadge = (element: SlideElement) => {
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
    const offset = element.groupId || element.type === "text" ? -18 : 6;

    return (
      <span
        aria-hidden="true"
        className="reveal-badge stage-reveal-badge"
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

  const selectedHasStrokeControls = selectedElement
    ? ["border-rect", "border-circle", "line", ...arrowTypes].includes(selectedElement.type)
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

  if (!loaded || !activeProject || !activeSlide) return <main className="loading-screen">Загрузка редактора...</main>;

  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Reveal Studio</p>
            <h1>Проекты</h1>
          </div>
          <button type="button" className="icon-button" title="Новый проект" onClick={addProject}>
            +
          </button>
        </div>

        <div className="project-list">
          {projects.map((project) => (
            <div
              className={`project-item ${project.id === activeProject.id ? "active" : ""}`}
              key={project.id}
            >
              <button
                type="button"
                className="project-select"
                onClick={() => {
                  setActiveProjectId(project.id);
                  showSlide(project.slides[0]?.id ?? "");
                }}
              >
                <span>{project.name}</span>
                <small>{project.slides.length} слайд.</small>
              </button>
              <button
                type="button"
                className="project-delete"
                title="Удалить проект"
                aria-label="Удалить проект"
                onClick={() => deleteProject(project.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <label className="field-label">
          Название проекта
          <input value={activeProject.name} onChange={(event) => commitProjects((project) => ({ ...project, name: event.target.value }))} />
        </label>

        <div className="panel-section element-palette-section">
          <h2>Элементы</h2>
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
          <div className="element-palette shape-palette">
            {toolItems.filter((item) => item.type !== "text").map((item) => (
              <button
                type="button"
                className="palette-button shape-button"
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

        <div className="slides-header">
          <h2>Слайды</h2>
          <button type="button" className="small-button" onClick={addSlide}>
            Добавить
          </button>
        </div>

        <div className="slide-list">
          {activeProject.slides.map((slide, index) => (
            <button
              type="button"
              key={slide.id}
              className={`slide-thumb ${slide.id === activeSlide.id ? "active" : ""}`}
              onClick={() => showSlide(slide.id)}
            >
              <span>{index + 1}</span>
              <strong>{slide.title}</strong>
              <small>{slide.elements.length} эл.</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <strong>{activeSlide.title}</strong>
          <div className="toolbar">
            <button type="button" className="primary-button" onClick={() => { setPresentReveal(1); setPresenting(true); }}>Preview</button>
          </div>
        </header>

        <div className="canvas-wrap">
          <div
            ref={stageRef}
            className={`stage ${marqueeSelection ? "is-marquee-selecting" : ""} ${pendingPlacement ? "is-placing-element" : ""}`}
            style={
              {
                backgroundColor: activeSlide.background,
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
                className="selection-box single-selection-box"
                onPointerDown={(event) => startMove(event, selectedElement)}
                onContextMenu={(event) => handleElementContextMenu(event, selectedElement)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (selectedElement.type === "text" || selectedElement.type === "code") startTextEditing(selectedElement);
                }}
                style={{
                  left: `${(selectedElement.x / canvasWidth) * 100}%`,
                  top: `${(selectedElement.y / canvasHeight) * 100}%`,
                  width: `${(selectedElement.width / canvasWidth) * 100}%`,
                  height: `${(selectedElement.height / canvasHeight) * 100}%`,
                  transform: `rotate(${selectedElement.rotation}deg)`,
                }}
              >
                <button className="rotate-handle" type="button" title="Повернуть" onPointerDown={(event) => startRotate(event, selectedElement)} />
                {resizeHandles.map((handle) => (
                  <button
                    className={`resize-handle resize-${handle}`}
                    key={handle}
                    type="button"
                    title="Изменить размер"
                    onPointerDown={(event) => startResize(event, selectedElement, handle)}
                  />
                ))}
              </div>
            )}
            {pendingPlacementPreview && (
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
                className="selection-box"
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
                {resizeHandles.map((handle) => (
                  <button
                    className={`resize-handle resize-${handle}`}
                    key={handle}
                    type="button"
                    title="Изменить размер группы"
                    onPointerDown={(event) => startGroupResize(event, handle)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="timeline">
          <span>Reveal:</span>
          {revealGroups.map(([step, count]) => (
            <button
              type="button"
              key={step}
              className={selectedElements.length > 0 && selectedElements.every((element) => element.reveal === step) ? "active" : ""}
              onClick={() => {
                if (selectedElements.length === 0) return;
                selectedElements.forEach((element) => commitElement(element.id, { reveal: step }));
              }}
            >
              {step}<small>{count}</small>
            </button>
          ))}
        </footer>
      </section>

      <aside className="inspector">
        <div className="panel-section">
          <h2>Элемент</h2>
          {selectedElement ? (
            <div className="inspector-grid">
              {selectedElement.type === "text" && (
                <>
                  <label className="field-label wide">Текст<textarea value={selectedElement.text} onChange={(event) => commitElement(selectedElement.id, { text: event.target.value, textHtml: textToHtml(event.target.value), ...estimateTextBounds(event.target.value, selectedElement.fontSize ?? 36, selectedElement.textAutoSize ? undefined : selectedElement.width, selectedElement.fontWeight ?? 800) })} /></label>
                  <div className="field-label wide">
                    <span>Фрагмент</span>
                    <div className="text-style-controls">
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichTextCommand("bold")}>B</button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyRichTextCommand("italic")}><i>I</i></button>
                      {editingTextId === selectedElement.id && (
                        <>
                          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySelectedTextFontDelta(-4)}>A-</button>
                          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySelectedTextFontDelta(4)}>A+</button>
                          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySelectedTextWeightDelta(-100)}>W-</button>
                          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySelectedTextWeightDelta(100)}>W+</button>
                        </>
                      )}
                    </div>
                  </div>
                  <label className="field-label"><span>Размер</span><NumberInput key={`${selectedElement.id}-font-size`} min={8} value={selectedElement.fontSize} onCommit={(value) => {
                    const fontSize = Math.max(8, value);
                    commitElement(selectedElement.id, { fontSize, ...estimateTextBounds(selectedElement.text ?? "", fontSize, selectedElement.textAutoSize ? undefined : selectedElement.width, selectedElement.fontWeight ?? 800) });
                  }} /></label>
                  <label className="field-label"><span>Жирность</span><NumberInput key={`${selectedElement.id}-font-weight`} min={100} max={900} step={50} value={selectedElement.fontWeight ?? 800} onCommit={(value) => {
                    const fontWeight = clamp(value, 100, 900);
                    commitElement(selectedElement.id, { fontWeight, ...estimateTextBounds(selectedElement.text ?? "", selectedElement.fontSize ?? 36, selectedElement.textAutoSize ? undefined : selectedElement.width, fontWeight) });
                  }} /></label>
                  <label className="field-label compact-field">Цвет<ColorInput label="Цвет текста" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <div className="field-label wide">
                    <span>Выравнивание</span>
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
                    Код
                    <textarea
                      className="code-textarea"
                      placeholder={isShellLanguage(selectedElement.language) ? "~/robot_ws$ colcon build\n~/robot_ws/src$ ros2 pkg create robot_description" : undefined}
                      spellCheck={false}
                      value={selectedElement.text ?? ""}
                      onChange={(event) => commitElement(selectedElement.id, { text: event.target.value })}
                      onKeyDown={handleIndentTextareaKeyDown}
                    />
                    {isShellLanguage(selectedElement.language) && <span className="field-hint">Для bash можно писать как в терминале: директория$ команда</span>}
                  </label>
                  <label className="field-label wide">
                    Язык
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
                    <span>Размер</span>
                    <NumberInput
                      key={`${selectedElement.id}-code-font-size`}
                      min={8}
                      max={48}
                      value={selectedElement.fontSize ?? 14}
                      onCommit={(fontSize) => commitElement(selectedElement.id, { fontSize })}
                    />
                  </label>
                  <label className="field-label compact-field">Фон<ColorInput label="Фон кода" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <label className="field-label compact-field">Рамка<ColorInput label="Цвет рамки кода" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label">
                    <span>Скругление</span>
                    <NumberInput key={`${selectedElement.id}-code-radius`} min={0} value={selectedElement.radius ?? 8} onCommit={(radius) => commitElement(selectedElement.id, { radius: Math.max(0, radius) })} />
                  </label>
                </>
              )}
              {selectedElement.type === "file-tree" && (
                <>
                  <label className="field-label wide">
                    Структура
                    <textarea
                      className="code-textarea"
                      spellCheck={false}
                      value={selectedElement.text ?? ""}
                      onChange={(event) => commitElement(selectedElement.id, { text: event.target.value })}
                      onKeyDown={handleIndentTextareaKeyDown}
                    />
                  </label>
                  <label className="field-label">
                    <span>Размер</span>
                    <NumberInput
                      key={`${selectedElement.id}-tree-font-size`}
                      min={8}
                      max={48}
                      value={selectedElement.fontSize ?? 18}
                      onCommit={(fontSize) => commitElement(selectedElement.id, { fontSize })}
                    />
                  </label>
                  <label className="field-label compact-field">Фон<ColorInput label="Фон структуры" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                  <label className="field-label compact-field">Текст<ColorInput label="Цвет структуры" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label">
                    <span>Скругление</span>
                    <NumberInput key={`${selectedElement.id}-tree-radius`} min={0} value={selectedElement.radius ?? 8} onCommit={(radius) => commitElement(selectedElement.id, { radius: Math.max(0, radius) })} />
                  </label>
                </>
              )}
              {!selectedHasStrokeControls && (
                selectedElement.type !== "text" && selectedElement.type !== "code" && selectedElement.type !== "file-tree" && (
                  <>
                    <label className="field-label compact-field">Заливка<ColorInput label="Цвет заливки" value={selectedElement.fill} onChange={(fill) => commitElement(selectedElement.id, { fill })} /></label>
                    {["rect", "diamond", "triangle", "circle"].includes(selectedElement.type) && (
                      <label className="field-label compact-field">Контур<ColorInput label="Цвет контура" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                    )}
                    {selectedElement.type === "rect" && (
                      <label className="field-label"><span>Скругление</span><NumberInput key={`${selectedElement.id}-radius`} min={0} value={selectedElement.radius ?? 0} onCommit={(value) => commitElement(selectedElement.id, { radius: Math.max(0, value) })} /></label>
                    )}
                  </>
                )
              )}
              {selectedHasStrokeControls && (
                <>
                  <label className="field-label compact-field">Цвет<ColorInput label="Цвет линии" value={selectedElement.stroke} onChange={(stroke) => commitElement(selectedElement.id, { stroke })} /></label>
                  <label className="field-label"><span>Толщина</span><NumberInput key={`${selectedElement.id}-stroke-width`} min={0} value={selectedElement.strokeWidth} onCommit={(value) => commitElement(selectedElement.id, { strokeWidth: Math.max(0, value) })} /></label>
                </>
              )}
              <label className="field-label wide">
                Анимация появления
                <select value={selectedElement.animation} onChange={(event) => commitElement(selectedElement.id, { animation: event.target.value as RevealAnimation })}>
                  <option value="none">Без анимации</option>
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
              <p className="empty-state wide">Выбрано элементов: {selectedElements.length}. Цвет и текст меняются после выбора одного элемента.</p>
            </div>
          ) : (
            <div className="inspector-grid">
              <label className="field-label wide">
                Название слайда
                <input value={activeSlide.title} onChange={(event) => commitSlide((slide) => ({ ...slide, title: event.target.value }))} />
              </label>
              <label className="field-label compact-field">
                Фон слайда
                <ColorInput label="Фон слайда" value={activeSlide.background} onChange={(background) => commitSlide((slide) => ({ ...slide, background }))} />
              </label>
              <label className="field-label wide">
                Анимация слайда
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

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => { deleteElement(); setContextMenu(null); setContextSubmenu(null); }}>Delete</button>
          {canGroupContextTargets && (
            <button type="button" onClick={groupContextElements}>Group elements</button>
          )}
          {canUngroupContextTargets && (
            <button type="button" onClick={ungroupContextElements}>Ungroup elements</button>
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
            className={`present-stage slide-${activeSlide.transition}`}
            style={
              {
                backgroundColor: activeSlide.background,
                "--grid-color": getGridColor(activeSlide.background),
              } as CSSProperties
            }
          >
            {sortByReveal(activeSlide.elements)
              .filter((element) => element.reveal <= presentReveal)
              .map((element) => renderElement(element, false, presentReveal))}
          </div>
          <div className="present-controls" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={presentPrev}>Назад</button>
            <span>{activeSlideIndex + 1}.{presentReveal} / {activeProject.slides.length}.{maxReveal}</span>
            <button type="button" onClick={() => setPresenting(false)}>Выйти</button>
          </div>
        </div>
      )}
    </main>
  );
}
