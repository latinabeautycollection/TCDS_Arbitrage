import axios from 'axios';
import { loadUspsConfig } from './uspsConfig';

interface TokenState {
  accessToken: string;
  expiresAtMs: number;
}

export class UspsAuthService {
  private tokenState: TokenState | null = null;

  public async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.tokenState && this.tokenState.expiresAtMs > now + 60_000) {
      return this.tokenState.accessToken;
    }

    const config = loadUspsConfig();

    const response = await axios.post(
      config.USPS_OAUTH_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.USPS_CLIENT_ID,
        client_secret: config.USPS_CLIENT_SECRET
      }),
      {
        timeout: config.USPS_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        }
      }
    );

    const accessToken = response.data?.access_token;
    const expiresIn = Number(response.data?.expires_in ?? 3600);

    if (!accessToken) {
      throw new Error('USPS OAuth response did not include access_token.');
    }

    this.tokenState = {
      accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000
    };

    return accessToken;
  }
}
