import { UspsClient } from './uspsClient';

const USPS_TRACKING_PATH = process.env.USPS_TRACKING_PATH || '/tracking/v3/tracking';

export class UspsTrackingService {
  constructor(private readonly client = new UspsClient()) {}

  public async track(trackingNumber: string): Promise<unknown> {
    return this.client.get<unknown>(`${USPS_TRACKING_PATH}/${encodeURIComponent(trackingNumber)}`);
  }
}
