import { describe, it, expect } from 'vitest';
import { normalizeMac, isMac, isIp } from './netaddr';
import { parseProject } from '../store';
import { itemName, portCount, isDevice } from '../labels';
import type { FurnitureItem } from '../types';

describe('network addresses', () => {
  it('MAC is written with colons in upper case', () => {
    expect(normalizeMac('3c-52-82-1a-2b-3c')).toBe('3C:52:82:1A:2B:3C');
    expect(normalizeMac('3c5282.1a2b3c')).toBe('3C:52:82:1A:2B:3C');
    expect(normalizeMac('  ')).toBeUndefined();
    expect(isMac('3C:52:82:1A:2B:3C')).toBe(true);
    expect(isMac('3C:52:82')).toBe(false);
  });

  it('IP: v4 with prefix, v6, dhcp', () => {
    expect(isIp('192.168.1.20')).toBe(true);
    expect(isIp('10.0.0.5/24')).toBe(true);
    expect(isIp('256.1.1.1')).toBe(false);
    expect(isIp('fe80::1')).toBe(true);
    expect(isIp('DHCP')).toBe(true);
    expect(isIp('abc')).toBe(false);
  });
});

describe('devices', () => {
  const pc: FurnitureItem = { id: 1, path: 'pc-sff', name: 'PC Dell SFF', x: 0, y: 0, w: 29, h: 29, rot: 0, zi: 150 };

  it('a PC has one network port by default, more when added; hostname is its name', () => {
    expect(isDevice(pc)).toBe(true);
    expect(portCount(pc)).toBe(1);
    const two = { ...pc, device: { hostname: 'PC-01', nics: [{ mac: 'AA:BB:CC:DD:EE:FF' }, {}] } };
    expect(portCount(two)).toBe(2);
    expect(itemName(two, 'en')).toBe('PC-01');
    expect(itemName({ ...two, label: 'User 2' }, 'en')).toBe('User 2');
  });

  it('device data survives save / load', () => {
    const it = { ...pc, device: { hostname: 'PC-01', hdmi: 2, dp: 1, nics: [{ mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.5' }, { ip: 'dhcp' }] } };
    const f = parseProject(JSON.stringify({ floors: [{ nodes: [], walls: [], furniture: [it] }], nextId: 5 })).floors[0];
    expect(f.furniture[0].device).toEqual(it.device);
  });
});
