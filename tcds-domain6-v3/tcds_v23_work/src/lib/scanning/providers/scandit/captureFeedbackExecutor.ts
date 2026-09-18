import type {
  BarcodeCaptureFeedbackPolicy,
} from "../../capture/BarcodeCaptureCapability";

let audioContext:
  AudioContext | null = null;

async function emitShortBeep():
  Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof AudioContext ===
      "undefined"
  ) {
    return;
  }

  audioContext ??=
    new AudioContext();

  if (
    audioContext.state ===
    "suspended"
  ) {
    await audioContext.resume();
  }

  const oscillator =
    audioContext.createOscillator();
  const gain =
    audioContext.createGain();

  oscillator.frequency.value =
    880;
  gain.gain.value = 0.03;

  oscillator.connect(gain);
  gain.connect(
    audioContext.destination,
  );

  const now =
    audioContext.currentTime;

  oscillator.start(now);
  oscillator.stop(now + 0.055);
}

export async function executeCaptureFeedback(
  policy:
    BarcodeCaptureFeedbackPolicy,
): Promise<void> {
  if (
    policy.vibration &&
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate ===
      "function"
  ) {
    navigator.vibrate(45);
  }

  if (policy.sound) {
    await emitShortBeep().catch(
      () => undefined,
    );
  }
}
