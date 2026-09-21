import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getScannerRuntime,
} from "../lib/scanning/runtime/scannerRuntimeRegistry";
import {
  hasBarcodeCaptureCapability,
} from "../lib/scanning/capture/BarcodeCaptureCapability";
import type {
  BarcodeCaptureStartOptions,
} from "../lib/scanning/capture/BarcodeCaptureCapability";
import type {
  BarcodeDecodeObservation,
} from "../lib/scanning/capture/BarcodeDecodeObservation";
import type {
  BarcodeCaptureStatus,
} from "../lib/scanning/capture/BarcodeCaptureStatus";
import type {
  ScannerProviderMetadata,
} from "../lib/scanning/contracts/ScannerProviderMetadata";
import type {
  ScannerRuntimeStatus,
} from "../lib/scanning/contracts/ScannerRuntimeStatus";

export interface UseBarcodeScannerResult {
  viewportRef: (node: HTMLDivElement | null) => void;
  status: BarcodeCaptureStatus;
  runtimeStatus: ScannerRuntimeStatus;
  providerMetadata: ScannerProviderMetadata | null;
  observation: BarcodeDecodeObservation | null;
  start: (
    options?: Omit<
      BarcodeCaptureStartOptions,
      "viewportElement"
    >,
  ) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  setTorch: (enabled: boolean) => Promise<void>;
  clearObservation: () => void;
}

export function useBarcodeScanner():
  UseBarcodeScannerResult {
  const runtime = useMemo(
    () => getScannerRuntime(),
    [],
  );

  if (!hasBarcodeCaptureCapability(runtime)) {
    throw new Error(
      "Configured scanner provider does not support BarcodeCaptureCapability.",
    );
  }

  const viewport =
    useRef<HTMLDivElement | null>(null);

  const ownsSession = useRef(false);

  // Set when the consumer unmounts. A start that is still queued or in flight
  // checks this before it attaches anything else to the page.
  const released = useRef(false);

  const lifecycleOperation =
    useRef<Promise<void>>(
      Promise.resolve(),
    );

  const [
    status,
    setStatus,
  ] = useState(
    runtime.getCaptureStatus(),
  );

  const [
    runtimeStatus,
    setRuntimeStatus,
  ] = useState<ScannerRuntimeStatus>(
    () => runtime.getStatus(),
  );

  const providerMetadata =
    useMemo<ScannerProviderMetadata | null>(
      () => {
        try {
          return runtime.getMetadata();
        } catch {
          return null;
        }
      },
      [runtime],
    );

  const [
    observation,
    setObservation,
  ] = useState<BarcodeDecodeObservation | null>(
    null,
  );

  const enqueueLifecycle = useCallback(
    (operation: () => Promise<void>) => {
      const next =
        lifecycleOperation.current.then(
          operation,
          operation,
        );

      lifecycleOperation.current =
        next.catch(() => undefined);

      return next;
    },
    [],
  );

  useEffect(() => {
    released.current = false;

    const unsubscribeStatus =
      runtime.subscribeToCaptureStatus(
        setStatus,
      );

    const unsubscribeScans =
      runtime.subscribeToScans(
        setObservation,
      );

    const unsubscribeRuntime =
      runtime.subscribe((event) =>
        setRuntimeStatus(event.status),
      );

    setRuntimeStatus(
      runtime.getStatus(),
    );

    return () => {
      released.current = true;

      unsubscribeStatus();
      unsubscribeScans();
      unsubscribeRuntime();

      // Ownership is claimed inside the queued start, so a start that has not
      // resolved yet is also released here: the queued release runs after it and
      // stops the camera, removes listeners and detaches the view.
      void enqueueLifecycle(
        async () => {
          if (!ownsSession.current) {
            return;
          }

          await runtime.stop();
          ownsSession.current = false;
        },
      );
    };
  }, [runtime, enqueueLifecycle]);

  useEffect(() => {
    const suspend = () => {
      if (!ownsSession.current) return;

      void enqueueLifecycle(
        () =>
          runtime.suspendForBackground(),
      );
    };

    const restore = () => {
      if (!ownsSession.current) return;

      if (
        document.visibilityState ===
        "visible"
      ) {
        void enqueueLifecycle(
          () =>
            runtime.resumeFromBackground(),
        );
      }
    };

    const onVisibility = () => {
      if (
        document.visibilityState ===
        "hidden"
      ) {
        suspend();
      } else {
        restore();
      }
    };

    document.addEventListener(
      "visibilitychange",
      onVisibility,
    );
    window.addEventListener(
      "pagehide",
      suspend,
    );
    window.addEventListener(
      "pageshow",
      restore,
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        onVisibility,
      );
      window.removeEventListener(
        "pagehide",
        suspend,
      );
      window.removeEventListener(
        "pageshow",
        restore,
      );
    };
  }, [runtime, enqueueLifecycle]);

  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewport.current = node;
    },
    [],
  );

  const start = useCallback(
    async (
      options: Omit<
        BarcodeCaptureStartOptions,
        "viewportElement"
      > = {},
    ) => {
      if (!viewport.current) {
        throw new Error(
          "Scanner viewport has not mounted.",
        );
      }

      return enqueueLifecycle(
        async () => {
          if (released.current) {
            // The consumer is gone. Nothing is attached, so nothing to release.
            return;
          }

          const viewportElement =
            viewport.current;

          if (!viewportElement) {
            return;
          }

          // Ownership is claimed before the first await so an unmount during
          // startup always releases this session.
          ownsSession.current = true;

          // The provider itself also initializes defensively. Calling initialize
          // here makes the PWA dependency explicit and deterministic.
          await runtime.initialize();

          if (released.current) {
            await runtime.stop();
            ownsSession.current = false;
            return;
          }

          await runtime.start({
            ...options,
            viewportElement,
          });

          if (released.current) {
            await runtime.stop();
            ownsSession.current = false;
          }
        },
      );
    },
    [runtime, enqueueLifecycle],
  );

  const stop = useCallback(
    () =>
      enqueueLifecycle(
        async () => {
          await runtime.stop();
          ownsSession.current = false;
        },
      ),
    [runtime, enqueueLifecycle],
  );

  return {
    viewportRef,
    status,
    runtimeStatus,
    providerMetadata,
    observation,
    start,
    pause: () =>
      enqueueLifecycle(
        () => runtime.pause(),
      ),
    resume: () =>
      enqueueLifecycle(
        () => runtime.resume(),
      ),
    stop,
    setTorch: (enabled) =>
      runtime.setTorch(enabled),
    clearObservation: () =>
      setObservation(null),
  };
}
