import { ShippingAddress } from '../common/carrierTypes';
import { UspsClient } from './uspsClient';

const USPS_ADDRESS_PATH = process.env.USPS_ADDRESS_PATH || '/addresses/v3/address';

export class UspsAddressService {
  constructor(private readonly client = new UspsClient()) {}

  public async validateAddress(address: ShippingAddress): Promise<unknown> {
    return this.client.get<unknown>(USPS_ADDRESS_PATH, {
      streetAddress: address.street1,
      secondaryAddress: address.street2,
      city: address.city,
      state: address.state,
      ZIPCode: address.postalCode
    });
  }
}
