import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Explicit local CLI configuration, never accepted from the participant/API.
// Does not expose this package directory through the replay HTTP allowlist.
export async function loadAutomation(repo, externalRoot) {
  if (externalRoot !== undefined && !path.isAbsolute(externalRoot)) throw new Error('invalid_reference_automation_root');
  const root = await fs.realpath(externalRoot ?? path.join(repo, 'apps/autotests'));
  const require = createRequire(path.join(root, 'package.json'));
  const metadata = require('playwright/package.json');
  if (metadata.name !== 'playwright' || metadata.license !== 'Apache-2.0'
    || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(metadata.version)) throw new Error('invalid_reference_automation_package');
  return { engines: require('playwright'), version: metadata.version };
}
