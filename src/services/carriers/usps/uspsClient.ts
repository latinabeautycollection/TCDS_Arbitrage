import axios, { AxiosInstance } from 'axios';
import pRetry from 'p-retry';
import { loadUspsConfig } from './uspsConfig';
import { UspsAuthService } from './uspsAuth.service';

export class UspsClient {
  private readonly client: AxiosInstance;

  constructor(private readonly authService = new UspsAuthService()) {
    const config = loadUspsConfig();

    this.client = axios.create({
      baseURL: config.USPS_BASE_URL,
      timeout: config.USPS_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });
  }

  public async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, undefined, params);
  }

  public async post<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>('POST', path, data);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
    params?: Record<string, unknown>
  ): Promise<T> {
    return pRetry(
      async () => {
        const token = await this.authService.getAccessToken();

        const response = await this.client.request<T>({
          method,
          url: path,
          data,
          params,
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        return response.data;
      },
      {
        retries: 2,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 3000,
        onFailedAttempt: error => {
          console.warn(
            `USPS API attempt ${error.attemptNumber} failed. Retries left: ${error.retriesLeft}`
          );
        }
      }
    );
  }
}
