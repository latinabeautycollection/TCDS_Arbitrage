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

export interface UseBarcodeScannerResult {
  viewportRef: (node: HTMLDivElement | null) => void;
  status: BarcodeCaptureStatus;
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
    const unsubscribeStatus =
      runtime.subscribeToCaptureStatus(
        setStatus,
      );

    const unsubscribeScans =
      runtime.subscribeToScans(
        setObservation,
      );

    return () => {
      unsubscribeStatus();
      unsubscribeScans();

      if (ownsSession.current) {
        void enqueueLifecycle(
          async () => {
            await runtime.stop();
            ownsSession.current = false;
          },
        );
      }
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
          // The provider itself also initializes defensively. Calling initialize
          // here makes the PWA dependency explicit and deterministic.
          await runtime.initialize();

          await runtime.start({
            ...options,
            viewportElement:
              viewport.current!,
          });

          ownsSession.current = true;
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
