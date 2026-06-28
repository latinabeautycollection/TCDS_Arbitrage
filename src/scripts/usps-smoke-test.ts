import 'dotenv/config';
import { UspsAuthService } from '../services/carriers/usps/uspsAuth.service';

async function main() {
  const auth = new UspsAuthService();
  const token = await auth.getAccessToken();

  if (!token || token.length < 20) {
    throw new Error('USPS token failed validation.');
  }

  console.log('USPS OAuth smoke test PASSED.');
}

main().catch(error => {
  console.error('USPS OAuth smoke test FAILED.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
