import { UspsClient } from './uspsClient';

const USPS_LABELS_PATH = process.env.USPS_LABELS_PATH || '/labels/v3/label';

export class UspsLabelsService {
  constructor(private readonly client = new UspsClient()) {}

  public async createLabel(payload: unknown): Promise<unknown> {
    return this.client.post<unknown>(USPS_LABELS_PATH, payload);
  }
}
