import {
  BarcodeScanner,
} from "../../components/scanning/BarcodeScanner";

export function ScannerCaptureDiagnosticPage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-slate-950 px-4 py-6 text-white sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
          Domain 6.2B Diagnostic
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Camera & Barcode Capture Certification
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          This restricted surface proves camera and decode operation only. A decoded barcode is an observation, not a warehouse decision.
        </p>
      </header>

      <BarcodeScanner />
    </main>
  );
}
