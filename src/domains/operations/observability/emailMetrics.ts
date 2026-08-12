import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const emailRegistry = new Registry();
export const emailRequests = new Counter({ name:"domain10_email_requests_total", help:"Email requests", registers:[emailRegistry] });
export const emailAccepted = new Counter({ name:"domain10_email_accepted_total", help:"Provider accepted", registers:[emailRegistry] });
export const emailFailed = new Counter({ name:"domain10_email_failed_total", help:"Failed email attempts", labelNames:["failure"], registers:[emailRegistry] });
export const emailRetries = new Counter({ name:"domain10_email_retry_total", help:"Retry transitions", registers:[emailRegistry] });
export const emailThrottled = new Counter({ name:"domain10_email_throttled_total", help:"Graph throttles", registers:[emailRegistry] });
export const emailTimeouts = new Counter({ name:"domain10_email_timeout_total", help:"Timeouts", registers:[emailRegistry] });
export const emailDeadLetters = new Counter({ name:"domain10_email_dead_letter_total", help:"Dead letters", registers:[emailRegistry] });
export const emailLatency = new Histogram({ name:"domain10_email_send_latency_seconds", help:"Graph send latency", buckets:[0.1,0.25,0.5,1,2,5,10,20], registers:[emailRegistry] });
export const emailQueueDepth = new Gauge({ name:"domain10_email_queue_depth", help:"Ready outbox items", registers:[emailRegistry] });
export const emailOldestPending = new Gauge({ name:"domain10_email_oldest_pending_seconds", help:"Oldest pending age", registers:[emailRegistry] });
export const emailProviderHealth = new Gauge({ name:"domain10_email_provider_health", help:"1 healthy, 0 unhealthy", registers:[emailRegistry] });
