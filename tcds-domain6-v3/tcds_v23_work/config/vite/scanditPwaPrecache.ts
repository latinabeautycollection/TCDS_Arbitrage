import fs from 'node:fs';
import path from 'node:path';

export interface ScanditPrecacheEntry {
  url: string;
  revision: string;
}

interface RuntimeManifest {
  provider: string;
  sdkVersion: string;
  files: Array<{ path: string; sha256: string; bytes?: number }>;
}

/**
 * Returns Workbox additionalManifestEntries for the exact certified Scandit runtime.
 * Import this helper from the production vite.config.ts and merge the returned
 * entries into VitePWA({ workbox: { additionalManifestEntries: ... } }).
 */
export function createScanditPrecacheEntries(
  projectRoot = process.cwd(),
): ScanditPrecacheEntry[] {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };

  const version = packageJson.dependencies?.['@scandit/web-datacapture-core'];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Exact @scandit/web-datacapture-core version is required.');
  }

  const runtimeRoot = path.join(projectRoot, 'public', 'scandit', version);
  const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Scandit runtime manifest missing: ${path.relative(projectRoot, manifestPath)}`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
  if (manifest.sdkVersion !== version) {
    throw new Error(
      `Scandit runtime manifest mismatch: package=${version}, manifest=${manifest.sdkVersion}`,
    );
  }

  const entries: ScanditPrecacheEntry[] = manifest.files.map((file) => ({
    url: `/scandit/${version}/sdc-lib/${file.path.replace(/^\/+/, '')}`,
    revision: file.sha256,
  }));

  entries.push({
    url: `/scandit/${version}/runtime-manifest.json`,
    revision: manifest.files
      .map((file) => file.sha256)
      .sort()
      .join(':'),
  });

  return entries;
}

export const SCANDIT_MAXIMUM_FILE_SIZE_TO_CACHE_BYTES = 10 * 1024 * 1024;
