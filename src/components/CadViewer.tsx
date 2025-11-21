"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";

export type CadViewerProps = {
  src?: string | null;
  fileName?: string | null;
  height?: number;
  fallbackMessage?: string;
};

type ViewerState = "idle" | "loading" | "ready" | "error";

const DEFAULT_HEIGHT = 320;
const DEFAULT_FALLBACK = "3D preview not available for this quote yet.";
const SUPPORTED_EXTENSIONS = [".stl"];

export default function CadViewer({
  src,
  fileName,
  height = DEFAULT_HEIGHT,
  fallbackMessage,
}: CadViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<ViewerState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const safeHeight =
    typeof height === "number" && Number.isFinite(height) && height > 0
      ? height
      : DEFAULT_HEIGHT;
  const safeSrc = useMemo(() => sanitizeSrc(src), [src]);
  const isSupportedSrc = useMemo(() => isSupportedCadUrl(safeSrc), [safeSrc]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    let animationId: number | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mesh: THREE.Mesh | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.MeshStandardMaterial | null = null;

    const resetContainer = () => {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };

    const cleanup = () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
      controls?.dispose();
      resizeObserver?.disconnect();
      renderer?.dispose();
      material?.dispose();
      geometry?.dispose();
      if (scene && mesh) {
        scene.remove(mesh);
      }
      mesh = null;
      geometry = null;
      material = null;
      resetContainer();
    };

    const start = async () => {
      setErrorMessage(null);

      if (!safeSrc) {
        setStatus("idle");
        cleanup();
        return;
      }

      if (!isSupportedSrc) {
        setStatus("error");
        setErrorMessage("This preview only supports STL files right now.");
        cleanup();
        return;
      }

      if (!hasWebGLSupport()) {
        setStatus("error");
        setErrorMessage("WebGL is not available in this browser.");
        cleanup();
        return;
      }

      setStatus("loading");

      try {
        ({ renderer, scene, camera, controls, resizeObserver } =
          initializeThree(container, safeHeight));

        const loader = new STLLoader();
        loader.setCrossOrigin("anonymous");

        geometry = await loader.loadAsync(safeSrc);
        if (disposed) {
          geometry.dispose();
          return;
        }

        mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: "#8BE8FF",
            metalness: 0.15,
            roughness: 0.6,
          }),
        );
        mesh.rotation.set(-Math.PI / 2, 0, 0);
        material = mesh.material as THREE.MeshStandardMaterial;

        scene?.add(mesh);
        fitCameraToGeometry(camera, controls, geometry);

        const renderLoop = () => {
          if (disposed || !renderer || !scene || !camera) {
            return;
          }
          try {
            controls?.update();
            renderer.render(scene, camera);
            animationId = window.requestAnimationFrame(renderLoop);
          } catch (renderError) {
            console.error("CAD preview render error", renderError);
            setErrorMessage("Unable to render this CAD preview.");
            setStatus("error");
          }
        };

        setStatus("ready");
        animationId = window.requestAnimationFrame(renderLoop);
      } catch (error) {
        console.error("CAD preview load error", error);
        if (!disposed) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load the 3D preview.",
          );
          setStatus("error");
        }
      }
    };

    start();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [isSupportedSrc, safeHeight, safeSrc]);

  const showCanvas = status === "ready";
  const fallbackCopy = useMemo(() => {
    if (!safeSrc) {
      return fallbackMessage ?? DEFAULT_FALLBACK;
    }
    if (!isSupportedSrc) {
      return "Only STL CAD files are supported today.";
    }
    if (status === "loading") {
      return "Loading 3D preview…";
    }
    if (status === "error") {
      return errorMessage ?? "Unable to display the 3D preview.";
    }
    return fallbackMessage ?? DEFAULT_FALLBACK;
  }, [errorMessage, fallbackMessage, isSupportedSrc, safeSrc, status]);

  return (
    <div className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60"
        style={{ "--cad-viewer-height": `${safeHeight}px` } as CSSProperties}
      >
        <div
          ref={containerRef}
          className="h-[var(--cad-viewer-height)] w-full"
          role="presentation"
        />
        {!showCanvas && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-sm text-slate-500">{fallbackCopy}</p>
          </div>
        )}
      </div>
      {fileName && (
        <p className="mt-3 text-center text-xs uppercase tracking-wide text-slate-500">
          {fileName}
        </p>
      )}
    </div>
  );
}

function initializeThree(container: HTMLDivElement, height: number) {
  const width = Math.max(1, Math.floor(container.clientWidth || 1));
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x020617, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
  camera.position.set(0, 0, 5);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(2, 2, 3);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-2, -1, -2);
  scene.add(ambient, keyLight, fillLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = true;
  controls.enablePan = true;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.appendChild(renderer.domElement);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.max(1, Math.floor(entry.contentRect.width));
      renderer.setSize(nextWidth, height, false);
      camera.aspect = nextWidth / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);
  }

  return { renderer, scene, camera, controls, resizeObserver };
}

function fitCameraToGeometry(
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null,
  geometry: THREE.BufferGeometry,
) {
  if (!camera) {
    return;
  }

  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  if (!sphere) {
    return;
  }

  const radius = Math.max(sphere.radius, 0.0001);
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
  const offset = distance * 1.1;

  const center = sphere.center.clone();
  camera.position.set(center.x, center.y, center.z + offset);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();

  controls?.target.copy(center);
  controls?.update();
}

function sanitizeSrc(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (typeof window !== "undefined") {
    try {
      const url = new URL(trimmed, window.location.origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function isSupportedCadUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function hasWebGLSupport(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}
