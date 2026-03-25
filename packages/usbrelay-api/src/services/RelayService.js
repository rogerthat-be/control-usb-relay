import { UsbRelay, findDevices } from "@usb-relay/lib";

function createSnapshot(relay) {
  return {
    connected: true,
    relayCount: relay.getRelayNumber(),
    serial: relay.getSerial(),
    state: relay.getState(),
    stateMask: relay.getStateMask(),
  };
}

export class RelayService {
  constructor({ relayCount }) {
    this.relayCount = relayCount;
    this.relay = null;
    this.queue = Promise.resolve();
  }

  getDeviceSummary() {
    const devices = findDevices();
    return {
      count: devices.length,
      devices: devices.map((device) => ({
        product: device.product || "USB Relay",
        vendorId: device.vendorId ?? device.deviceDescriptor?.idVendor ?? null,
        productId: device.productId ?? device.deviceDescriptor?.idProduct ?? null,
        serialNumber: device.serialNumber || null,
      })),
    };
  }

  async connect(forceReconnect = false) {
    if (forceReconnect) {
      await this.disconnect();
    }

    if (this.relay) {
      return createSnapshot(this.relay);
    }

    const relay = new UsbRelay(this.relayCount);
    await relay.open();
    await relay.initBoard();
    this.relay = relay;

    return createSnapshot(this.relay);
  }

  async disconnect() {
    if (!this.relay) {
      return { connected: false };
    }

    const activeRelay = this.relay;
    this.relay = null;
    await activeRelay.close();
    return { connected: false };
  }

  async getState() {
    return this._run(async (relay) => {
      await relay.initBoard();
      return createSnapshot(relay);
    });
  }

  async setRelay(relayNumber, enabled) {
    return this._run(async (relay) => {
      if (enabled) {
        await relay.relayOn(relayNumber);
      } else {
        await relay.relayOff(relayNumber);
      }
      return createSnapshot(relay);
    });
  }

  async setAll(enabled) {
    return this._run(async (relay) => {
      if (enabled) {
        await relay.allOn();
      } else {
        await relay.allOff();
      }
      return createSnapshot(relay);
    });
  }

  async setState(payload) {
    return this._run(async (relay) => {
      await relay.setState(payload);
      return createSnapshot(relay);
    });
  }

  async _ensureConnected() {
    if (this.relay) {
      return this.relay;
    }

    await this.connect();
    return this.relay;
  }

  async _run(handler) {
    const next = this.queue.then(async () => {
      const relay = await this._ensureConnected();
      return handler(relay);
    });

    this.queue = next.catch(() => undefined);
    return next;
  }
}