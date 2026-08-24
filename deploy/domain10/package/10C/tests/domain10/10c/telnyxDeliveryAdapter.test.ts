import { adaptExistingTelnyxSender } from "../../../src/domains/operations/delivery/adapters/telnyxDeliveryAdapter";

describe("10C Telnyx adapter",()=>{
  it("requires 2xx and provider-owned message ID without owning sender/profile configuration",async()=>{
    let captured:any;
    const port=adaptExistingTelnyxSender({
      sendOperationalMessage:async(message)=>{
        captured=message;
        return {httpStatus:200,messageId:"msg-1",status:"queued"};
      }
    });

    const r=await port.sendOnce({
      to:"+15710000001",text:"TCDS test",
      eventId:"e",notificationId:"n",deliveryId:"d",attemptId:"a",correlationId:"c"
    });

    expect(captured.to).toBe("+15710000001");
    expect(captured.from).toBeUndefined();
    expect(captured.messagingProfileId).toBeUndefined();
    expect(r.providerMessageId).toBe("msg-1");
  });

  it("preserves explicit provider throttling semantics",async()=>{
    const err:any=new Error("rate limit");
    err.failure="THROTTLED";
    err.retryable=true;
    err.ambiguousOutcome=false;
    err.httpStatus=429;
    err.retryAfterMs=5000;

    const port=adaptExistingTelnyxSender({
      sendOperationalMessage:async()=>{throw err;}
    });

    await expect(port.sendOnce({
      to:"+15710000001",text:"TCDS test",
      eventId:"e",notificationId:"n",deliveryId:"d",attemptId:"a",correlationId:"c"
    })).rejects.toMatchObject({
      failureClass:"THROTTLED",retryable:true,ambiguousOutcome:false,retryAfterMs:5000
    });
  });
});
