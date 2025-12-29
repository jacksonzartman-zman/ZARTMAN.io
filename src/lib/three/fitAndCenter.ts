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
  const paddingFactor =
    typeof options.paddingFactor === "number" &&
    Number.isFinite(options.paddingFactor) &&
    options.paddingFactor > 0
      ? options.paddingFactor
      : 1.25;
  const viewDir =
    options.viewDir && options.viewDir.lengthSq() > 0
      ? options.viewDir.clone().normalize()
      : new THREE.Vector3(1, 1, 1).normalize();

  // Ensure transforms are stable before measuring.
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());

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

  const sphere = box2.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius || 0, 0.0001);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  // Fit bounding sphere into view accounting for aspect ratio.
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const limitingFov = Math.max(0.0001, Math.min(vFov, hFov));
  const distance = (radius / Math.sin(limitingFov / 2)) * paddingFactor;

  // Deterministic view direction + near/far planes.
  camera.position.copy(viewDir.multiplyScalar(distance));
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = Math.max(radius * 100, camera.near + 1);
  camera.updateProjectionMatrix();

  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);

  // Snap immediately even if damping is enabled.
  controls.update();
  controls.update();
}

