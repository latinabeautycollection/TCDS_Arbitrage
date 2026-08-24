jest.mock("../../../src/domains/operations/domain10Certification/config/certificationEnv",()=>({
  domain10CertificationEnv:()=>({DOMAIN10_CERTIFICATION_MAX_WINDOW_DAYS:7,DOMAIN10_CERTIFICATION_DEFAULT_PROFILE:"DOMAIN10_ENTERPRISE_RELEASE"})
}));
import { validateStartCertificationRequest } from "../../../src/domains/operations/domain10Certification/validators/certificationRequestValidator";

describe("10F certification request",()=>{
  it("rejects an oversized evidence window",()=>{
    expect(()=>validateStartCertificationRequest({
      profileKey:"DOMAIN10_ENTERPRISE_RELEASE",profileVersion:1,releaseKey:"r1",
      gitCommitSha:"a".repeat(40),environment:"CERTIFICATION",
      windowStart:"2026-08-01T00:00:00.000Z",windowEnd:"2026-08-10T00:00:00.000Z",
      requestedBy:"qa",requestId:"00000000-0000-4000-8000-000000000001"
    })).toThrow(/window/i);
  });
});
