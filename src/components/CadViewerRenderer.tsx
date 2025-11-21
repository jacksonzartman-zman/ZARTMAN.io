"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader";
import type { BufferGeometry } from "three";

export type CadViewerProps = {
  src?: string | null;
  fileName?: string | null;
  height?: number;
  fallbackMessage?: string;
};

type ViewerState = "idle" | "loading" | "ready" | "error";

const DEFAULT_FALLBACK = "3D preview not available for this quote yet.";
const DEFAULT_HEIGHT = 320;
const VALID_PROTOCOL_REGEX = /^https?:\/\//i;

export default function CadViewerRenderer({
  src: rawSrc,
  fileName,
  height = DEFAULT_HEIGHT,
  fallbackMessage,
}: CadViewerProps) {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [status, setStatus] = useState<ViewerState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const safeSrc = useMemo(() => sanitizeSrc(rawSrc), [rawSrc]);

  useEffect(() => {
    let active = true;

    setErrorMessage(null);
    setGeometry((previous) => {
      previous?.dispose();
      return null;
    });

    if (!safeSrc) {
      setStatus("idle");
      return () => {
        active = false;
      };
    }

    setStatus("loading");
    const loader = new STLLoader();
    loader.setCrossOrigin("anonymous");
    const handleLoadError = (err: unknown) => {
      if (!active) {
        return;
      }
      console.error("CAD preview load error", err);
      setErrorMessage("Could not load the CAD preview.");
      setStatus("error");
    };

    try {
      loader.load(
        safeSrc,
        (loaded) => {
          if (!active) {
            loaded.dispose();
            return;
          }

          try {
            loaded.center();
          } catch (centeringError) {
            console.warn("Failed to center CAD geometry", centeringError);
          }

          setGeometry((previous) => {
            previous?.dispose();
            return loaded;
          });
          setStatus("ready");
        },
        undefined,
        handleLoadError,
      );
    } catch (loaderError) {
      handleLoadError(loaderError);
    }

    return () => {
      active = false;
      setGeometry((previous) => {
        previous?.dispose();
        return null;
      });
    };
  }, [safeSrc]);

  const materialColor = useMemo(() => "#8BE8FF", []);
  const safeHeight =
    typeof height === "number" && Number.isFinite(height) && height > 0
      ? height
      : DEFAULT_HEIGHT;

  const resolvedMessage = useMemo(() => {
    if (!safeSrc) {
      return fallbackMessage ?? DEFAULT_FALLBACK;
    }
    if (status === "loading") {
      return "Loading 3D preview…";
    }
    if (status === "error") {
      return errorMessage ?? "3D preview not available.";
    }
    if (status === "ready" && geometry) {
      return null;
    }
    return fallbackMessage ?? DEFAULT_FALLBACK;
  }, [errorMessage, fallbackMessage, geometry, safeSrc, status]);

  const showCanvas = status === "ready" && Boolean(geometry) && Boolean(safeSrc);
  const handleCanvasRuntimeError = useCallback((err: Error) => {
    console.error("CAD preview render error", err);
    setErrorMessage("Unable to render this CAD preview.");
    setStatus("error");
  }, []);
  const fallbackCopy = resolvedMessage ?? DEFAULT_FALLBACK;
  const viewerResetKey = safeSrc ?? "no-src";

  return (
    <div className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60"
        style={{ height: safeHeight }}
      >
        {showCanvas ? (
          <ViewerErrorBoundary
            fallback={<ViewerFallbackMessage>{fallbackCopy}</ViewerFallbackMessage>}
            onError={handleCanvasRuntimeError}
            resetKey={viewerResetKey}
          >
            <Canvas
              camera={{ position: [0, 0, 5], fov: 45 }}
              className="h-full w-full"
              dpr={[1, 2]}
            >
              <ambientLight intensity={0.45} />
              <directionalLight position={[2, 2, 3]} intensity={0.9} />
              <directionalLight position={[-2, -1, -2]} intensity={0.35} />
              <mesh geometry={geometry ?? undefined} rotation={[-Math.PI / 2, 0, 0]}>
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
          </ViewerErrorBoundary>
        ) : (
          <ViewerFallbackMessage>{fallbackCopy}</ViewerFallbackMessage>
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

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError: (error: Error) => void;
  resetKey: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ViewerErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function ViewerFallbackMessage({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-sm text-slate-500">{children}</p>
    </div>
  );
}

function sanitizeSrc(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (VALID_PROTOCOL_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    if (typeof window === "undefined") {
      return null;
    }
    const url = new URL(trimmed, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // ignore malformed URLs
  }

  return null;
}
