import type { NetworkProfile } from './types';

let profiles: NetworkProfile[] = [
  {
    id: 'direct',
    name: 'Direct Connection',
    mode: 'direct',
    enabled: true,
  },
];

export function getNetworkProfiles(): NetworkProfile[] {
  return [...profiles];
}

export function getNetworkProfile(id: string): NetworkProfile | undefined {
  return profiles.find(p => p.id === id);
}

export function upsertNetworkProfile(profile: NetworkProfile): NetworkProfile {
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  return profile;
}

export function deleteNetworkProfile(id: string): boolean {
  const idx = profiles.findIndex(p => p.id === id);
  if (idx < 0) return false;
  profiles.splice(idx, 1);
  return true;
}

export async function verifyDirectIp(verifyUrl?: string): Promise<{ ip: string; source: string }> {
  const url = verifyUrl || 'https://api.ipify.org?format=json';
  try {
    const resp = await fetch(url);
    const data = await resp.json() as any;
    return { ip: data.ip || 'unknown', source: 'direct' };
  } catch {
    return { ip: 'unknown', source: 'direct-error' };
  }
}
