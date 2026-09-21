/**
 * Minimal stand-in for the Scandit Web SDK, shaped from the real 8.5.3 type
 * definitions and behaviour: BarcodeCapture.forContext resolves an ENABLED mode
 * carrying the SDK's own success feedback, the camera is driven through
 * switchToDesiredState, and decoded barcodes reach the registered listener.
 *
 * It lets the real controller, hook, camera, view and listener modules run, so
 * the lifecycle tests exercise shipped code rather than a model of it.
 */

export interface FakeSessionBarcode {
  data: string;
  rawData: string;
  symbology: string;
}

export class FakeSettings {
  symbologies: unknown[] = [];
  codeDuplicateFilter = 0;
  selectionMode: unknown = null;

  enableSymbologies(
    symbologies: unknown[],
  ): void {
    this.symbologies = [...symbologies];
  }
}

export class FakeFeedback {
  constructor(
    public readonly vibration: unknown,
    public readonly sound: unknown,
  ) {}
}

export class FakeCaptureFeedback {
  // The real default emits a beep and a vibration.
  success: FakeFeedback = new FakeFeedback(
    { kind: "DEFAULT_VIBRATION" },
    { kind: "DEFAULT_SOUND" },
  );

  static get default(): FakeCaptureFeedback {
    return new FakeCaptureFeedback();
  }
}

export class FakeCapture {
  enabled = true;
  feedback: FakeCaptureFeedback =
    FakeCaptureFeedback.default;

  readonly enabledHistory: boolean[] = [];
  readonly feedbackHistory: FakeFeedback[] = [];
  readonly listeners = new Set<Record<string, (...args: unknown[]) => void>>();

  addedListeners = 0;
  removedListeners = 0;

  constructor(
    public readonly settings: FakeSettings,
  ) {}

  async setEnabled(value: boolean): Promise<void> {
    this.enabled = value;
    this.enabledHistory.push(value);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setFeedback(
    feedback: FakeCaptureFeedback,
  ): Promise<void> {
    this.feedback = feedback;
    this.feedbackHistory.push(
      feedback.success,
    );
  }

  addListener(
    listener: Record<string, (...args: unknown[]) => void>,
  ): void {
    this.listeners.add(listener);
    this.addedListeners += 1;
  }

  removeListener(
    listener: Record<string, (...args: unknown[]) => void>,
  ): void {
    this.listeners.delete(listener);
    this.removedListeners += 1;
  }
}

export class FakeCamera {
  state = "off";
  torchState = "off";
  startCalls = 0;
  stopCalls = 0;
  addedListeners = 0;
  removedListeners = 0;

  readonly listeners = new Set<Record<string, (...args: unknown[]) => void>>();

  constructor(
    public readonly position: string,
    public readonly deviceId: string,
  ) {}

  async applySettings(
    _settings: unknown,
  ): Promise<void> {
    sdk.appliedCameraSettings += 1;
  }

  async switchToDesiredState(
    state: string,
  ): Promise<void> {
    if (state === "on") {
      this.startCalls += 1;

      const failure =
        sdk.cameraStartFailures.shift();

      if (failure) throw failure;

      this.state = "on";
      this.notify("on");

      if (sdk.onCameraStarted) {
        await sdk.onCameraStarted(this);
      }

      return;
    }

    this.stopCalls += 1;

    const failure =
      sdk.cameraStopFailures.shift();

    if (failure) throw failure;

    this.state = "off";
    this.notify("off");
  }

  private notify(state: string): void {
    for (const listener of this.listeners) {
      listener.didChangeState?.(
        this,
        state,
      );
    }
  }

  getCurrentState(): string {
    return this.state;
  }

  addListener(
    listener: Record<string, (...args: unknown[]) => void>,
  ): void {
    this.listeners.add(listener);
    this.addedListeners += 1;
  }

  removeListener(
    listener: Record<string, (...args: unknown[]) => void>,
  ): void {
    this.listeners.delete(listener);
    this.removedListeners += 1;
  }

  async isTorchAvailable(): Promise<boolean> {
    return true;
  }

  isZoomAvailable(): boolean {
    return true;
  }

  async setDesiredTorchState(
    state: string,
  ): Promise<void> {
    this.torchState = state;
  }
}

export class FakeView {
  attachedTo: unknown = null;
  detachCount = 0;
  pictureInPicture = true;
  scanAreaMargins: unknown = null;
  pointOfInterest: unknown = null;

  static async forContext(
    _context: unknown,
  ): Promise<FakeView> {
    const view = new FakeView();
    sdk.views.push(view);
    return view;
  }

  async allowPictureInPicture(
    value: boolean,
  ): Promise<void> {
    this.pictureInPicture = value;
  }

  connectToElement(
    element: unknown,
  ): void {
    this.attachedTo = element;
    sdk.attachedViews += 1;
  }

  detachFromElement(): void {
    this.attachedTo = null;
    this.detachCount += 1;
    sdk.detachedViews += 1;
  }
}

export interface FakeContext {
  frameSource: unknown;
  frameSourceHistory: unknown[];
  removedModes: unknown[];
  setFrameSource(source: unknown): Promise<void>;
  removeMode(mode: unknown): Promise<void>;
}

class Fake {
  cameras: FakeCamera[] = [];
  captures: FakeCapture[] = [];
  views: FakeView[] = [];
  cameraStartFailures: unknown[] = [];
  cameraStopFailures: unknown[] = [];
  onCameraStarted:
    | ((camera: FakeCamera) => void | Promise<void>)
    | null = null;
  appliedCameraSettings = 0;
  attachedViews = 0;
  detachedViews = 0;
  frameSequenceId = 1;

  reset(): void {
    this.cameras = [];
    this.captures = [];
    this.views = [];
    this.cameraStartFailures = [];
    this.cameraStopFailures = [];
    this.onCameraStarted = null;
    this.appliedCameraSettings = 0;
    this.attachedViews = 0;
    this.detachedViews = 0;
    this.frameSequenceId = 1;
  }

  createCamera(position: string): FakeCamera {
    const camera = new FakeCamera(
      position,
      `camera-${this.cameras.length + 1}`,
    );

    this.cameras.push(camera);
    return camera;
  }

  createCapture(
    settings: FakeSettings,
  ): FakeCapture {
    const capture = new FakeCapture(
      settings,
    );

    this.captures.push(capture);
    return capture;
  }

  get capture(): FakeCapture {
    const capture =
      this.captures[
        this.captures.length - 1
      ];

    if (!capture) {
      throw new Error(
        "No BarcodeCapture has been created.",
      );
    }

    return capture;
  }

  get camera(): FakeCamera {
    const camera =
      this.cameras[
        this.cameras.length - 1
      ];

    if (!camera) {
      throw new Error(
        "No camera has been selected.",
      );
    }

    return camera;
  }

  /** Delivers a decoded barcode exactly as the SDK listener would. */
  emitScan(
    value = "TCDS-6.2B-TEST",
    capture: FakeCapture = this.capture,
  ): void {
    const session = {
      newlyRecognizedBarcode: {
        data: value,
        rawData: value,
        symbology: "qr",
      } satisfies FakeSessionBarcode,
      frameSequenceID:
        this.frameSequenceId++,
    };

    for (const listener of capture.listeners) {
      listener.didScan?.(
        capture,
        session,
      );
    }
  }

  createContext(): FakeContext {
    const context: FakeContext = {
      frameSource: null,
      frameSourceHistory: [],
      removedModes: [],
      async setFrameSource(source) {
        context.frameSource = source;
        context.frameSourceHistory.push(
          source,
        );
      },
      async removeMode(mode) {
        context.removedModes.push(mode);
      },
    };

    return context;
  }
}

export const sdk = new Fake();

export function createCoreModule() {
  return {
    Camera: {
      pickBestGuessForPosition: (
        position: string,
      ) => sdk.createCamera(position),
      pickBestGuess: () =>
        sdk.createCamera("worldFacing"),
      getAll: async () => [
        ...sdk.cameras,
      ],
    },
    CameraPosition: {
      WorldFacing: "worldFacing",
      UserFacing: "userFacing",
      Unspecified: "unspecified",
    },
    FrameSourceState: {
      On: "on",
      Off: "off",
      Standby: "standby",
    },
    TorchState: {
      On: "on",
      Off: "off",
      Auto: "auto",
    },
    DataCaptureContext: {
      deviceID: "fake-device-id",
    },
    DataCaptureView: FakeView,
    MeasureUnit: {
      Fraction: "fraction",
      DIP: "dip",
      Pixel: "pixel",
    },
    NumberWithUnit: class {
      constructor(
        public readonly value: number,
        public readonly unit: string,
      ) {}
    },
    PointWithUnit: class {
      constructor(
        public readonly x: unknown,
        public readonly y: unknown,
      ) {}
    },
    MarginsWithUnit: class {
      constructor(
        public readonly left: unknown,
        public readonly top: unknown,
        public readonly right: unknown,
        public readonly bottom: unknown,
      ) {}
    },
    Feedback: FakeFeedback,
    Sound: class {},
    Vibration: class {},
  };
}

export function createBarcodeModule() {
  return {
    BarcodeCapture: {
      forContext: async (
        _context: unknown,
        settings: FakeSettings,
      ) => sdk.createCapture(settings),
      recommendedCameraSettings: {
        kind: "RECOMMENDED",
      },
    },
    BarcodeCaptureSettings: FakeSettings,
    BarcodeCaptureFeedback:
      FakeCaptureFeedback,
    SelectionMode: {
      On: "on",
      Off: "off",
      Auto: "auto",
    },
    Symbology: {
      Code128: "code128",
      EAN13UPCA: "ean13Upca",
      QR: "qr",
    },
  };
}

export async function flush(
  times = 4,
): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) =>
      setTimeout(resolve, 0),
    );
  }
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline =
    Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(
        "Timed out waiting for the expected scanner state.",
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 5),
    );
  }
}
