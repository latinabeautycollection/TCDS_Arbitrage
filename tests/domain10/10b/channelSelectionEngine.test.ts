import { selectChannels } from "../../../src/domains/operations/engines/channelSelectionEngine";

describe("channelSelectionEngine", () => {
  it("requires active SMS subscription while allowing authorized email", () => {
    const policy:any={emailEnabled:true,smsEnabled:true};
    const r=selectChannels(policy,[{
      recipientId:"1",displayName:"A",emailAddress:"a@example.com",mobileE164:"+15710000001",
      audienceKey:"OPS",emailAuthorized:true,smsAuthorized:true,smsSubscriptionStatus:"UNSUBSCRIBED",
      authorizationSnapshot:{}
    }]);
    expect(r[0]?.emailSelected).toBe(true);
    expect(r[0]?.smsSelected).toBe(false);
    expect(r[0]?.reasons).toContain("SMS_NOT_SUBSCRIBED");
  });
});
