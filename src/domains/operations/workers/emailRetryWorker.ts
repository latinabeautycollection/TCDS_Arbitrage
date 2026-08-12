import { runEmailDeliveryBatch } from "./emailDeliveryWorker";
export async function runRetryWorker(){ return runEmailDeliveryBatch(); }
