import path from 'node:path';
import { ensureDir, readJsonIfExists, writeJson } from '../shared/config.js';

const DEFAULT_STATE = {
  devices: [],
};

export class DeviceRegistry {
  constructor(filePath = 'data/gateway/devices.json') {
    this.filePath = path.resolve(process.cwd(), filePath);
    ensureDir(path.dirname(this.filePath));
    this.state = this.#load();
  }

  list() {
    return [...this.state.devices]
      .map((device) => ({ ...device }))
      .sort((left, right) => Number(right.lastSeenAt || right.createdAt || 0) - Number(left.lastSeenAt || left.createdAt || 0));
  }

  get(deviceId) {
    return this.state.devices.find((device) => device.deviceId === `${deviceId || ''}`.trim()) || null;
  }

  upsert({ deviceId, deviceName, authMethod, trustedIdentity = '', lastIp = '', lastUserAgent = '' }) {
    const normalizedDeviceId = `${deviceId || ''}`.trim();
    if (!normalizedDeviceId) {
      throw new Error('deviceId is required');
    }

    const now = Date.now();
    const existing = this.get(normalizedDeviceId);
    if (existing) {
      existing.deviceName = `${deviceName || existing.deviceName || normalizedDeviceId}`.trim();
      existing.authMethod = `${authMethod || existing.authMethod || 'unknown'}`.trim();
      existing.trustedIdentity = `${trustedIdentity || existing.trustedIdentity || ''}`.trim();
      existing.lastSeenAt = now;
      existing.lastIp = `${lastIp || existing.lastIp || ''}`.trim();
      existing.lastUserAgent = `${lastUserAgent || existing.lastUserAgent || ''}`.trim();
      existing.revokedAt = null;
      this.#save();
      return { ...existing };
    }

    const created = {
      deviceId: normalizedDeviceId,
      deviceName: `${deviceName || normalizedDeviceId}`.trim(),
      authMethod: `${authMethod || 'unknown'}`.trim(),
      trustedIdentity: `${trustedIdentity || ''}`.trim(),
      createdAt: now,
      lastSeenAt: now,
      lastIp: `${lastIp || ''}`.trim(),
      lastUserAgent: `${lastUserAgent || ''}`.trim(),
      revokedAt: null,
      refreshTokenHash: '',
      refreshExpiresAt: 0,
      refreshIssuedAt: 0,
    };
    this.state.devices.push(created);
    this.#save();
    return { ...created };
  }

  updateRefresh(deviceId, refreshTokenHash, refreshExpiresAt) {
    const device = this.get(deviceId);
    if (!device) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    device.refreshTokenHash = `${refreshTokenHash || ''}`.trim();
    device.refreshExpiresAt = Number(refreshExpiresAt || 0);
    device.refreshIssuedAt = Date.now();
    device.lastSeenAt = Date.now();
    this.#save();
    return { ...device };
  }

  clearRefresh(deviceId) {
    const device = this.get(deviceId);
    if (!device) {
      return null;
    }

    device.refreshTokenHash = '';
    device.refreshExpiresAt = 0;
    device.refreshIssuedAt = 0;
    device.lastSeenAt = Date.now();
    this.#save();
    return { ...device };
  }

  revoke(deviceId) {
    const device = this.get(deviceId);
    if (!device) {
      return null;
    }

    device.revokedAt = Date.now();
    device.refreshTokenHash = '';
    device.refreshExpiresAt = 0;
    device.refreshIssuedAt = 0;
    this.#save();
    return { ...device };
  }

  touch(deviceId, { lastIp = '', lastUserAgent = '' } = {}) {
    const device = this.get(deviceId);
    if (!device) {
      return null;
    }

    device.lastSeenAt = Date.now();
    if (lastIp) {
      device.lastIp = `${lastIp}`.trim();
    }
    if (lastUserAgent) {
      device.lastUserAgent = `${lastUserAgent}`.trim();
    }
    this.#save();
    return { ...device };
  }

  #load() {
    const raw = readJsonIfExists(this.filePath, DEFAULT_STATE);
    return {
      devices: Array.isArray(raw?.devices)
        ? raw.devices
            .map((device) => normalizeDevice(device))
            .filter((device) => device.deviceId)
        : [],
    };
  }

  #save() {
    writeJson(this.filePath, this.state);
  }
}

function normalizeDevice(device) {
  return {
    deviceId: `${device?.deviceId || ''}`.trim(),
    deviceName: `${device?.deviceName || ''}`.trim(),
    authMethod: `${device?.authMethod || ''}`.trim(),
    trustedIdentity: `${device?.trustedIdentity || ''}`.trim(),
    createdAt: Number(device?.createdAt || 0),
    lastSeenAt: Number(device?.lastSeenAt || 0),
    lastIp: `${device?.lastIp || ''}`.trim(),
    lastUserAgent: `${device?.lastUserAgent || ''}`.trim(),
    revokedAt: device?.revokedAt ? Number(device.revokedAt) : null,
    refreshTokenHash: `${device?.refreshTokenHash || ''}`.trim(),
    refreshExpiresAt: Number(device?.refreshExpiresAt || 0),
    refreshIssuedAt: Number(device?.refreshIssuedAt || 0),
  };
}
