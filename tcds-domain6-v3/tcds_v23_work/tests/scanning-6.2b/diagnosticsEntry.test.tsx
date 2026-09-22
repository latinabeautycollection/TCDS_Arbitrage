import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  authenticated: true,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => routerMock.navigate,
}));

vi.mock(
  "../../src/features/auth/context/AuthContext",
  () => ({
    useAuth: () => ({
      state: authMock.authenticated
        ? "authenticated"
        : "anonymous",
      session: {
        authenticated:
          authMock.authenticated,
      },
    }),
  }),
);

import {
  ScannerDiagnosticsEntry,
  SCANNER_DIAGNOSTICS_HOLD_MS,
  SCANNER_DIAGNOSTICS_ROUTE,
} from "../../src/components/scanning/ScannerDiagnosticsEntry";

beforeEach(() => {
  vi.useFakeTimers();
  routerMock.navigate.mockClear();
  authMock.authenticated = true;
});

afterEach(() => {
  vi.useRealTimers();
});

function renderEntry() {
  return render(
    <ScannerDiagnosticsEntry>
      <span>Scanner</span>
    </ScannerDiagnosticsEntry>,
  );
}

describe("6.2B diagnostic entry point", () => {
  it("opens the diagnostic surface after a deliberate press and hold", () => {
    renderEntry();

    const target = screen.getByTestId(
      "scanner-diagnostics-entry",
    );

    fireEvent.pointerDown(target);
    vi.advanceTimersByTime(
      SCANNER_DIAGNOSTICS_HOLD_MS,
    );

    expect(
      routerMock.navigate,
    ).toHaveBeenCalledWith(
      SCANNER_DIAGNOSTICS_ROUTE,
    );
  });

  it("ignores an ordinary tap", () => {
    renderEntry();

    const target = screen.getByTestId(
      "scanner-diagnostics-entry",
    );

    fireEvent.pointerDown(target);
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(target);
    vi.advanceTimersByTime(
      SCANNER_DIAGNOSTICS_HOLD_MS,
    );

    expect(
      routerMock.navigate,
    ).not.toHaveBeenCalled();
  });

  it("ignores a hold that leaves the target", () => {
    renderEntry();

    const target = screen.getByTestId(
      "scanner-diagnostics-entry",
    );

    fireEvent.pointerDown(target);
    fireEvent.pointerLeave(target);
    vi.advanceTimersByTime(
      SCANNER_DIAGNOSTICS_HOLD_MS,
    );

    expect(
      routerMock.navigate,
    ).not.toHaveBeenCalled();
  });

  it("offers nothing at all when nobody is signed in", () => {
    authMock.authenticated = false;

    const { container } = renderEntry();

    expect(
      screen.queryByTestId(
        "scanner-diagnostics-entry",
      ),
    ).toBeNull();
    expect(
      container.textContent,
    ).toContain("Scanner");

    fireEvent.pointerDown(
      screen.getByText("Scanner"),
    );
    vi.advanceTimersByTime(
      SCANNER_DIAGNOSTICS_HOLD_MS * 2,
    );

    expect(
      routerMock.navigate,
    ).not.toHaveBeenCalled();
  });
});
