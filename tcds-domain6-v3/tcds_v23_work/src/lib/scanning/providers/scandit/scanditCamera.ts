import {
  Camera,
  CameraPosition,
  FrameSourceState,
  TorchState,
  type FrameSourceListener,
} from "@scandit/web-datacapture-core";
import {
  BarcodeCapture,
} from "@scandit/web-datacapture-barcode";

export type ScanditCameraObservedState =
  | "ON"
  | "OFF"
  | "TRANSITIONING"
  | "STANDBY";

export interface CameraSelectionResult {
  camera: Camera;
  usedFallback: boolean;
  requestedWorldFacing: boolean;
  verifiedWorldFacing: boolean;
}

export function selectScanditCamera(
  preference: "WORLD_FACING" | "BEST_AVAILABLE",
): Camera {
  if (preference === "WORLD_FACING") {
    return Camera.pickBestGuessForPosition(
      CameraPosition.WorldFacing,
    );
  }

  return Camera.pickBestGuess();
}

export async function prepareCamera(
  camera: Camera,
): Promise<void> {
  await camera.applySettings(
    BarcodeCapture.recommendedCameraSettings,
  );
}

export async function startCamera(
  camera: Camera,
): Promise<void> {
  await camera.switchToDesiredState(
    FrameSourceState.On,
  );
}

export async function stopCamera(
  camera: Camera,
): Promise<void> {
  await camera.switchToDesiredState(
    FrameSourceState.Off,
  );
}

export function observeCameraState(
  camera: Camera,
  listener: (
    state: ScanditCameraObservedState,
    rawState: FrameSourceState,
  ) => void,
): () => void {
  const frameSourceListener: FrameSourceListener = {
    didChangeState: (_frameSource, state) => {
      const observed =
        state === FrameSourceState.On
          ? "ON"
          : state === FrameSourceState.Off
            ? "OFF"
            : state === FrameSourceState.Standby
              ? "STANDBY"
              : "TRANSITIONING";

      listener(observed, state);
    },
  };

  camera.addListener(frameSourceListener);

  return () => {
    camera.removeListener(frameSourceListener);
  };
}

export async function verifyPreferredCameraAfterAccess(
  camera: Camera,
  preference: "WORLD_FACING" | "BEST_AVAILABLE",
): Promise<CameraSelectionResult> {
  if (preference !== "WORLD_FACING") {
    return {
      camera,
      usedFallback: false,
      requestedWorldFacing: false,
      verifiedWorldFacing:
        camera.position === CameraPosition.WorldFacing,
    };
  }

  if (camera.position === CameraPosition.WorldFacing) {
    return {
      camera,
      usedFallback: false,
      requestedWorldFacing: true,
      verifiedWorldFacing: true,
    };
  }

  // Camera permission has already been granted by this point. Refreshing the
  // discovered devices is therefore safe and lets WebKit expose better metadata.
  const available = await Camera.getAll(true, true);

  const worldFacing = available.find(
    (candidate) =>
      candidate.position === CameraPosition.WorldFacing &&
      Boolean(candidate.deviceId),
  );

  if (!worldFacing) {
    return {
      camera,
      usedFallback: true,
      requestedWorldFacing: true,
      verifiedWorldFacing: false,
    };
  }

  return {
    camera: worldFacing,
    usedFallback: worldFacing.deviceId !== camera.deviceId,
    requestedWorldFacing: true,
    verifiedWorldFacing: true,
  };
}

export async function getCameraControls(
  camera: Camera,
): Promise<{
  torchAvailable: boolean;
  zoomAvailable: boolean;
}> {
  const [torchAvailable, zoomAvailable] =
    await Promise.all([
      camera.isTorchAvailable().catch(() => false),
      Promise.resolve(camera.isZoomAvailable()).catch(() => false),
    ]);

  return {
    torchAvailable,
    zoomAvailable,
  };
}

export async function setCameraTorch(
  camera: Camera,
  enabled: boolean,
): Promise<void> {
  await camera.setDesiredTorchState(
    enabled ? TorchState.On : TorchState.Off,
  );
}
