"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Html, OrbitControls } from "@react-three/drei";
import clsx from "clsx";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import {
  buildGeometryStatsFromObject3D,
  type GeometryStats,
} from "@/lib/dfm/basicPartChecks";

type CadViewerPanelProps = {
  file?: File | null;
  fileUrl?: string | null;
  fileName?: string | null;
  height?: number;
  className?: string;
  fallbackMessage?: string;
  onGeometryStats?: (stats: GeometryStats | null) => void;
};

type ViewerState = "empty" | "unsupported" | "ready";

export function CadViewerPanel({
  file,
  fileUrl,
  fileName,
  height = 360,
  className,
  fallbackMessage,
  onGeometryStats,
}: CadViewerPanelProps) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setLocalUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const resolvedUrl = localUrl ?? fileUrl ?? null;
  const extension = useMemo(
    () => inferExtension(file?.name ?? fileUrl ?? null),
    [file?.name, fileUrl],
  );
  const isSupported = Boolean(resolvedUrl && extension === ".stl");
  const viewerState: ViewerState = !resolvedUrl
    ? "empty"
    : isSupported
      ? "ready"
      : "unsupported";

  useEffect(() => {
    if (viewerState !== "ready") {
      onGeometryStats?.(null);
    }
  }, [viewerState, onGeometryStats]);

  const containerClasses = clsx(
    "rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4 shadow-inner",
    className,
  );
  const hasInitialSource = Boolean(file || fileUrl);

  const overlayMessage =
    viewerState === "empty"
      ? fallbackMessage ?? "Select a CAD file to preview."
      : viewerState === "unsupported"
        ? "Only STL files are supported for interactive previews today."
        : null;

  if (!hasInitialSource) {
    return (
      <section className={containerClasses}>
        <div
          className="flex items-center justify-center rounded-xl border border-slate-900/60 bg-slate-950/60 px-6 py-10 text-center text-xs text-slate-400"
          style={{ height }}
        >
          {fallbackMessage ?? "Select a CAD file to preview it in 3D."}
        </div>
      </section>
    );
  }

  return (
    <section className={containerClasses}>
      <div
        className="relative overflow-hidden rounded-xl border border-slate-900/50 bg-slate-950"
        style={{ height }}
      >
        {viewerState === "ready" && resolvedUrl ? (
          <Canvas
            camera={{ position: [0, 0, 4], fov: 45 }}
            dpr={[1, 2]}
            shadows={false}
          >
            <color attach="background" args={["#020617"]} />
            <ambientLight intensity={0.6} />
            <directionalLight
              position={[3, 4, 5]}
              intensity={0.9}
              color="#FFFFFF"
            />
            <directionalLight position={[-4, -2, -3]} intensity={0.3} />
            <StlMesh url={resolvedUrl} onGeometryStats={onGeometryStats} />
            <OrbitControls enablePan enableDamping enableZoom />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
            {overlayMessage}
          </div>
        )}
      </div>
      {fileName && (
        <p className="mt-3 truncate text-center text-xs uppercase tracking-wide text-slate-500">
          {fileName}
        </p>
      )}
    </section>
  );
}

function StlMesh({
  url,
  onGeometryStats,
}: {
  url: string;
  onGeometryStats?: (stats: GeometryStats | null) => void;
}) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadGeometry = async () => {
      setIsLoading(true);
      setLoadError(null);
      onGeometryStats?.(null);

      try {
        const loader = new STLLoader();
        const geometry = await loader.loadAsync(url);
        if (!isMounted) {
          geometry.dispose();
          return;
        }
        const nextMesh = createMesh(geometry);
        disposeMesh(meshRef.current);
        meshRef.current = nextMesh;
        setMesh(nextMesh);
        onGeometryStats?.(buildGeometryStatsFromObject3D(nextMesh));
      } catch (error) {
        if (!isMounted) {
          return;
        }
        console.error("[cad viewer] Failed to load STL source", error);
        setMesh(null);
        disposeMesh(meshRef.current);
        meshRef.current = null;
        setLoadError(error);
        onGeometryStats?.(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadGeometry();

    return () => {
      isMounted = false;
      disposeMesh(meshRef.current);
      meshRef.current = null;
      onGeometryStats?.(null);
    };
  }, [url, onGeometryStats]);

  return (
    <>
      {mesh ? (
        <Bounds fit clip observe margin={1.2}>
          <primitive
            object={mesh}
            rotation={[-Math.PI / 2, 0, 0]}
            castShadow
            receiveShadow
          />
        </Bounds>
      ) : null}
      {isLoading && <CanvasFallback />}
      {loadError && !isLoading && <CanvasErrorMessage />}
    </>
  );
}

function createMesh(geometry: THREE.BufferGeometry) {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: "#8BE8FF",
      metalness: 0.2,
      roughness: 0.65,
    }),
  );
}

function CanvasFallback() {
  return (
    <Html center>
      <div className="rounded-full border border-slate-800 bg-slate-900/90 px-4 py-2 text-xs font-medium text-slate-200">
        Loading 3D preview…
      </div>
    </Html>
  );
}

function CanvasErrorMessage() {
  return (
    <Html center>
      <div className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-100">
        Unable to load this CAD preview.
      </div>
    </Html>
  );
}

function inferExtension(source: string | null): string | null {
  if (!source) {
    return null;
  }
  const trimmed = source.trim().toLowerCase();
  const match = trimmed.match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return match ? `.${match[1]}` : null;
}

function disposeMesh(mesh: THREE.Mesh | null) {
  if (!mesh) {
    return;
  }
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
  } else if (material && "dispose" in material) {
    material.dispose();
  }
}
