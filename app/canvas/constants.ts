import type { ElementType, ResizeHandle, TextPreset } from "./types";

export const canvasWidth = 1280;
export const canvasHeight = 720;
export const storageKey = "reveals-studio-projects-v1";
export const namespaceStorageKey = "reveals-studio-namespaces-v1";
export const defaultNamespaceId = "default";
export const defaultNamespaceName = "Default";
export const projectDbName = "reveals-studio-db";
export const projectDbStoreName = "kv";
export const preferencesKey = "reveals-studio-element-preferences-v1";
export const userSettingsKey = "reveals-studio-user-settings-v1";
export const internalClipboardType = "application/x-reveals-elements";
export const internalSlideClipboardType = "application/x-reveals-slide";
export const gridSize = 16;
export const snapThreshold = 6;
export const revealColors = ["#2f6fed", "#f97316", "#14b8a6", "#f43f5e", "#8b5cf6", "#0f766e", "#111827"];
export const resizeHandles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const arrowTypes: ElementType[] = ["arrow", "dashed-arrow", "double-arrow", "curved-arrow", "bend-arrow"];
export const codeLanguages = ["javascript", "typescript", "tsx", "css", "html", "json", "python", "bash", "cpp", "plaintext"];
export const threeShapeTypes: ElementType[] = ["cube", "sphere", "cylinder"];
export const isThreeShapeType = (type: ElementType) => threeShapeTypes.includes(type);
export const defaultThreeAngles = { pitch: 18, yaw: 28, roll: 0 };
export const textPresets: Record<TextPreset, { label: string; text: string; fontSize: number; fontWeight: number }> = {
  title: { label: "Title", text: "Title", fontSize: 48, fontWeight: 900 },
  subtitle: { label: "Subtitle", text: "Subtitle", fontSize: 42, fontWeight: 750 },
  body: { label: "Text", text: "Text", fontSize: 24, fontWeight: 450 },
};
export const textFontSizeOptions = Array.from({ length: (160 - 8) / 2 + 1 }, (_, index) => 8 + index * 2);
export const textFontWeightOptions = [
  { value: 100, label: "Thin" },
  { value: 200, label: "Extra light" },
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra bold" },
  { value: 900, label: "Black" },
];
export const toolItems: Array<{ type: ElementType; label: string; icon: string; textPreset?: TextPreset }> = [
  { type: "text", label: "Title", icon: "text-title", textPreset: "title" },
  { type: "text", label: "Subtitle", icon: "text-subtitle", textPreset: "subtitle" },
  { type: "text", label: "Text", icon: "text-body", textPreset: "body" },
  { type: "code", label: "Code", icon: "code" },
  { type: "file-tree", label: "Files", icon: "file-tree" },
  { type: "table", label: "Table", icon: "table" },
  { type: "rect", label: "Rectangle", icon: "rect" },
  { type: "border-rect", label: "Frame", icon: "border-rect" },
  { type: "circle", label: "Circle", icon: "circle" },
  { type: "border-circle", label: "Ring", icon: "border-circle" },
  { type: "diamond", label: "Diamond", icon: "diamond" },
  { type: "triangle", label: "Triangle", icon: "triangle" },
  { type: "cube", label: "Cube", icon: "cube" },
  { type: "sphere", label: "Sphere", icon: "sphere" },
  { type: "cylinder", label: "Cylinder", icon: "cylinder" },
  { type: "line", label: "Line", icon: "line" },
  { type: "dashed-line", label: "Dashed line", icon: "dashed-line" },
  { type: "arrow", label: "Arrow", icon: "arrow" },
  { type: "dashed-arrow", label: "Dashed arrow", icon: "dashed-arrow" },
  { type: "double-arrow", label: "Double arrow", icon: "double-arrow" },
  { type: "curved-arrow", label: "Curved arrow", icon: "curved-arrow" },
  { type: "bend-arrow", label: "Bend arrow", icon: "bend-arrow" },
];
export const textPaddingX = 8;
export const textPaddingY = 6;
export const textLineHeight = 1.18;
export const minTextWidth = 32;
export const minTextFontSize = 8;
export const maxTextFontSize = 160;
export const colorPickerWidth = 246;
export const colorPickerHeight = 248;
export const minCanvasZoom = 0.35;
export const maxCanvasZoom = 3;
export const rotationSnapStep = 45;
export const rotationSnapThreshold = 5;
