"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { classifyCadFileType } from "@/lib/cadRendering";
import { fitAndCenter } from "@/lib/three/fitAndCenter";

export type CadKind = "stl" | "obj" | "glb" | "step";
type CadKindOrUnknown = CadKind | "unknown";
export type ViewerStatus = "idle" | "loading" | "ready" | "error" | "unsupported";
export type ThreeCadViewerReport = {
  status: ViewerStatus;
  cadKind: CadKindOrUnknown;
  /**
   * Human-readable diagnostic reason (primarily for STEP failures).
   * Keep short; safe to show directly in the UI.
   */
  errorReason?: string;
};

const MAX_RENDER_BYTES = 20 * 1024 * 1024; // 20MB
const STEP_PREVIEW_TIMEOUT_MS = 120_000;
const DEFAULT_FETCH_TIMEOUT_MS = 45_000;

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasQueryParam(url: string, key: string): boolean {
  // Best-effort string check; avoids URL parsing for relative URLs.
  // Matches `?key=` or `&key=` occurrences.
  const needle = `${encodeURIComponent(key)}=`;
  return url.includes(`?${needle}`) || url.includes(`&${needle}`);
}

function appendQueryParam(url: string, key: string, value: string): string {
  if (!url) return url;
  if (hasQueryParam(url, key)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function ensureStepStlPreviewUrl(input: {
  url: string;
  cadKind: CadKind | null;
  filename: string | null;
}): string {
  const { url, cadKind, filename } = input;
  const isStep =
    cadKind === "step" ||
    (cadKind === null && typeof filename === "string" && /\.(step|stp)$/i.test(filename.trim()));
  if (!isStep) return url;
  if (!url.startsWith("/api/parts-file-preview")) return url;

  let next = url;
  if (filename && !hasQueryParam(next, "fileName")) {
    next = appendQueryParam(next, "fileName", filename);
  }
  if (!hasQueryParam(next, "previewAs")) {
    next = appendQueryParam(next, "previewAs", "stl_preview");
  }
  return next;
}

function parseFilenameFromContentDisposition(value: string | null): string | null {
  const header = safeTrim(value);
  if (!header) return null;

  // Best-effort: handle `filename="x.ext"` and `filename=x.ext`
  const match = header.match(/filename\*?=(?:UTF-8''|")?([^\";]+)"?/i);
  const raw = match?.[1] ? match[1].trim() : "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function hasWebGLSupport(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function initializeThree(container: HTMLDivElement) {
  const width = Math.max(1, Math.floor(container.clientWidth || 1));
  const height = Math.max(1, Math.floor(container.clientHeight || 1));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x05070d, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000);
  camera.position.set(0, 0, 3);

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 3, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25);
  rim.position.set(-3, -2, -4);
  scene.add(ambient, key, rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;

  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(renderer.domElement);

  return { renderer, scene, camera, controls };
}

function getContainerRenderSize(container: HTMLDivElement, renderer: THREE.WebGLRenderer) {
  const canvas = renderer.domElement;
  const width = Math.max(
    1,
    Math.floor(canvas?.clientWidth || container.clientWidth || 1),
  );
  const height = Math.max(
    1,
    Math.floor(canvas?.clientHeight || container.clientHeight || 1),
  );
  return { width, height };
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && (mesh.geometry as any).dispose) {
      (mesh.geometry as any).dispose();
    }
    const material = (mesh as any).material as THREE.Material | THREE.Material[] | undefined;
    const disposeMaterial = (m: THREE.Material | null | undefined) => {
      if (!m) return;
      // Dispose textures commonly attached to materials (GLTF, etc).
      const anyMat = m as any;
      const maybeTextureKeys = [
        "map",
        "alphaMap",
        "aoMap",
        "bumpMap",
        "displacementMap",
        "emissiveMap",
        "envMap",
        "lightMap",
        "metalnessMap",
        "normalMap",
        "roughnessMap",
        "specularMap",
        "clearcoatMap",
        "clearcoatNormalMap",
        "clearcoatRoughnessMap",
        "sheenColorMap",
        "sheenRoughnessMap",
        "transmissionMap",
        "thicknessMap",
      ] as const;
      for (const key of maybeTextureKeys) {
        const tex = anyMat?.[key] as THREE.Texture | null | undefined;
        tex?.dispose?.();
      }
      m.dispose?.();
    };
    if (Array.isArray(material)) {
      material.forEach((m) => disposeMaterial(m));
    } else {
      disposeMaterial(material);
    }
  });
}

function buildStlMeshFromArrayBuffer(buffer: ArrayBuffer): THREE.Mesh {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: "#7dd3fc",
    metalness: 0.1,
    roughness: 0.6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Match existing STL orientation convention.
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  return mesh;
}

export type ThreeCadViewerProps = {
  className?: string;
  /**
   * Preferred API (debug page): provide a filename + direct preview URL.
   */
  fileName?: string;
  url?: string;
  /**
   * Legacy API (existing call sites): provide a quote_upload_files.id.
   */
  fileId?: string;
  /**
   * Intake API: Storage object identity + short-lived preview token.
   * When provided, the viewer will fetch via `/api/cad-preview`.
   */
  storageSource?: {
    bucket: string;
    path: string;
    token?: string | null;
  };
  /**
   * Optional override for a better UX; viewer will also try to infer from response headers.
   */
  filenameHint?: string | null;
  /**
   * Optional explicit CAD kind (preferred over filename inference).
   * Useful when the caller already classified the file.
   */
  cadKind?: CadKind | null;
  /**
   * Optional callback for higher-level UX (e.g. STEP-specific fallback copy).
   */
  onStatusChange?: (report: ThreeCadViewerReport) => void;
};

export type Props = {
  fileName: string;
  url: string;
  cadKind?: CadKind | null;
  onStatusChange?: (report: ThreeCadViewerReport) => void;
};

type LegacyProps = {
  fileId: string;
  className?: string;
  filenameHint?: string | null;
  /**
   * Optional override for where to fetch the preview from.
   * Useful when the caller needs to force STEP -> server-side STL conversion.
   */
  url?: string;
  cadKind?: CadKind | null;
  onStatusChange?: (report: ThreeCadViewerReport) => void;
};

type StorageSourceProps = {
  storageSource: {
    bucket: string;
    path: string;
    token?: string | null;
  };
  className?: string;
  filenameHint?: string | null;
  cadKind?: CadKind | null;
  onStatusChange?: (report: ThreeCadViewerReport) => void;
};

export function ThreeCadViewer(props: Props & { className?: string }): ReactElement;
export function ThreeCadViewer(props: LegacyProps): ReactElement;
export function ThreeCadViewer(props: StorageSourceProps): ReactElement;
export function ThreeCadViewer({
  fileId,
  className,
  filenameHint,
  cadKind,
  onStatusChange,
  fileName,
  url,
  storageSource,
}: ThreeCadViewerProps) {
  const didMountLogRef = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [resolvedFilename, setResolvedFilename] = useState<string | null>(null);
  const [resolvedCadKind, setResolvedCadKind] = useState<CadKindOrUnknown>("unknown");

  // Avoid re-running viewer lifecycle effects due to changing callback identity.
  const onStatusChangeRef = useRef<ThreeCadViewerProps["onStatusChange"]>(null);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange ?? null;
  }, [onStatusChange]);

  const runtimeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    container: HTMLDivElement;
    resizeObserver: ResizeObserver | null;
    animationId: number | null;
  } | null>(null);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const fetchAbortRef = useRef<AbortController | null>(null);

  const safeFileId = safeTrim(fileId);
  const safeUrl = safeTrim(url);
  const safeFileName = safeTrim(fileName);
  const safeBucket = safeTrim(storageSource?.bucket);
  const safePath = safeTrim(storageSource?.path);
  const safeToken = safeTrim(storageSource?.token ?? "");

  const kindForIntakeUrl = useMemo(() => {
    if (cadKind) return cadKind;
    const candidate =
      safeTrim(filenameHint) ||
      safeFileName ||
      (safePath ? safePath.split("/").pop() ?? "" : "");
    const info = classifyCadFileType({ filename: candidate, extension: null });
    return info.ok ? info.type : null;
  }, [cadKind, filenameHint, safeFileName, safePath]);

  const intakeInlineUrl = useMemo(() => {
    // Intake preview is token-only: /api/cad-preview?token=<token>&kind=<cadKind>
    if (safeToken) {
      const kind = kindForIntakeUrl;
      const qs = new URLSearchParams();
      qs.set("token", safeToken);
      if (kind) qs.set("kind", kind);
      qs.set("disposition", "inline");
      return `/api/cad-preview?${qs.toString()}`;
    }
    // Back-compat/admin debug mode.
    if (!safeBucket || !safePath) return null;
    return `/api/cad-preview?bucket=${encodeURIComponent(safeBucket)}&path=${encodeURIComponent(safePath)}&disposition=inline`;
  }, [safeBucket, safePath, safeToken, kindForIntakeUrl]);

  const intakeDownloadUrl = useMemo(() => {
    if (safeToken) {
      const kind = kindForIntakeUrl;
      const qs = new URLSearchParams();
      qs.set("token", safeToken);
      if (kind) qs.set("kind", kind);
      qs.set("disposition", "attachment");
      return `/api/cad-preview?${qs.toString()}`;
    }
    if (!safeBucket || !safePath) return null;
    return `/api/cad-preview?bucket=${encodeURIComponent(safeBucket)}&path=${encodeURIComponent(safePath)}&disposition=attachment`;
  }, [safeBucket, safePath, safeToken, kindForIntakeUrl]);

  const inlineUrl = useMemo(() => {
    if (!safeFileId) return null;
    const base = `/api/parts-file-preview?fileId=${encodeURIComponent(safeFileId)}&disposition=inline`;
    const filenameForStep = safeTrim(filenameHint) || safeFileName || null;
    return ensureStepStlPreviewUrl({ url: base, cadKind: cadKind ?? null, filename: filenameForStep });
  }, [safeFileId, cadKind, filenameHint, safeFileName]);

  const downloadUrl = useMemo(() => {
    if (intakeDownloadUrl) return intakeDownloadUrl;
    if (!safeFileId) return null;
    return `/api/parts-file-preview?fileId=${encodeURIComponent(safeFileId)}&disposition=attachment`;
  }, [safeFileId, intakeDownloadUrl]);

  const effectiveUrl = useMemo(() => {
    const baseUrl = safeUrl || intakeInlineUrl || inlineUrl;
    if (!baseUrl) return null;
    const filenameForStep = safeTrim(filenameHint) || safeFileName || null;
    return ensureStepStlPreviewUrl({
      url: baseUrl,
      cadKind: cadKind ?? null,
      filename: filenameForStep,
    });
  }, [safeUrl, intakeInlineUrl, inlineUrl, cadKind, filenameHint, safeFileName]);
  // Do not use server-inferred filenames for inference; they would retrigger reload loops.
  const effectiveFileName = safeFileName || filenameHint || "";

  if (!didMountLogRef.current) {
    didMountLogRef.current = true;
    console.log("[three-cad-viewer] mount", {
      fileName: effectiveFileName || null,
      url: effectiveUrl || null,
      cadKindProp: cadKind ?? null,
    });
  }

  const classification = useMemo(() => {
    return classifyCadFileType({ filename: effectiveFileName, extension: null });
  }, [effectiveFileName]);

  const detectedCadKindForUi = useMemo(() => {
    if (cadKind) {
      return cadKind;
    }
    if (resolvedCadKind && resolvedCadKind !== "unknown") {
      return resolvedCadKind;
    }
    return classification.ok ? classification.type : null;
  }, [cadKind, resolvedCadKind, classification]);

  const setViewerState = (next: {
    status: ViewerStatus;
    cadKind?: CadKindOrUnknown;
    message?: string | null;
    errorReason?: string | null;
  }) => {
    const nextCadKind = typeof next.cadKind === "undefined" ? "unknown" : next.cadKind;
    const nextMessage = typeof next.message === "undefined" ? null : next.message;
    const nextReason = typeof next.errorReason === "undefined" ? null : next.errorReason;

    setStatus(next.status);
    setResolvedCadKind(nextCadKind);
    setErrorMessage(nextMessage);
    setErrorReason(nextReason);
    onStatusChangeRef.current?.({
      status: next.status,
      cadKind: nextCadKind,
      errorReason: nextReason ?? undefined,
    });
  };

  const disposeCurrentModel = () => {
    const rt = runtimeRef.current;
    const model = modelRootRef.current;
    if (!rt || !model) return;
    rt.scene.remove(model);
    disposeObject3D(model);
    modelRootRef.current = null;
  };

  const tryFit = (padding = 1.35) => {
    const rt = runtimeRef.current;
    const model = modelRootRef.current;
    if (!rt || !model) return;
    const { width, height } = containerSizeRef.current;
    if (!width || !height) return;
    fitAndCenter(model, rt.camera, rt.controls, { width, height, padding });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (runtimeRef.current) return;

    if (!hasWebGLSupport()) {
      setViewerState({
        status: "error",
        cadKind: "unknown",
        message: "WebGL is not available in this browser. You can still download the file.",
        errorReason: null,
      });
      return;
    }

    const { renderer, scene, camera, controls } = initializeThree(container);

    const updateSize = (w: number, h: number) => {
      const width = Math.max(0, Math.floor(w));
      const height = Math.max(0, Math.floor(h));
      containerSizeRef.current = { width, height };
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      tryFit();
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            updateSize(entry.contentRect.width, entry.contentRect.height);
          })
        : null;
    resizeObserver?.observe(container);

    // Seed an initial size value in case ResizeObserver fires late.
    updateSize(container.clientWidth || 0, container.clientHeight || 0);

    runtimeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      container,
      resizeObserver,
      animationId: null,
    };

    const renderLoop = () => {
      const rt = runtimeRef.current;
      if (!rt) return;
      rt.controls.update();
      rt.renderer.render(rt.scene, rt.camera);
      rt.animationId = window.requestAnimationFrame(renderLoop);
    };
    runtimeRef.current.animationId = window.requestAnimationFrame(renderLoop);

    return () => {
      // Root cause of the Chrome warning “Too many active WebGL contexts” was repeated
      // renderer creation (effect re-runs) without reliably releasing the old context.
      // We now create exactly one renderer per mounted viewer and fully dispose on unmount.
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;

      const rt = runtimeRef.current;
      if (!rt) return;

      if (rt.animationId !== null) cancelAnimationFrame(rt.animationId);
      rt.resizeObserver?.disconnect();
      rt.controls.dispose();

      disposeCurrentModel();

      try {
        (rt.renderer as any).renderLists?.dispose?.();
      } catch {
        // ignore
      }
      try {
        rt.renderer.dispose();
      } catch {
        // ignore
      }
      try {
        (rt.renderer as any).forceContextLoss?.();
      } catch {
        // ignore
      }
      try {
        const canvas = rt.renderer.domElement;
        canvas?.parentElement?.removeChild(canvas);
      } catch {
        // ignore
      }
      while (container.firstChild) container.removeChild(container.firstChild);
      runtimeRef.current = null;
    };
    // Mount-only: keep WebGL objects stable across rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const rt = runtimeRef.current;
    if (!rt) return;

    // Abort any in-flight request when the URL changes.
    fetchAbortRef.current?.abort();
    const abort = new AbortController();
    fetchAbortRef.current = abort;

    disposeCurrentModel();
    setResolvedFilename(null);

    const cadKindHint: CadKind | null = cadKind ?? (classification.ok ? classification.type : null);
    const isStep = cadKindHint === "step";
    const timeoutMs = isStep ? STEP_PREVIEW_TIMEOUT_MS : DEFAULT_FETCH_TIMEOUT_MS;

    if (!effectiveUrl) {
      setViewerState({ status: "idle", cadKind: "unknown", message: null, errorReason: null });
      return;
    }

    setViewerState({ status: "loading", cadKind: cadKindHint ?? "unknown", message: null, errorReason: null });

    const timeoutId = window.setTimeout(() => {
      abort.abort();
    }, timeoutMs);

    const load = async () => {
      let detectedCadKind: CadKindOrUnknown = cadKindHint ?? "unknown";
      let fileNameForLogs: string = effectiveFileName || "unknown";
      try {
        const res = await fetch(effectiveUrl, {
          method: "GET",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          signal: abort.signal,
        });

        if (!res.ok) {
          const contentType = safeTrim(res.headers.get("content-type"));
          const isJson = contentType.toLowerCase().includes("application/json");
          const bodyText = isJson ? "" : await res.text().catch(() => "");
          const bodyJson = isJson ? await res.json().catch(() => null) : null;

          const userMessage =
            bodyJson && typeof bodyJson === "object" && typeof (bodyJson as any)?.userMessage === "string"
              ? String((bodyJson as any).userMessage).trim()
              : "";
          const requestId =
            bodyJson && typeof bodyJson === "object" && typeof (bodyJson as any)?.requestId === "string"
              ? String((bodyJson as any).requestId).trim()
              : "";
          const apiError =
            bodyJson && typeof bodyJson === "object"
              ? (bodyJson as any).error ?? (bodyJson as any).reason ?? null
              : null;
          const apiErrorString = typeof apiError === "string" ? apiError : "";
          const fallbackText = safeTrim(bodyText) || (isJson ? JSON.stringify(bodyJson) : "");

          const combined =
            userMessage ||
            (apiErrorString
              ? `HTTP ${res.status}: ${apiErrorString}`
              : fallbackText
                ? `HTTP ${res.status}: ${fallbackText}`
                : `HTTP ${res.status}`);

          setViewerState({
            status: "error",
            cadKind: cadKindHint ?? detectedCadKind,
            message:
              requestId && !combined.includes(requestId) ? `${combined} (RequestId: ${requestId})` : combined,
            errorReason: cadKindHint === "step" ? combined : null,
          });
          return;
        }

        const inferred = parseFilenameFromContentDisposition(res.headers.get("content-disposition"));
        setResolvedFilename(inferred ?? null);
        fileNameForLogs = effectiveFileName || inferred || "unknown";

        const blob = await res.blob();
        if (blob.size > MAX_RENDER_BYTES) {
          setViewerState({
            status: "error",
            cadKind: cadKindHint ?? detectedCadKind,
            message:
              "This CAD file is too large to safely render in-browser (over 20 MB). You can still download it.",
            errorReason: null,
          });
          return;
        }

        const fileNameForType = effectiveFileName || inferred || null;
        const resolvedCadKindValue: CadKind | null =
          cadKind ??
          (() => {
            const typeInfo = classifyCadFileType({ filename: fileNameForType, extension: null });
            return typeInfo.ok ? typeInfo.type : null;
          })();

        console.log("[three-cad-viewer] resolvedCadKind", {
          fileName: fileNameForLogs,
          cadKind: resolvedCadKindValue,
        });

        if (!resolvedCadKindValue) {
          setViewerState({
            status: "error",
            cadKind: "unknown",
            message: "Unable to render this CAD file. You can still download it.",
            errorReason: null,
          });
          return;
        }

        detectedCadKind = resolvedCadKindValue;
        setViewerState({ status: "loading", cadKind: detectedCadKind, message: null, errorReason: null });

        const resContentType = safeTrim(res.headers.get("content-type")).toLowerCase();
        if (resolvedCadKindValue === "step" && resContentType.includes("application/step")) {
          setViewerState({
            status: "error",
            cadKind: "step",
            message:
              "This link points to the original STEP file, but the viewer needs a server-generated STL preview. Please retry Preview 3D.",
            errorReason: "step_source_not_preview",
          });
          return;
        }

        const buffer = await blob.arrayBuffer();

        let objectRoot: THREE.Object3D | null = null;
        if (resolvedCadKindValue === "stl") {
          objectRoot = buildStlMeshFromArrayBuffer(buffer);
        } else if (resolvedCadKindValue === "obj") {
          const text = new TextDecoder().decode(new Uint8Array(buffer));
          const loader = new OBJLoader();
          const obj = loader.parse(text);
          obj.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if ((mesh as any).isMesh) {
              (mesh as any).material =
                (mesh as any).material ??
                new THREE.MeshStandardMaterial({
                  color: "#7dd3fc",
                  metalness: 0.1,
                  roughness: 0.65,
                });
            }
          });
          objectRoot = obj;
        } else if (resolvedCadKindValue === "glb") {
          const loader = new GLTFLoader();
          const gltf = await loader.parseAsync(buffer, "");
          objectRoot = gltf.scene ?? new THREE.Group();
        } else if (resolvedCadKindValue === "step") {
          // STEP is rendered via a server-generated STL preview artifact.
          objectRoot = buildStlMeshFromArrayBuffer(buffer);
        }

        if (!objectRoot) {
          throw new Error("cad_parse_failed");
        }

        const centeredRoot = new THREE.Group();
        centeredRoot.add(objectRoot);
        modelRootRef.current = centeredRoot;
        rt.scene.add(centeredRoot);

        // Fit only once we have a real size. ResizeObserver will also re-fit on changes.
        const { width, height } = containerSizeRef.current;
        if (width > 0 && height > 0) {
          tryFit(1.35);
        } else {
          const rect = rt.container.getBoundingClientRect();
          const measured = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
          containerSizeRef.current = measured;
          if (measured.width > 0 && measured.height > 0) {
            tryFit(1.35);
          }
        }

        setViewerState({ status: "ready", cadKind: detectedCadKind, message: null, errorReason: null });
      } catch (e) {
        const isAbort =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (isAbort) {
          setViewerState({
            status: "error",
            cadKind: cadKindHint ?? "unknown",
            message: `Preview request timed out after ${Math.round(timeoutMs / 1000)}s. Please retry.`,
            errorReason: cadKindHint === "step" ? "timeout" : null,
          });
          return;
        }

        const isStepForLogs = detectedCadKind === "step" || cadKindHint === "step";
        if (isStepForLogs) {
          console.error("[three-step-preview] step STL preview error", {
            fileName: fileNameForLogs,
            url: effectiveUrl,
            err: e,
          });
        }

        const errMessage = e instanceof Error ? e.message : String(e);
        setViewerState({
          status: "error",
          cadKind: detectedCadKind,
          message: errMessage || "Unable to render this CAD file. You can still download it.",
          errorReason: isStepForLogs ? "failed_to_load_step_stl_preview" : null,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    void load();

    return () => {
      window.clearTimeout(timeoutId);
      abort.abort();
    };
  }, [effectiveUrl, cadKind, classification.ok, classification.type, effectiveFileName]);

  return (
    <div className={clsx("w-full", className)}>
      <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-black">
        <div ref={containerRef} className="h-[70vh] min-h-[380px] w-full" />

        {status !== "ready" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 px-6 text-center">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-100">
                {status === "loading"
                  ? "Loading 3D preview…"
                  : status === "unsupported"
                    ? "3D preview not supported"
                    : "3D preview"}
              </p>
              <p className="max-w-lg text-sm text-slate-300">
                {status === "loading"
                  ? detectedCadKindForUi === "step"
                    ? "Generating a server-generated STL preview (STL is preview-only; the original STEP remains downloadable)."
                    : "Parsing CAD in your browser. This can take a moment."
                  : errorMessage ?? "Unable to render this CAD file. You can still download it."}
              </p>
              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
                >
                  Download
                </a>
              ) : null}
              {detectedCadKindForUi ? (
                <p className="text-[11px] text-slate-500">
                  Detected: {detectedCadKindForUi.toUpperCase()}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

