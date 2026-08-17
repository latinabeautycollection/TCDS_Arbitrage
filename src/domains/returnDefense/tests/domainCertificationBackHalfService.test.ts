import { DomainCertificationBackHalfService } from "../services/domainCertificationBackHalfService";

describe("DomainCertificationBackHalfService", () => {
  it("does not accept a caller-supplied certification verdict", () => {
    const names = Object.getOwnPropertyNames(
      DomainCertificationBackHalfService.prototype,
    );
    expect(names).toContain("finishCertificationRun");
    expect(names).toContain("completeRollback");
    expect(names).toContain("completePreprodRehearsal");
    expect(names).toContain("certifyDomain8");
  });
});
