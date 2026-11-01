import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/features/inventory/hooks/useInventory", () => ({
  useInventory: () => ({ data: null, loading: false, refreshing: false, error: null, refresh: vi.fn() }),
}));
vi.mock("../../src/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("../../src/components/scanning/workflow/WorkflowScanPanel", () => ({
  WorkflowScanPanel: () => <button type="button">Scan with camera</button>,
}));

import { InventoryListScreen } from "../../src/features/inventory/InventoryListScreen";

const renderScreen = () => render(<MemoryRouter><InventoryListScreen /></MemoryRouter>);

afterEach(() => vi.unstubAllEnvs());

describe("6.2D Inventory screen wiring", () => {
  it("shows no camera scanning while the flag is off", () => {
    vi.stubEnv("VITE_SCANDIT_WORKFLOW_INVENTORY", "false");
    renderScreen();

    expect(screen.queryByRole("button", { name: "Scan with camera" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy();
  });

  it("adds camera scanning beside the typed entry when the flag is on", () => {
    vi.stubEnv("VITE_SCANDIT_WORKFLOW_INVENTORY", "true");
    renderScreen();

    expect(screen.getByRole("button", { name: "Scan with camera" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy();
  });
});
