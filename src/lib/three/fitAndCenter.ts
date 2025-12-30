import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const CENTERED_FLAG = "__fitAndCenterCentered";

export type FitAndCenterOptions = {
  width: number;
  height: number;
  /**
   * Extra whitespace around the model (1.1–1.6 is typical).
   * Defaults to 1.25.
   */
  paddingFactor?: number;
  /**
   * Camera view direction (world space), e.g. (1,1,1).
   * Defaults to a stable diagonal view.
   */
  viewDir?: THREE.Vector3;
};

export type FitAndCenterSizeSource =
  | FitAndCenterOptions
  | Pick<FitAndCenterOptions, "width" | "height">
  | HTMLElement;

function resolveSize(source: FitAndCenterSizeSource): { width: number; height: number } {
  if (typeof (source as HTMLElement)?.getBoundingClientRect === "function") {
    const el = source as HTMLElement;
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || el.clientWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || el.clientHeight || 1));
    return { width, height };
  }
  const any = source as { width?: unknown; height?: unknown };
  const width = Math.max(1, Math.floor(typeof any.width === "number" ? any.width : 1));
  const height = Math.max(1, Math.floor(typeof any.height === "number" ? any.height : 1));
  return { width, height };
}

/**
 * Center an Object3D at the origin and fit a PerspectiveCamera + OrbitControls to it.
 *
 * - Recenters by translating the provided root Object3D so its bounding-box center is at (0,0,0).
 * - Treats Z as “up”: after centering, translates so the model “floor” sits at z=0.
 * - Always updates camera aspect, orbit target, and camera distance.
 * - Prevents cumulative recentering by flagging `object.userData.__fitAndCenterCentered`.
 *
 * Call on: model load, model change, and container resize (not per frame).
 */
export function fitAndCenter(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  sizeOrElement: FitAndCenterSizeSource,
  options?: Omit<FitAndCenterOptions, "width" | "height">,
): void {
  const { width, height } = resolveSize(sizeOrElement);
  const sourceOptions =
    typeof (sizeOrElement as any)?.width === "number" && typeof (sizeOrElement as any)?.height === "number"
      ? (sizeOrElement as FitAndCenterOptions)
      : null;
  const paddingFactor =
    typeof sourceOptions?.paddingFactor === "number" &&
    Number.isFinite(sourceOptions.paddingFactor) &&
    sourceOptions.paddingFactor > 0
      ? sourceOptions.paddingFactor
      : typeof options?.paddingFactor === "number" &&
          Number.isFinite(options.paddingFactor) &&
          options.paddingFactor > 0
        ? options.paddingFactor
      : 1.25;
  const viewDir =
    sourceOptions?.viewDir && sourceOptions.viewDir.lengthSq() > 0
      ? sourceOptions.viewDir.clone().normalize()
      : options?.viewDir && options.viewDir.lengthSq() > 0
        ? options.viewDir.clone().normalize()
      : new THREE.Vector3(1, -1, 1).normalize();

  // Ensure transforms are stable before measuring.
  object.updateWorldMatrix(true, true);
  const initialBox = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(initialBox.min.x) || !Number.isFinite(initialBox.max.x)) return;
  if (initialBox.isEmpty()) return;

  // Recenter + ground exactly once per loaded object instance.
  if (!(object.userData as any)?.[CENTERED_FLAG]) {
    const center = initialBox.getCenter(new THREE.Vector3());
    object.position.sub(center);
    object.updateWorldMatrix(true, true);

    // After centering, ground the model so its "floor" sits on z=0.
    const centeredBox = new THREE.Box3().setFromObject(object);
    if (Number.isFinite(centeredBox.min.z)) {
      const minZ = centeredBox.min.z;
      if (Number.isFinite(minZ) && Math.abs(minZ) > 1e-9) {
        object.position.z -= minZ;
        object.updateWorldMatrix(true, true);
      }
    }

    (object.userData as any)[CENTERED_FLAG] = true;
  }

  // Recompute after recenter/ground for correctness.
  const finalBox = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(finalBox.min.x) || !Number.isFinite(finalBox.max.x)) return;
  if (finalBox.isEmpty()) return;

  const sphere = finalBox.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius || 0, 0.0001);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  // Fit bounding sphere into view accounting for aspect ratio.
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const limitingFov = Math.max(0.0001, Math.min(vFov, hFov));
  const distance = (radius / Math.sin(limitingFov / 2)) * paddingFactor;

  // Deterministic view direction + near/far planes.
  camera.position.copy(viewDir.clone().multiplyScalar(distance));
  camera.near = Math.max(radius / 1000, 0.0001);
  camera.far = Math.max(radius * 1000, distance + radius * 20);
  camera.updateProjectionMatrix();

  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);

  // Ensure orbit distances won't clamp the fitted view.
  // (OrbitControls will clamp camera position when updating if outside min/max.)
  controls.minDistance = Math.min(controls.minDistance || Infinity, Math.max(0.0001, distance / 200));
  controls.maxDistance = Math.max(controls.maxDistance || 0, distance * 20, radius * 2000);

  // Snap immediately even if damping is enabled.
  controls.update();
  controls.update();
}

