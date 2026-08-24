import { renderBoundTemplate } from "../../../src/domains/operations/services/templateRenderingService";

describe("templateRenderingService",()=>{
  it("escapes dynamic HTML",()=>{
    const binding:any={
      channel:"EMAIL",templateId:"t",templateVersion:1,templateKey:"T",
      textTemplate:"Hi {{recipient.display_name}}",htmlTemplate:"<p>{{payload.summary}}</p>",
      contentHash:"h",allowedVariablePaths:["recipient.display_name","payload.summary"],
      requiredVariablePaths:["payload.summary"]
    };
    const event:any={eventId:"e",eventType:"X",severity:"NOTICE",classification:"INTERNAL",
      occurredAt:new Date().toISOString(),decisionBasisAt:new Date().toISOString(),
      correlationId:"c",payload:{summary:"<script>x</script>"}};
    const recipient:any={displayName:"A",recipientId:"r",audienceKey:"OPS",emailAuthorized:true,
      smsAuthorized:false,authorizationSnapshot:{}};
    const out=renderBoundTemplate(binding,event,recipient);
    expect(out.htmlBody).toContain("&lt;script&gt;");
  });

  it("rejects a variable outside the frozen allowlist",()=>{
    const binding:any={
      channel:"EMAIL",templateId:"t",templateVersion:1,templateKey:"T",
      textTemplate:"{{payload.secret}}",contentHash:"h",
      allowedVariablePaths:["payload.summary"],requiredVariablePaths:[]
    };
    const event:any={eventId:"e",eventType:"X",severity:"NOTICE",classification:"INTERNAL",
      occurredAt:new Date().toISOString(),decisionBasisAt:new Date().toISOString(),
      correlationId:"c",payload:{secret:"x"}};
    const recipient:any={displayName:"A",recipientId:"r",audienceKey:"OPS",emailAuthorized:true,
      smsAuthorized:false,authorizationSnapshot:{}};
    expect(()=>renderBoundTemplate(binding,event,recipient)).toThrow(/unauthorized variable path/i);
  });
});
