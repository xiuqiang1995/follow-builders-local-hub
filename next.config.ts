import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

function getAllowedDevOrigins() {
  const hosts = new Set(['127.0.0.1', 'localhost']);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        hosts.add(address.address);
      }
    }
  }

  for (const value of process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? []) {
    const host = value.trim();
    if (host) {
      hosts.add(host);
    }
  }

  return Array.from(hosts);
}

const nextConfig: NextConfig = {
  // Keep client hydration working when dev is opened via 127.0.0.1 or a LAN IP.
  allowedDevOrigins: getAllowedDevOrigins()
};

export default nextConfig;
