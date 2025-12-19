"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { classifyCadFileType } from "@/lib/cadRendering";

export type CadKind = "stl" | "obj" | "glb" | "step" | "unknown";
export type ViewerStatus = "idle" | "loading" | "ready" | "error" | "unsupported";
export type ThreeCadViewerReport = {
  status: ViewerStatus;
  cadKind: CadKind;
  message: string | null;
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
  fileId: string;
  className?: string;
  /**
   * Optional override for a better UX; viewer will also try to infer from response headers.
   */
  filenameHint?: string | null;
  /**
   * Optional callback for higher-level UX (e.g. STEP-specific fallback copy).
   */
  onStatusChange?: (report: ThreeCadViewerReport) => void;
};

export function ThreeCadViewer({
  fileId,
  className,
  filenameHint,
  onStatusChange,
}: ThreeCadViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolvedFilename, setResolvedFilename] = useState<string | null>(null);
  const [cadKind, setCadKind] = useState<CadKind>("unknown");

  const safeFileId = safeTrim(fileId);

  const inlineUrl = useMemo(() => {
    if (!safeFileId) return null;
    return `/api/parts-file-preview?fileId=${encodeURIComponent(safeFileId)}&disposition=inline`;
  }, [safeFileId]);

  const downloadUrl = useMemo(() => {
    if (!safeFileId) return null;
    return `/api/parts-file-preview?fileId=${encodeURIComponent(safeFileId)}&disposition=attachment`;
  }, [safeFileId]);

  const classification = useMemo(() => {
    return classifyCadFileType({ filename: filenameHint ?? resolvedFilename, extension: null });
  }, [filenameHint, resolvedFilename]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
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
      if (disposed || !renderer || !scene || !camera) return;
      controls?.update();
      renderer.render(scene, camera);
      animationId = window.requestAnimationFrame(renderLoop);
    };

    const start = async () => {
      let detectedCadKind: CadKind = "unknown";

      const setViewerState = (next: {
        status: ViewerStatus;
        cadKind?: CadKind;
        message?: string | null;
      }) => {
        const nextCadKind = typeof next.cadKind === "undefined" ? "unknown" : next.cadKind;
        const nextMessage = typeof next.message === "undefined" ? null : next.message;

        setStatus(next.status);
        setCadKind(nextCadKind);
        setErrorMessage(nextMessage);
        onStatusChange?.({ status: next.status, cadKind: nextCadKind, message: nextMessage });
      };

      if (!inlineUrl) {
        setViewerState({ status: "idle", cadKind: "unknown", message: null });
        cleanup();
        return;
      }

      if (!hasWebGLSupport()) {
        setViewerState({
          status: "error",
          cadKind: "unknown",
          message: "WebGL is not available in this browser. You can still download the file.",
        });
        cleanup();
        return;
      }

      setViewerState({ status: "loading", message: null });

      try {
        const res = await fetch(inlineUrl, { method: "GET" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `preview_failed_${res.status}`);
        }

        const inferred = parseFilenameFromContentDisposition(res.headers.get("content-disposition"));
        if (!disposed) setResolvedFilename(inferred ?? null);

        const blob = await res.blob();
        if (disposed) return;

        if (blob.size > MAX_RENDER_BYTES) {
          setViewerState({
            status: "error",
            message:
              "This CAD file is too large to safely render in-browser (over 20 MB). You can still download it.",
          });
          cleanup();
          return;
        }

        const fileNameForType = filenameHint ?? inferred ?? null;
        const typeInfo = classifyCadFileType({ filename: fileNameForType, extension: null });
        if (!typeInfo.ok) {
          setViewerState({
            status: "error",
            cadKind: "unknown",
            message: "Unable to render this CAD file. You can still download it.",
          });
          cleanup();
          return;
        }

        detectedCadKind = typeInfo.type;
        setViewerState({ status: "loading", cadKind: detectedCadKind, message: null });

        ({ renderer, scene, camera, controls, resizeObserver } = initializeThree(container));

        const buffer = await blob.arrayBuffer();
        if (disposed) return;

        if (typeInfo.type === "stl") {
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
          objectRoot = mesh;
        } else if (typeInfo.type === "obj") {
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
        } else if (typeInfo.type === "glb") {
          const loader = new GLTFLoader();
          const gltf = await loader.parseAsync(buffer, "");
          objectRoot = gltf.scene ?? new THREE.Group();
        } else if (typeInfo.type === "step") {
          const stepBytes = new Uint8Array(buffer);
          const failUnsupported = (message: string) => {
            setViewerState({ status: "unsupported", cadKind: "step", message });
            cleanup();
          };

          const failStep = (message: string, error?: unknown) => {
            // Keep a single, tagged error for unexpected STEP failures.
            if (error) {
              console.error("[three-step-preview]", error);
            }
            setViewerState({ status: "error", cadKind: "step", message });
            cleanup();
          };

          try {
            if (typeof WebAssembly === "undefined") {
              failUnsupported("STEP preview is not available in this browser. You can still download the file.");
              return;
            }

            const mod = (await import("occt-import-js")) as any;
            const occtFactory = mod?.default ?? mod;
            if (typeof occtFactory !== "function") {
              failUnsupported(
                "STEP preview is not available for this file in the browser yet. You can still download it.",
              );
              return;
            }

            // occt-import-js ships a wasm file; serve it from /public to avoid bundler surprises.
            const occt = await occtFactory({
              locateFile(path: string) {
                if (path.endsWith(".wasm")) return "/occt-import-js.wasm";
                return path;
              },
            });

            const result = occt.ReadStepFile(stepBytes, null);
            if (!result?.success) {
              failStep(
                "STEP preview failed for this file. You can still download it.",
                new Error("step_import_failed"),
              );
              return;
            }

            const meshes = Array.isArray(result.meshes) ? result.meshes : [];
            if (meshes.length === 0) {
              failStep(
                "STEP preview failed for this file. You can still download it.",
                new Error("step_no_meshes"),
              );
              return;
            }

            const group = new THREE.Group();
            const material = new THREE.MeshStandardMaterial({
              color: "#7dd3fc",
              metalness: 0.1,
              roughness: 0.65,
            });

            for (const mesh of meshes) {
              const pos = mesh?.attributes?.position?.array ?? mesh?.attributes?.position;
              if (!pos) continue;

              const geometry = new THREE.BufferGeometry();
              const positions =
                pos instanceof Float32Array ? pos : new Float32Array(pos as ArrayLike<number>);
              if (positions.length < 3) continue;
              geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

              const normals = mesh?.attributes?.normal?.array ?? mesh?.attributes?.normal;
              if (normals) {
                const normalArray =
                  normals instanceof Float32Array
                    ? normals
                    : new Float32Array(normals as ArrayLike<number>);
                if (normalArray.length === positions.length) {
                  geometry.setAttribute("normal", new THREE.BufferAttribute(normalArray, 3));
                }
              }

              const idx = mesh?.index?.array ?? mesh?.index;
              if (idx) {
                const indices =
                  idx instanceof Uint32Array || idx instanceof Uint16Array
                    ? idx
                    : new Uint32Array(idx as ArrayLike<number>);
                if (indices.length > 0) {
                  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
                }
              }

              geometry.computeBoundingBox();
              if (!geometry.getAttribute("normal")) {
                geometry.computeVertexNormals();
              }

              group.add(new THREE.Mesh(geometry, material));
            }

            if (group.children.length === 0) {
              failStep(
                "STEP preview failed for this file. You can still download it.",
                new Error("step_mesh_build_failed"),
              );
              return;
            }

            objectRoot = group;
          } catch (error) {
            failStep("STEP preview failed for this file. You can still download it.", error);
            return;
          }
        }

        if (!objectRoot) {
          throw new Error("cad_parse_failed");
        }

        scene.add(objectRoot);
        fitCameraToObject(camera, controls, objectRoot);

        setViewerState({ status: "ready", cadKind: detectedCadKind, message: null });
        animationId = window.requestAnimationFrame(renderLoop);
      } catch (e) {
        if (!disposed) {
          setViewerState({
            status: "error",
            cadKind: detectedCadKind,
            message: "Unable to render this CAD file. You can still download it.",
          });
          cleanup();
        }
      }
    };

    start();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [inlineUrl, filenameHint, onStatusChange]);

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
                  ? "Parsing CAD in your browser. This can take a moment."
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
              {classification.ok ? (
                <p className="text-[11px] text-slate-500">Detected: {classification.type.toUpperCase()}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

