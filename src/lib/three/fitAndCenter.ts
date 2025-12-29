import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const CENTERED_FLAG = "__fitAndCenterCentered";

export type FitAndCenterOptions = {
  width: number;
  height: number;
  /**
   * Extra whitespace around the model (1.2–1.6 is typical).
   * Defaults to 1.35.
   */
  padding?: number;
};

/**
 * Center an Object3D at the origin and fit a PerspectiveCamera + OrbitControls to it.
 *
 * - Recenters by translating the provided root Object3D so its bounding-box center is at (0,0,0).
 * - Always updates camera aspect, orbit target, and camera distance.
 * - Prevents cumulative recentering by flagging `object.userData.__fitAndCenterCentered`.
 *
 * Call on: model load, model change, and container resize (not per frame).
 */
export function fitAndCenter(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  options: FitAndCenterOptions,
): void {
  const width = Math.max(1, Math.floor(options.width || 1));
  const height = Math.max(1, Math.floor(options.height || 1));
  const padding = typeof options.padding === "number" && Number.isFinite(options.padding) && options.padding > 0
    ? options.padding
    : 1.35;

  // Ensure world matrices are current before boxing.
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  // Recenter exactly once per loaded object instance.
  if (!(object.userData as any)?.[CENTERED_FLAG]) {
    object.position.sub(center);
    object.updateWorldMatrix(true, true);
    (object.userData as any)[CENTERED_FLAG] = true;
  }

  // Recompute after recenter for correctness.
  const box2 = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box2.min.x) || !Number.isFinite(box2.max.x)) return;
  if (box2.isEmpty()) return;

  const size2 = box2.getSize(new THREE.Vector3());
  const maxDim2 = Math.max(size2.x, size2.y, size2.z);
  const safeMaxDim2 = Math.max(maxDim2, 0.0001);

  controls.target.set(0, 0, 0);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  const fov = (camera.fov * Math.PI) / 180;
  const distance = (safeMaxDim2 / (2 * Math.tan(fov / 2))) * padding;

  // Stable diagonal view; avoids picking a "front" that might be arbitrary.
  camera.position.set(distance, distance, distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  // Snap immediately even if damping is enabled.
  controls.update();
  controls.update();
}

