import * as THREE from "three";

export type DfMSeverity = "info" | "warning" | "error";

export type DfMCheckResult = {
  id: string;
  severity: DfMSeverity;
  title: string;
  message: string;
};

export type DfMEvaluation = {
  ok: boolean;
  checks: DfMCheckResult[];
  summary: string;
};

export type GeometryStats = {
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
  };
  dimensions: {
    x: number;
    y: number;
    z: number;
    longest: number;
    shortest: number;
    diagonal: number;
    volumeEstimate: number;
  };
  vertexCount: number;
  faceCount: number;
};

type EvaluateDfMArgs = {
  geometry?: GeometryStats | null;
  process?: string | null;
  material?: string | null;
  quantityHint?: string | number | null;
  targetDate?: string | null;
};

const LARGE_PART_THRESHOLD_MM = 500;
const THIN_WALL_THRESHOLD_MM = 0.5;
const SHEET_THICKNESS_THRESHOLD_MM = 6;
const URGENT_DAYS_THRESHOLD = 10;

export function buildGeometryStatsFromObject3D(
  object: THREE.Object3D,
): GeometryStats | null {
  if (!object) {
    return null;
  }

  const box = new THREE.Box3().setFromObject(object);
  if (!isFiniteVector(box.min) || !isFiniteVector(box.max)) {
    return null;
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const diagonal = box.max.clone().sub(box.min).length();

  let vertexCount = 0;
  let faceCount = 0;
  object.traverse((child) => {
    if (!("isMesh" in child) || !(child as THREE.Mesh).isMesh) {
      return;
    }
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    const positionAttr = geometry.getAttribute("position");
    if (positionAttr) {
      vertexCount += positionAttr.count;
      const faces = geometry.index
        ? geometry.index.count / 3
        : positionAttr.count / 3;
      faceCount += Math.max(0, faces);
    }
  });

  const dims = {
    x: round(size.x),
    y: round(size.y),
    z: round(size.z),
  };
  const longest = round(Math.max(dims.x, dims.y, dims.z));
  const shortest = round(
    Math.max(0.0001, Math.min(dims.x || Infinity, dims.y || Infinity, dims.z || Infinity)),
  );
  const volumeEstimate = round(dims.x * dims.y * dims.z);

  return {
    boundingBox: {
      min: [round(box.min.x), round(box.min.y), round(box.min.z)],
      max: [round(box.max.x), round(box.max.y), round(box.max.z)],
      center: [round(center.x), round(center.y), round(center.z)],
    },
    dimensions: {
      ...dims,
      longest,
      shortest,
      diagonal: round(diagonal),
      volumeEstimate,
    },
    vertexCount,
    faceCount,
  };
}

export function evaluatePartForDfM({
  geometry,
  process,
  material,
  quantityHint,
  targetDate,
}: EvaluateDfMArgs): DfMEvaluation {
  const checks: DfMCheckResult[] = [];
  const normalizedProcess = normalize(process);
  const normalizedMaterial = normalize(material);

  if (!geometry) {
    checks.push({
      id: "missing-geometry",
      severity: "info",
      title: "Awaiting geometry preview",
      message:
        "Upload an STL for this part to unlock automatic DFM checks and real-time fit analyses.",
    });
  } else {
    if (geometry.dimensions.longest > LARGE_PART_THRESHOLD_MM) {
      checks.push({
        id: "large-format",
        severity: "warning",
        title: "Large format part",
        message:
          "Verify machine envelope and tooling reach for the longest dimension before quoting.",
      });
    }

    if (geometry.dimensions.shortest < THIN_WALL_THRESHOLD_MM) {
      checks.push({
        id: "thin-features",
        severity: "warning",
        title: "Very thin features detected",
        message:
          "Small features may exceed common tolerance stacks. Flag the critical faces or relax tolerances.",
      });
    }

    const aspectRatio =
      geometry.dimensions.longest / Math.max(geometry.dimensions.shortest, 0.001);
    if (aspectRatio > 30) {
      checks.push({
        id: "slender-part",
        severity: "info",
        title: "High aspect ratio geometry",
        message:
          "Consider fixturing strategy and potential chatter for long, slender parts.",
      });
    }

    if (
      normalizedProcess?.includes("sheet") &&
      geometry.dimensions.shortest > SHEET_THICKNESS_THRESHOLD_MM
    ) {
      checks.push({
        id: "thick-sheet",
        severity: "warning",
        title: "Sheet metal thickness check",
        message:
          "Thickness exceeds the typical brake range. Confirm process (machined plate vs. bent sheet).",
      });
    }
  }

  if (!normalizedMaterial) {
    checks.push({
      id: "missing-material",
      severity: "info",
      title: "Material unspecified",
      message: "Call out a material grade or leave a placeholder so suppliers can quote accurately.",
    });
  } else if (
    normalizedProcess?.includes("injection") &&
    normalizedMaterial.includes("aluminum")
  ) {
    checks.push({
      id: "aluminum-injection",
      severity: "warning",
      title: "Aluminum is unusual for molding",
      message:
        "If this part is an injection molded component, aluminum may indicate a prototype tool rather than production material.",
    });
  }

  const quantityValue = extractLargestNumber(quantityHint);
  if (
    typeof quantityValue === "number" &&
    quantityValue > 1000 &&
    normalizedProcess?.includes("cnc")
  ) {
    checks.push({
      id: "cnc-high-volume",
      severity: "info",
      title: "High CNC volume",
      message:
        "Volumes above ~1,000 pieces may benefit from machining cells or alternate processes. Call out tolerance criticality to confirm fit.",
    });
  }

  if (targetDate) {
    const daysUntilDue = daysUntil(targetDate);
    if (daysUntilDue !== null && daysUntilDue <= URGENT_DAYS_THRESHOLD) {
      checks.push({
        id: "expedite-window",
        severity: "warning",
        title: "Aggressive ship date",
        message:
          "Target ship date is inside the normal quoting window. Confirm expedite expectations with suppliers early.",
      });
    }
  }

  const errorCount = checks.filter((check) => check.severity === "error").length;
  const warningCount = checks.filter((check) => check.severity === "warning").length;
  const summary =
    errorCount > 0
      ? `${errorCount} blocking DFM issue${errorCount === 1 ? "" : "s"}`
      : warningCount > 0
        ? `${warningCount} warning${warningCount === 1 ? "" : "s"} to review`
        : "Ready for quoting";

  return {
    ok: errorCount === 0,
    checks,
    summary,
  };
}

function normalize(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function extractLargestNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const matches = value.match(/\d+(?:\.\d+)?/g);
  if (!matches) {
    return null;
  }
  return matches.reduce<number | null>((max, current) => {
    const numeric = Number(current);
    if (!Number.isFinite(numeric)) {
      return max;
    }
    if (max === null || numeric > max) {
      return numeric;
    }
    return max;
  }, null);
}

function daysUntil(dateInput: string): number | null {
  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const diffMs = parsed.getTime() - Date.now();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

function round(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}
