import type { ChannelSelection,PolicyCandidate,RecipientResolution } from "../models/decisionTypes";

export function selectChannels(
  policy:PolicyCandidate,
  recipients:RecipientResolution[]
):ChannelSelection[]{
  const result:ChannelSelection[]=[];

  for(const r of recipients){
    const reasons:string[]=[];
    let emailSelected=false;
    let smsSelected=false;

    if(policy.emailEnabled){
      if(!r.emailAddress) reasons.push("EMAIL_NO_ADDRESS");
      else if(!r.emailAuthorized) reasons.push("EMAIL_NOT_AUTHORIZED");
      else emailSelected=true;
    }

    if(policy.smsEnabled){
      if(!r.mobileE164) reasons.push("SMS_NO_MOBILE");
      else if(!r.smsAuthorized) reasons.push("SMS_NOT_AUTHORIZED");
      else if(r.smsSubscriptionStatus!=="SUBSCRIBED") reasons.push("SMS_NOT_SUBSCRIBED");
      else smsSelected=true;
    }

    if(emailSelected || smsSelected){
      result.push({recipient:r,emailSelected,smsSelected,reasons});
    }
  }

  return result;
}
