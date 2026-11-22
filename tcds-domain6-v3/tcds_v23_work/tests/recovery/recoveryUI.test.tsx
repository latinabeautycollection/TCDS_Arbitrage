// Warehouse password recovery screens against the Login V2 recovery contract proven on staging (2026-11-22):
// one submit for code + new password, one browser binding per page, approve-only admin flow with a passkey.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/features/auth/context/AuthContext", () => ({ useAuth: () => ({ session: { authenticated: true } }) }));
vi.mock("../../src/features/auth/storage/deviceCredentialStore", () => ({ deviceCredentialStore: { secrets: async () => null } }));
const passkey = vi.fn();
vi.mock("../../src/features/auth/security/webauthnBrowser", () => ({ authenticateWithPasskey: (o: unknown) => passkey(o) }));
import { AdminRecoveryPage, EmployeeRecoveryPage, ManagerRecoveryPage, NewPasswordRecoveryPage } from "../../src/features/auth/recovery/RecoveryUI";

type Call = { path: string; method: string; headers: Headers; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: {} });
const REF = "R".repeat(43), CODE = "12345678", PASSWORD = "Correct-Horse-9-Battery";
const REQ = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  calls = []; passkey.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const c: Call = { path: String(url).replace(/^.*\/password-recovery/, ""), method: init.method ?? "GET",
      headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c);
    const r = reply(c);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const err = (status: number, code: string) => ({ status, body: { error: { code } } });
const posts = (p: string) => calls.filter(c => c.method === "POST" && c.path.startsWith(p));
function page(ui: JSX.Element, path = "/") { return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>); }
async function openNewPassword() {
  page(<NewPasswordRecoveryPage />, `/auth/recovery/new-password?ref=${REF}`);
  await screen.findByLabelText(/One-time code/i);
}
function fill(code: string | null, password = PASSWORD, confirm = password) {
  if (code !== null) fireEvent.change(screen.getByLabelText(/One-time code/i), { target: { value: code } });
  fireEvent.change(screen.getByLabelText(/^New password/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: confirm } });
}
const submitButton = () => screen.getByRole("button", { name: /Update password securely/i });

describe("new password page", () => {
  it("a malformed link shows the ended state without calling the server", async () => {
    page(<NewPasswordRecoveryPage />, "/auth/recovery/new-password?ref=short");
    expect(await screen.findByText(/can’t be used/i)).toBeTruthy(); expect(calls).toHaveLength(0);
  });
  it("an invitation the server does not know shows the ended state", async () => {
    reply = () => err(404, "INVITATION_UNAVAILABLE");
    page(<NewPasswordRecoveryPage />, `/auth/recovery/new-password?ref=${REF}`);
    expect(await screen.findByText(/can’t be used/i)).toBeTruthy();
  });
  it("submit stays inactive until 8 digits and a matching password of at least 14 characters", async () => {
    reply = c => c.path.startsWith("/invitation") ? { status: 200, body: { publicReference: REF } } : { status: 200, body: {} };
    await openNewPassword();
    fill("1234567"); expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fill(CODE, "short-pass"); expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fill(CODE, PASSWORD, PASSWORD + "x"); expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Passwords do not match/i)).toBeTruthy();
    fill("1234 5678"); expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });
  it("one submit: binds the browser, then sends reference + code + password; shows the signed-out success", async () => {
    reply = c => c.path.startsWith("/invitation") ? { status: 200, body: { publicReference: REF } } : c.path === "/binding" ? { status: 204 } : { status: 200, body: { completed: true } };
    await openNewPassword(); fill(CODE); fireEvent.click(submitButton());
    expect(await screen.findByText(/Password updated/i)).toBeTruthy();
    expect(posts("/binding")).toHaveLength(1); expect(posts("/binding")[0].body).toEqual({ reference: REF });
    expect(posts("/complete")[0].body).toEqual({ reference: REF, newPassword: PASSWORD, code: CODE });
    expect(screen.getByText(/signed out everywhere/i)).toBeTruthy();
  });
  it("wrong code: says so, clears the code, and a retry does not bind the browser again", async () => {
    let n = 0;
    reply = c => c.path.startsWith("/invitation") ? { status: 200, body: { publicReference: REF } } : c.path === "/binding" ? { status: 204 }
      : (n++ === 0 ? err(403, "OTP_INVALID") : { status: 200, body: { completed: true } });
    await openNewPassword(); fill("00000000"); fireEvent.click(submitButton());
    expect(await screen.findByText(/code is not correct/i)).toBeTruthy();
    expect((screen.getByLabelText(/One-time code/i) as HTMLInputElement).value).toBe("");
    fill(CODE); fireEvent.click(submitButton());
    expect(await screen.findByText(/Password updated/i)).toBeTruthy(); expect(posts("/binding")).toHaveLength(1);
  });
  it("refused password: code shown as verified, retry sends only the new password", async () => {
    let n = 0;
    reply = c => c.path.startsWith("/invitation") ? { status: 200, body: { publicReference: REF } } : c.path === "/binding" ? { status: 204 }
      : (n++ === 0 ? err(400, "PASSWORD_BREACHED") : { status: 200, body: { completed: true } });
    await openNewPassword(); fill(CODE); fireEvent.click(submitButton());
    expect(await screen.findByText(/known data breaches/i)).toBeTruthy(); expect(screen.getByText(/Code verified/i)).toBeTruthy();
    fill(null, "Another-Long-Passw0rd"); fireEvent.click(submitButton());
    expect(await screen.findByText(/Password updated/i)).toBeTruthy();
    expect(posts("/complete")[1].body).toEqual({ reference: REF, newPassword: "Another-Long-Passw0rd" }); expect(posts("/binding")).toHaveLength(1);
  });
  it("a reset that can no longer be used ends cleanly and says the password did not change", async () => {
    reply = c => c.path.startsWith("/invitation") ? { status: 200, body: { publicReference: REF } } : c.path === "/binding" ? { status: 204 } : err(409, "RESET_TOKEN_UNAVAILABLE");
    await openNewPassword(); fill(CODE); fireEvent.click(submitButton());
    expect(await screen.findByText(/password has not changed/i)).toBeTruthy();
  });
  it("sends the CSRF header when this browser holds a Login V2 session (shared device)", async () => {
    // jsdom (http) refuses to store a __Host- cookie, as a browser would; the PWA only reads it, so stub the getter.
    const cookie = vi.spyOn(document, "cookie", "get").mockReturnValue("__Host-tcds_csrf=abc123");
    reply = c => c.path.startsWith("/invitation") ? { status: 200, body: { publicReference: REF } } : c.path === "/binding" ? { status: 204 } : { status: 200, body: { completed: true } };
    await openNewPassword(); fill(CODE); fireEvent.click(submitButton());
    await screen.findByText(/Password updated/i);
    expect(posts("/complete")[0].headers.get("X-CSRF-Token")).toBe("abc123");
    cookie.mockRestore();
  });
});

describe("administrator approval", () => {
  const item = { requestId: REQ, expectedRowVersion: "7", employeeDisplayId: "STG-9001", status: "REQUESTED", reasonCode: "FORGOT_PASSWORD", requestedAt: "2026-11-22T10:00:00Z" };
  const adminReply = (approve: () => { status: number; body?: unknown }) => (c: Call) =>
    c.path.startsWith("/admin/pending") ? { status: 200, body: { items: [item], nextCursor: null } }
    : c.path.startsWith("/admin/review") ? { status: 200, body: item }
    : c.path.startsWith("/admin/step-up") ? { status: 200, body: { challengeId: "C1", options: { challenge: "x" }, purpose: "WAREHOUSE_PASSWORD_RESET_APPROVAL", requestId: REQ, rowVersion: "7" } }
    : approve();
  async function openReview() {
    page(<AdminRecoveryPage />); fireEvent.click(await screen.findByRole("button", { name: /Review request/i }));
    return screen.findByRole("button", { name: /Approve with passkey/i });
  }
  it("approve only: no reject / extra-verification choice; needs the identity confirmation; sends the passkey response", async () => {
    reply = adminReply(() => ({ status: 200, body: { status: "TOKEN_ISSUED", deliveryStatus: "PENDING" } }));
    passkey.mockResolvedValue({ id: "cred", response: {} });
    const approve = await openReview();
    expect(screen.queryByText(/Reject request/i)).toBeNull(); expect(screen.queryByText(/additional verification/i)).toBeNull();
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(approve);
    expect(await screen.findByText(/will get a recovery email/i)).toBeTruthy();
    expect(posts("/admin/approve")[0].body).toEqual({ requestId: REQ, expectedRowVersion: "7", decision: "APPROVE_RESET", challengeId: "C1", passkeyResponse: { id: "cred", response: {} } });
  });
  it("explains a missing recovery email", async () => {
    reply = adminReply(() => err(409, "VERIFIED_RECOVERY_DESTINATION_REQUIRED")); passkey.mockResolvedValue({ id: "cred" });
    const approve = await openReview(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(approve);
    expect(await screen.findByText(/no verified recovery email/i)).toBeTruthy();
  });
  it("a cancelled passkey prompt says so and approves nothing", async () => {
    reply = adminReply(() => ({ status: 200, body: {} })); passkey.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
    const approve = await openReview(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(approve);
    expect(await screen.findByText(/passkey check was cancelled/i)).toBeTruthy(); expect(posts("/admin/approve")).toHaveLength(0);
  });
});

describe("other screens", () => {
  it("manager page says the exception is not available and offers no form", () => {
    page(<ManagerRecoveryPage />); expect(screen.getByText(/Not available yet/i)).toBeTruthy(); expect(screen.queryByRole("button", { name: /Submit/i })).toBeNull();
  });
  it("employee request: rate limit gets its own message", async () => {
    reply = () => err(429, "RATE_LIMITED");
    page(<EmployeeRecoveryPage />);
    fireEvent.change(screen.getByLabelText(/Username or employee ID/i), { target: { value: "stg_employee_1" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit request/i }));
    await waitFor(() => expect(screen.getByText(/Too many requests/i)).toBeTruthy());
  });
});
