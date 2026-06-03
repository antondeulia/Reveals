export type ElementType =
  | "text"
  | "rect"
  | "border-rect"
  | "circle"
  | "border-circle"
  | "diamond"
  | "triangle"
  | "cube"
  | "sphere"
  | "cylinder"
  | "line"
  | "dashed-line"
  | "arrow"
  | "dashed-arrow"
  | "double-arrow"
  | "curved-arrow"
  | "bend-arrow"
  | "image"
  | "code"
  | "file-tree"
  | "table";

export type RevealAnimation = "none" | "fade" | "fade-out" | "fade-up" | "zoom" | "slide-left";
export type SlideTransition = "none" | "fade" | "slide" | "zoom";
export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type TextEditFocusMode = "end" | "select-all" | "pointer";
export type TextPreset = "title" | "subtitle" | "body";

export type SlideElement = {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  pitch?: number;
  yaw?: number;
  roll?: number;
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
  curveStart?: { x: number; y: number };
  curveEnd?: { x: number; y: number };
  curveControl?: { x: number; y: number };
};

export type ElementTransformSnapshot = Pick<
  SlideElement,
  "id" | "type" | "x" | "y" | "width" | "height" | "rotation" | "fontSize" | "fontWeight" | "text" | "textHtml" | "textAutoSize" | "curveStart" | "curveEnd" | "curveControl"
>;
export type SingleElementTransformSnapshot = Omit<ElementTransformSnapshot, "id">;

export type Slide = {
  id: string;
  title: string;
  background: string;
  transition: SlideTransition;
  elements: SlideElement[];
};

export type Project = {
  id: string;
  name: string;
  updatedAt: number;
  slides: Slide[];
};

export type WorkspaceNamespace = {
  id: string;
  name: string;
  updatedAt: number;
  projects: Project[];
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DragState =
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
      startAngle: number;
      startRotation: number;
    }
  | {
      mode: "group-rotate";
      elementIds: string[];
      pointerId: number;
      startAngle: number;
      startBounds: Bounds;
      startElements: ElementTransformSnapshot[];
    }
  | {
      mode: "curve-control";
      elementId: string;
      pointerId: number;
    };

export type AlignmentGuide = {
  orientation: "vertical" | "horizontal";
  position: number;
};

export type MarqueeSelectionState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  baseSelectedIds: string[];
  additive: boolean;
  clickToggleIds?: string[];
  excludedIds?: string[];
};

export type PendingPlacement = {
  type: ElementType;
  textPreset?: TextPreset;
  point: { x: number; y: number } | null;
  startPoint?: { x: number; y: number };
};

export type ContextMenuState = {
  x: number;
  y: number;
  elementId: string;
} | null;

export type SlideContextMenuState = {
  x: number;
  y: number;
  slideId: string;
} | null;

export type NamespaceContextMenuState = {
  x: number;
  y: number;
  namespaceId: string;
} | null;

export type ContextSubmenu = "z-index" | "reveal" | "animation" | null;

export type SlideDropIndicator = {
  slideId: string;
  placement: "before" | "after";
} | null;

export type CanvasPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
};

export type StoredProject = Omit<Project, "slides"> & {
  slides: Array<
    Omit<Partial<Slide>, "elements"> &
      Pick<Slide, "id" | "title" | "background"> & {
        elements: Array<Partial<SlideElement> & Pick<SlideElement, "id" | "type" | "x" | "y" | "width" | "height">>;
      }
  >;
};

export type StoredNamespace = Partial<Omit<WorkspaceNamespace, "projects">> & {
  projects?: StoredProject[];
};

export type StoredWorkspace = {
  namespaces?: StoredNamespace[];
  activeNamespaceId?: string;
};

export type RemoteProjectsResponse = {
  configured: boolean;
  projects: StoredProject[] | null;
  workspace?: StoredWorkspace | null;
  updatedAt: number;
};

export type UserSettings = {
  showRevealNumbers: boolean;
  showEditGrid: boolean;
  showPreviewGrid: boolean;
};

export type ElementStylePreferences = Record<
  ElementType,
  Partial<Pick<SlideElement, "fill" | "stroke">>
>;

export type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

export type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};
