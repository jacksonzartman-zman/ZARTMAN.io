"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { classifyCadFileType } from "@/lib/cadRendering";

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

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(1, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(1, Math.floor(entry.contentRect.height));
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);
  }

  return { renderer, scene, camera, controls, resizeObserver };
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    return;
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const safeMaxDim = Math.max(maxDim, 0.0001);

  const fov = (camera.fov * Math.PI) / 180;
  const distance = safeMaxDim / (2 * Math.tan(fov / 2));
  const offset = distance * 1.25;

  camera.position.set(center.x, center.y, center.z + offset);
  camera.near = safeMaxDim / 100;
  camera.far = safeMaxDim * 200;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && (mesh.geometry as any).dispose) {
      (mesh.geometry as any).dispose();
    }
    const material = (mesh as any).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((m) => m?.dispose?.());
    } else {
      material?.dispose?.();
    }
  });
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

export function ThreeCadViewer({
  fileId,
  className,
  filenameHint,
  cadKind,
  onStatusChange,
  fileName,
  url,
}: ThreeCadViewerProps) {
  const didMountLogRef = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [resolvedFilename, setResolvedFilename] = useState<string | null>(null);
  const [resolvedCadKind, setResolvedCadKind] = useState<CadKindOrUnknown>("unknown");

  const safeFileId = safeTrim(fileId);
  const safeUrl = safeTrim(url);
  const safeFileName = safeTrim(fileName);
  const safeFilenameHint = safeTrim(filenameHint);

  const augmentPartsFilePreviewUrl = useMemo(() => {
    return (baseUrl: string, kind: CadKind | null, fileNameForQuery: string | null) => {
      let next = baseUrl;
      if (fileNameForQuery && next.startsWith("/api/parts-file-preview")) {
        if (/[?&]fileName=/.test(next)) {
          // noop
        } else {
        const hasQuery = next.includes("?");
        const sep = hasQuery ? "&" : "?";
        next = `${next}${sep}fileName=${encodeURIComponent(fileNameForQuery)}`;
        }
      }

      if (kind === "step" && next.startsWith("/api/parts-file-preview")) {
        if (/[?&]previewAs=/.test(next)) {
          return next;
        }
        const hasQuery = next.includes("?");
        const sep = hasQuery ? "&" : "?";
        next = `${next}${sep}previewAs=stl_preview`;
      }

      return next;
    };
  }, []);

  const inlineUrl = useMemo(() => {
    if (!safeFileId) return null;
    const baseUrl = `/api/parts-file-preview?fileId=${encodeURIComponent(safeFileId)}&disposition=inline`;
    const nameForQuery = safeFileName || safeFilenameHint || null;
    return augmentPartsFilePreviewUrl(baseUrl, cadKind ?? null, nameForQuery);
  }, [safeFileId, augmentPartsFilePreviewUrl, cadKind, safeFileName, safeFilenameHint]);

  const downloadUrl = useMemo(() => {
    if (!safeFileId) return null;
    const baseUrl = `/api/parts-file-preview?fileId=${encodeURIComponent(safeFileId)}&disposition=attachment`;
    const nameForQuery = safeFileName || safeFilenameHint || null;
    return augmentPartsFilePreviewUrl(baseUrl, null, nameForQuery);
  }, [safeFileId, augmentPartsFilePreviewUrl, safeFileName, safeFilenameHint]);

  const effectiveUrl = safeUrl || inlineUrl;
  const effectiveFileName = safeFileName || filenameHint || resolvedFilename || "";

  if (!didMountLogRef.current) {
    didMountLogRef.current = true;
    console.log("[three-step-debug] mount", {
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let animationId: number | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let objectRoot: THREE.Object3D | null = null;

    const resetContainer = () => {
      while (container.firstChild) container.removeChild(container.firstChild);
    };

    const cleanup = () => {
      if (animationId !== null) cancelAnimationFrame(animationId);
      resizeObserver?.disconnect();
      controls?.dispose();
      if (scene && objectRoot) {
        scene.remove(objectRoot);
        disposeObject3D(objectRoot);
      }
      renderer?.dispose();
      objectRoot = null;
      resetContainer();
    };

    const renderLoop = () => {
      if (cancelled || !renderer || !scene || !camera) return;
      controls?.update();
      renderer.render(scene, camera);
      animationId = window.requestAnimationFrame(renderLoop);
    };

    const start = async () => {
      let detectedCadKind: CadKindOrUnknown = "unknown";
      let fileNameForLogs: string = effectiveFileName || "unknown";

      const setViewerState = (next: {
        status: ViewerStatus;
        cadKind?: CadKindOrUnknown;
        message?: string | null;
        errorReason?: string | null;
      }) => {
        if (cancelled) return;
        const nextCadKind = typeof next.cadKind === "undefined" ? "unknown" : next.cadKind;
        const nextMessage = typeof next.message === "undefined" ? null : next.message;
        const nextReason = typeof next.errorReason === "undefined" ? null : next.errorReason;

        setStatus(next.status);
        setResolvedCadKind(nextCadKind);
        setErrorMessage(nextMessage);
        setErrorReason(nextReason);
        onStatusChange?.({
          status: next.status,
          cadKind: nextCadKind,
          errorReason: nextReason ?? undefined,
        });
      };

      if (!effectiveUrl) {
        setViewerState({ status: "idle", cadKind: "unknown", message: null, errorReason: null });
        cleanup();
        return;
      }

      if (!hasWebGLSupport()) {
        setViewerState({
          status: "error",
          cadKind: "unknown",
          message: "WebGL is not available in this browser. You can still download the file.",
          errorReason: null,
        });
        cleanup();
        return;
      }

      setViewerState({ status: "loading", message: null, errorReason: null });

      try {
        const res = await fetch(effectiveUrl, { method: "GET" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `preview_failed_${res.status}`);
        }

        const inferred = parseFilenameFromContentDisposition(res.headers.get("content-disposition"));
        if (!cancelled) setResolvedFilename(inferred ?? null);
        fileNameForLogs = effectiveFileName || inferred || "unknown";

        const blob = await res.blob();
        if (cancelled) return;

        if (blob.size > MAX_RENDER_BYTES) {
          setViewerState({
            status: "error",
            message:
              "This CAD file is too large to safely render in-browser (over 20 MB). You can still download it.",
            errorReason: null,
          });
          cleanup();
          return;
        }

        const fileNameForType = effectiveFileName || inferred || null;
        const resolvedCadKind: CadKind | null =
          cadKind ??
          (() => {
            const typeInfo = classifyCadFileType({ filename: fileNameForType, extension: null });
            return typeInfo.ok ? typeInfo.type : null;
          })();

        console.log("[three-step-debug] resolvedCadKind", {
          fileName: fileNameForLogs,
          cadKind: resolvedCadKind,
        });

        if (!resolvedCadKind) {
          setViewerState({
            status: "error",
            cadKind: "unknown",
            message: "Unable to render this CAD file. You can still download it.",
            errorReason: null,
          });
          cleanup();
          return;
        }

        detectedCadKind = resolvedCadKind;
        setViewerState({
          status: "loading",
          cadKind: detectedCadKind,
          message: null,
          errorReason: null,
        });

        if (resolvedCadKind !== "step") {
          console.log("[three-step-debug] non-step-load", {
            cadKind: resolvedCadKind,
            fileName: fileNameForLogs,
          });
        }

        ({ renderer, scene, camera, controls, resizeObserver } = initializeThree(container));

        const buffer = await blob.arrayBuffer();
        if (cancelled) return;

        const loadStlObjectFromBuffer = (buf: ArrayBuffer) => {
          const loader = new STLLoader();
          const geometry = loader.parse(buf);
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: "#7dd3fc",
            metalness: 0.1,
            roughness: 0.6,
          });
          const mesh = new THREE.Mesh(geometry, material);
          // Match existing STL orientation convention.
          mesh.rotation.set(-Math.PI / 2, 0, 0);
          return mesh as THREE.Object3D;
        };

        if (resolvedCadKind === "stl") {
          objectRoot = loadStlObjectFromBuffer(buffer);
        } else if (resolvedCadKind === "obj") {
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
        } else if (resolvedCadKind === "glb") {
          const loader = new GLTFLoader();
          const gltf = await loader.parseAsync(buffer, "");
          objectRoot = gltf.scene ?? new THREE.Group();
        } else if (resolvedCadKind === "step") {
          try {
            console.log("[three-step-preview] loading STL preview for STEP", {
              fileName: fileNameForLogs,
              url: effectiveUrl,
            });
            objectRoot = loadStlObjectFromBuffer(buffer);
          } catch (err) {
            console.error("[three-step-preview] step STL preview error", {
              fileName: fileNameForLogs,
              url: effectiveUrl,
              err,
            });
            setViewerState({
              status: "error",
              cadKind: "step",
              message: "STEP preview is not available for this file yet. You can still download it.",
              errorReason: "failed_to_load_step_stl_preview",
            });
            cleanup();
            return;
          }
        }

        if (!objectRoot) {
          throw new Error("cad_parse_failed");
        }

        scene.add(objectRoot);
        fitCameraToObject(camera, controls, objectRoot);

        setViewerState({ status: "ready", cadKind: detectedCadKind, message: null, errorReason: null });
        animationId = window.requestAnimationFrame(renderLoop);
      } catch (e) {
        if (!cancelled) {
          const rawReason = e instanceof Error ? e.message : "";
          const kindForError: CadKindOrUnknown = cadKind ?? detectedCadKind;
          const isStep = kindForError === "step";
          const normalizedReason = rawReason.toLowerCase();
          const stepReason =
            normalizedReason.includes("step_preview_unavailable")
              ? "step_preview_unavailable"
              : "failed_to_load_step_stl_preview";

          setViewerState({
            status: "error",
            cadKind: kindForError,
            message: isStep
              ? "STEP preview is not available for this file yet. You can still download it."
              : "Unable to render this CAD file. You can still download it.",
            errorReason: isStep ? stepReason : null,
          });
          cleanup();
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [effectiveUrl, safeFileName, filenameHint, cadKind, onStatusChange]);

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
                  ? "Loading preview. This can take a moment."
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

