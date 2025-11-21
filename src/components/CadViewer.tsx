"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import type { BufferGeometry } from "three";

type CadViewerProps = {
  src?: string | null;
  fileName?: string | null;
  height?: number;
  fallbackMessage?: string;
};

type ViewerState = "idle" | "loading" | "ready" | "error";

const DEFAULT_FALLBACK = "3D preview not available for this quote yet.";

export default function CadViewer({
  src,
  fileName,
  height = 320,
  fallbackMessage,
}: CadViewerProps) {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [status, setStatus] = useState<ViewerState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setErrorMessage(null);
    setGeometry((previous) => {
      previous?.dispose();
      return null;
    });

    if (!src) {
      setStatus("idle");
      return () => {
        active = false;
      };
    }

    setStatus("loading");
    const loader = new STLLoader();
    loader.setCrossOrigin("anonymous");

    loader.load(
      src,
      (loaded) => {
        if (!active) {
          loaded.dispose();
          return;
        }

        loaded.center();
        setGeometry((previous) => {
          previous?.dispose();
          return loaded;
        });
        setStatus("ready");
      },
      undefined,
      (err) => {
        if (!active) {
          return;
        }
        console.error("CAD preview load error", err);
        setErrorMessage("Could not load the CAD preview.");
        setStatus("error");
      },
    );

    return () => {
      active = false;
      setGeometry((previous) => {
        previous?.dispose();
        return null;
      });
    };
  }, [src]);

  const materialColor = useMemo(() => "#8BE8FF", []);

  const message =
    !src || status === "idle"
      ? fallbackMessage ?? DEFAULT_FALLBACK
      : status === "loading"
        ? "Loading 3D preview…"
        : status === "error"
          ? errorMessage ?? "3D preview not available."
          : null;

  const showCanvas = status === "ready" && geometry && src;

  return (
    <div className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60"
        style={{ height }}
      >
        {showCanvas ? (
          <Canvas
            camera={{ position: [0, 0, 5], fov: 45 }}
            className="h-full w-full"
            dpr={[1, 2]}
          >
            <ambientLight intensity={0.45} />
            <directionalLight position={[2, 2, 3]} intensity={0.9} />
            <directionalLight position={[-2, -1, -2]} intensity={0.35} />
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
              <meshStandardMaterial
                attach="material"
                color={materialColor}
                metalness={0.15}
                roughness={0.6}
              />
            </mesh>
            <OrbitControls
              enableDamping
              enablePan
              enableZoom
              dampingFactor={0.08}
              makeDefault
            />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-slate-500">{message}</p>
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
