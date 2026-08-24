import { adaptExistingMicrosoftGraphSender } from "../../../src/domains/operations/delivery/adapters/microsoftGraphDeliveryAdapter";

describe("10C Microsoft Graph adapter",()=>{
  it("maps to the current production GraphSendRequest contract and accepts exactly 202",async()=>{
    let captured:any;
    const port=adaptExistingMicrosoftGraphSender({
      send:async(req)=>{
        captured=req;
        return {
          accepted:true as const,
          httpStatus:202 as const,
          providerRequestId:"req-1",
          providerClientRequestId:"client-1"
        };
      }
    });

    const r=await port.sendOnce({
      to:"employee@tcdsolutionsgroup.com",
      subject:"Test",
      textBody:"Test",
      eventId:"e",notificationId:"n",deliveryId:"d",attemptId:"a",correlationId:"c",
      importance:"high"
    });

    expect(captured.to).toEqual([{address:"employee@tcdsolutionsgroup.com"}]);
    expect(captured.importance).toBe("high");
    expect(typeof captured.htmlBody).toBe("string");
    expect(r.httpStatus).toBe(202);
  });

  it("preserves explicit 429 Retry-After semantics from the existing provider",async()=>{
    const err:any=new Error("throttled");
    err.failure="THROTTLED";
    err.retryable=true;
    err.ambiguousOutcome=false;
    err.httpStatus=429;
    err.retryAfterMs=17000;

    const port=adaptExistingMicrosoftGraphSender({
      send:async()=>{throw err;}
    });

    await expect(port.sendOnce({
      to:"employee@tcdsolutionsgroup.com",
      subject:"Test",textBody:"Test",
      eventId:"e",notificationId:"n",deliveryId:"d",attemptId:"a",correlationId:"c",
      importance:"normal"
    })).rejects.toMatchObject({
      failureClass:"THROTTLED",
      retryable:true,
      ambiguousOutcome:false,
      retryAfterMs:17000
    });
  });

  it("quarantines an unknown provider exception as ambiguous",async()=>{
    const port=adaptExistingMicrosoftGraphSender({
      send:async()=>{throw new TypeError("connection reset");}
    });

    await expect(port.sendOnce({
      to:"employee@tcdsolutionsgroup.com",
      subject:"Test",textBody:"Test",
      eventId:"e",notificationId:"n",deliveryId:"d",attemptId:"a",correlationId:"c",
      importance:"normal"
    })).rejects.toMatchObject({
      failureClass:"UNKNOWN",
      retryable:false,
      ambiguousOutcome:true
    });
  });
});
