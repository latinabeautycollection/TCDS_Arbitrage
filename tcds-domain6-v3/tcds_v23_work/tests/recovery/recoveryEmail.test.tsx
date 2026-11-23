// Recovery email screen (TCDS 645) against the Login V2 /api/v1/auth/recovery-email contract.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/components/AppHeader", () => ({ AppHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../../src/features/auth/storage/deviceCredentialStore", () => ({ deviceCredentialStore: { secrets: async () => null } }));
import { RecoveryEmailScreen } from "../../src/features/auth/recovery/RecoveryEmailScreen";

type Call = { path: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: { active: null, pending: null } });
const NONE = { active: null, pending: null };
const ACTIVE = { active: { email: "r•••@gmail.com", since: "2026-11-20T10:00:00Z" }, pending: null };
const PENDING = (status: string, extra = {}) => ({ email: "n•••@example.test", status, requestedAt: "2026-11-23T08:00:00Z", expiresAt: "2026-11-30T08:00:00Z", approvals: 0, required: 1, ...extra });
const err = (status: number, code: string) => ({ status, body: { error: { code } } });

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const c: Call = { path: String(url).replace(/^.*\/recovery-email/, ""), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c); const r = reply(c);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const open = () => render(<MemoryRouter><RecoveryEmailScreen /></MemoryRouter>);
const posts = (p: string) => calls.filter(c => c.method === "POST" && c.path === p);

describe("recovery email screen", () => {
  it("no email yet: explains why, offers the form; Send code stays inactive until an address is typed", async () => {
    reply = () => ({ status: 200, body: NONE });
    open(); expect(await screen.findByText(/No recovery email yet/i)).toBeTruthy();
    const send = screen.getByRole("button", { name: /Send code/i }) as HTMLButtonElement; expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Recovery email/i), { target: { value: "me@example.test" } }); expect(send.disabled).toBe(false);
  });
  it("send code -> code step with the masked address; a wrong code says so and clears the field; the right code -> waiting for approval", async () => {
    let n = 0;
    reply = c => c.method === "GET" ? { status: 200, body: NONE }
      : c.path === "" ? { status: 202, body: { active: null, pending: PENDING("AWAITING_CODE") } }
      : (n++ === 0 ? err(403, "RECOVERY_CODE_INVALID") : { status: 200, body: { active: null, pending: PENDING("AWAITING_APPROVAL") } });
    open(); await screen.findByText(/No recovery email yet/i);
    fireEvent.change(screen.getByLabelText(/Recovery email/i), { target: { value: " me@example.test " } });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));
    expect(await screen.findByText(/Check your email/i)).toBeTruthy(); expect(screen.getByText("n•••@example.test")).toBeTruthy();
    expect(posts("")[0].body).toEqual({ email: "me@example.test" });
    const confirm = screen.getByRole("button", { name: /Confirm code/i }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Confirmation code/i), { target: { value: "1234567" } }); expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Confirmation code/i), { target: { value: "0000 0000" } }); fireEvent.click(confirm);
    expect(await screen.findByText(/code is not correct/i)).toBeTruthy();
    expect((screen.getByLabelText(/Confirmation code/i) as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText(/Confirmation code/i), { target: { value: "12345678" } }); fireEvent.click(confirm);
    expect(await screen.findByText(/Waiting for approval/i)).toBeTruthy(); expect(posts("/verify")[1].body).toEqual({ code: "12345678" });
    expect(screen.getByText(/cannot be used for a password reset/i)).toBeTruthy();
  });
  it("active email: shown masked; changing it keeps the old one until the new one is approved", async () => {
    reply = c => c.method === "GET" ? { status: 200, body: ACTIVE } : { status: 200, body: { ...ACTIVE, pending: PENDING("AWAITING_APPROVAL") } };
    open(); expect(await screen.findByText("r•••@gmail.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send code/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Change recovery email/i }));
    expect(screen.getByLabelText(/New recovery email/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keep r•••@gmail.com/i })).toBeTruthy();
  });
  it("waiting for approval with an active email says the old address stays in use; cancel works", async () => {
    let cancelled = false;
    reply = c => c.method === "GET" ? { status: 200, body: { ...ACTIVE, pending: PENDING("AWAITING_APPROVAL") } }
      : c.path === "/cancel" ? (cancelled = true, { status: 200, body: ACTIVE }) : { status: 200, body: ACTIVE };
    open(); expect(await screen.findByText(/r•••@gmail.com stays your recovery email/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cancel request/i }));
    expect(await screen.findByText(/Request cancelled/i)).toBeTruthy(); expect(cancelled).toBe(true);
  });
  it("server refusals get clear messages (too many attempts, already active)", async () => {
    let which = "RECOVERY_CONTACT_TOO_MANY_ATTEMPTS";
    reply = c => c.method === "GET" ? { status: 200, body: NONE } : err(429, which);
    open(); await screen.findByText(/No recovery email yet/i);
    fireEvent.change(screen.getByLabelText(/Recovery email/i), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Send code/i }));
    expect(await screen.findByText(/too many times today/i)).toBeTruthy();
    which = "RECOVERY_CONTACT_ALREADY_ACTIVE"; fireEvent.click(screen.getByRole("button", { name: /Send code/i }));
    expect(await screen.findByText(/already your recovery email/i)).toBeTruthy();
  });
  it("load failure offers Try again", async () => {
    reply = () => err(503, "RECOVERY_DEPENDENCY_UNAVAILABLE");
    open(); expect(await screen.findByRole("button", { name: /Try again/i })).toBeTruthy();
  });
});
