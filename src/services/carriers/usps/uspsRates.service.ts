import { RateQuote, RateQuoteRequest } from '../common/carrierTypes';
import { UspsClient } from './uspsClient';

/**
 * USPS endpoint paths can vary by approved API product.
 * Keep path configurable so production access can be wired without code rewrite.
 */
const USPS_RATES_PATH = process.env.USPS_RATES_PATH || '/prices/v3/base-rates/search';

export class UspsRatesService {
  constructor(private readonly client = new UspsClient()) {}

  public async getRates(input: RateQuoteRequest): Promise<RateQuote[]> {
    const raw = await this.client.post<unknown>(USPS_RATES_PATH, input);

    return [
      {
        carrier: 'USPS',
        serviceCode: 'USPS_RATE_RESPONSE',
        serviceName: 'USPS Rate Response',
        totalCost: 0,
        currency: 'USD',
        raw
      }
    ];
  }
}
