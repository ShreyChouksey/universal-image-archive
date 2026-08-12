/**
 * WebXR / Spatial VR Immersive Standpoint Viewer Integration.
 *
 * Connects 360° equirectangular sphere geometry archives to WebXR headsets
 * and spatial displays, mapping 6-DoF head pose tracking directly to sphere
 * yaw, pitch, and field-of-view parameters.
 */

import type { Look } from '../core/sphere';
import { DEFAULT_FOV } from '../core/sphere';

export interface WebXRState {
  readonly supported: boolean;
  readonly active: boolean;
  look: Look;
}

export interface WebXRManager {
  readonly isSupported: boolean;
  readonly isActive: boolean;
  requestSession(onPoseUpdate: (look: Look) => void): Promise<boolean>;
  endSession(): Promise<void>;
  dispose(): void;
}

/** Converts head orientation quaternion [x, y, z, w] to Euler yaw & pitch (radians) */
export function quaternionToYawPitch(x: number, y: number, z: number, w: number): { yaw: number; pitch: number } {
  // Yaw (y-axis rotation)
  const siny_cosp = 2 * (w * y + x * z);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  // Pitch (x-axis rotation)
  const sinp = 2 * (w * x - y * z);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  return { yaw, pitch };
}

export function createWebXRManager(): WebXRManager {
  let supported = false;
  let active = false;
  let currentSession: unknown = null;

  const navXR = typeof navigator !== 'undefined' ? (navigator as unknown as { xr?: { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string, options?: unknown): Promise<unknown> } }).xr : undefined;

  if (navXR) {
    void navXR
      .isSessionSupported('immersive-vr')
      .then((isSup) => {
        supported = isSup;
      })
      .catch(() => {
        supported = false;
      });
  }

  return {
    get isSupported() {
      return supported;
    },
    get isActive() {
      return active;
    },
    async requestSession(onPoseUpdate: (look: Look) => void): Promise<boolean> {
      if (!supported || !navXR) return false;

      try {
        const session = await navXR.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor'],
        });

        currentSession = session;
        active = true;

        const sessAny = session as {
          addEventListener(type: string, listener: () => void): void;
          requestAnimationFrame(callback: (time: number, frame: unknown) => void): number;
          requestReferenceSpace(type: string): Promise<unknown>;
        };

        sessAny.addEventListener('end', () => {
          active = false;
          currentSession = null;
        });

        const refSpace = await sessAny.requestReferenceSpace('local-floor').catch(() => null);

        const onXRFrame = (_time: number, frame: unknown) => {
          if (!active) return;
          const frameAny = frame as {
            getViewerPose(refSpace: unknown): {
              transform: { orientation: { x: number; y: number; z: number; w: number } };
            } | null;
          };

          if (refSpace && frameAny) {
            const pose = frameAny.getViewerPose(refSpace);
            if (pose && pose.transform) {
              const { x, y, z, w } = pose.transform.orientation;
              const { yaw, pitch } = quaternionToYawPitch(x, y, z, w);
              onPoseUpdate({ yaw, pitch, fov: DEFAULT_FOV });
            }
          }
          sessAny.requestAnimationFrame(onXRFrame);
        };

        sessAny.requestAnimationFrame(onXRFrame);
        return true;
      } catch {
        active = false;
        currentSession = null;
        return false;
      }
    },
    async endSession(): Promise<void> {
      if (currentSession) {
        const sessAny = currentSession as { end(): Promise<void> };
        await sessAny.end().catch(() => {});
        currentSession = null;
      }
      active = false;
    },
    dispose() {
      void this.endSession();
    },
  };
}
