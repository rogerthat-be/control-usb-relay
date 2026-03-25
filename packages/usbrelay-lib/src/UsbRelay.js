import usb from "usb";
import HID from "node-hid";

export const VENDOR_ID = 0x16c0;
export const PRODUCT_ID = 0x05df;

const CMD_ON = 0xff;
const CMD_OFF = 0xfd;

function toUsbId(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 16);
  return Number.NaN;
}

export class UsbRelay {
  /**
   * @param {number} relayNumber Number of relays exposed by the board.
   */
  constructor(relayNumber = 8) {
    this.relayNumber = relayNumber;
    this._device = null;
    this._iface = null;
    this._backend = null;
    this._stateMask = 0;
    this._serial = "";
  }

  async open() {
    const preferHid = process.platform === "darwin";
    if (preferHid) {
      await this._openWithHid();
      return;
    }

    try {
      await this._openWithUsb();
    } catch (err) {
      if (!this._shouldFallbackToHid(err)) {
        throw err;
      }
      await this._openWithHid(err);
    }
  }

  close() {
    return new Promise((resolve) => {
      if (this._backend === "hid") {
        try {
          this._device?.close();
        } catch {
          // Ignore close errors during shutdown
        }
        this._device = null;
        this._iface = null;
        this._backend = null;
        resolve();
        return;
      }

      if (!this._iface) {
        resolve();
        return;
      }

      this._iface.release(() => {
        try {
          this._device.close();
        } catch {
          // Ignore close errors during shutdown
        }
        this._device = null;
        this._iface = null;
        this._backend = null;
        resolve();
      });
    });
  }

  async initBoard() {
    await this._syncState();
    return this.relayNumber;
  }

  async setState(relays) {
    const newMask = this._toMask(relays);
    for (let index = 0; index < this.relayNumber; index += 1) {
      const bit = 1 << index;
      const wantOn = (newMask & bit) !== 0;
      const isOn = (this._stateMask & bit) !== 0;
      if (wantOn !== isOn) {
        await this._sendCommand(wantOn ? CMD_ON : CMD_OFF, index + 1);
      }
    }
    this._stateMask = newMask;
  }

  async relayOn(relayNumber) {
    this._assertRelayNum(relayNumber);
    await this._sendCommand(CMD_ON, relayNumber);
    this._stateMask |= 1 << (relayNumber - 1);
  }

  async relayOff(relayNumber) {
    this._assertRelayNum(relayNumber);
    await this._sendCommand(CMD_OFF, relayNumber);
    this._stateMask &= ~(1 << (relayNumber - 1));
  }

  async allOn() {
    for (let relayNumber = 1; relayNumber <= this.relayNumber; relayNumber += 1) {
      await this._sendCommand(CMD_ON, relayNumber);
    }
    this._stateMask = (1 << this.relayNumber) - 1;
  }

  async allOff() {
    for (let relayNumber = 1; relayNumber <= this.relayNumber; relayNumber += 1) {
      await this._sendCommand(CMD_OFF, relayNumber);
    }
    this._stateMask = 0;
  }

  getState() {
    const state = {};
    for (let index = 0; index < this.relayNumber; index += 1) {
      state[`K${index + 1}`] = Boolean(this._stateMask & (1 << index));
    }
    return state;
  }

  getStateMask() {
    return this._stateMask;
  }

  getRelayNumber() {
    return this.relayNumber;
  }

  getSerial() {
    return this._serial;
  }

  _syncState() {
    if (this._backend === "hid") {
      return this._syncStateHid();
    }

    return new Promise((resolve) => {
      this._device.controlTransfer(0xa1, 0x01, 0x0100, 0, 8, (err, data) => {
        if (err) {
          console.warn("Warning: could not read board state:", err.message);
          resolve();
          return;
        }
        this._serial = String.fromCharCode(...data.slice(0, 5)).replace(/\0/g, "");
        this._stateMask = data[6] & 0xff;
        resolve();
      });
    });
  }

  _sendCommand(cmd, relayNumber) {
    if (this._backend === "hid") {
      return this._sendCommandHid(cmd, relayNumber);
    }

    return new Promise((resolve, reject) => {
      const buffer = Buffer.from([cmd & 0xff, relayNumber & 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      this._device.controlTransfer(0x21, 0x09, 0x0200, 0, buffer, (err) => {
        if (err) {
          reject(new Error(`Relay command failed: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  async _openWithUsb() {
    const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);
    if (!device) {
      throw new Error(
        `Cannot find USB relay board (VID 0x${VENDOR_ID.toString(16)}, PID 0x${PRODUCT_ID.toString(16)}).\n` +
          "Windows: make sure libusbK is installed via Zadig.\n" +
          "macOS/Linux: check USB connection."
      );
    }

    device.open();
    this._device = device;
    this._backend = "usb";

    const iface = device.interface(0);
    try {
      if (iface.isKernelDriverActive()) {
        iface.detachKernelDriver();
      }
    } catch {
      // Windows: no-op
    }

    iface.claim();
    this._iface = iface;
    await this._syncState();
  }

  async _openWithHid(openError = null) {
    const devices = HID.devices().filter(
      (device) => toUsbId(device.vendorId) === VENDOR_ID && toUsbId(device.productId) === PRODUCT_ID
    );
    if (devices.length === 0) {
      throw new Error(
        `Cannot find USB relay board via HID (VID 0x${VENDOR_ID.toString(16)}, PID 0x${PRODUCT_ID.toString(16)}).\n` +
          (openError ? `USB backend failed first: ${openError.message}\n` : "") +
          "macOS: verify that the board appears in System Information > USB."
      );
    }

    const chosen = devices[0];
    this._device = chosen.path ? new HID.HID(chosen.path) : new HID.HID(VENDOR_ID, PRODUCT_ID);
    this._iface = null;
    this._backend = "hid";
    await this._syncState();
  }

  _syncStateHid() {
    return new Promise((resolve) => {
      try {
        const data = this._device.getFeatureReport(0x01, 8);
        this._serial = String.fromCharCode(...data.slice(1, 6)).replace(/\0/g, "");
        this._stateMask = data[6] & 0xff;
      } catch (err) {
        console.warn("Warning: could not read board state via HID:", err.message);
      }
      resolve();
    });
  }

  _sendCommandHid(cmd, relayNumber) {
    return new Promise((resolve, reject) => {
      try {
        this._device.sendFeatureReport([
          0x00,
          cmd & 0xff,
          relayNumber & 0xff,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
        ]);
        resolve();
      } catch (err) {
        reject(new Error(`Relay command failed: ${err.message}`));
      }
    });
  }

  _shouldFallbackToHid(err) {
    const message = String(err?.message || "");
    return /LIBUSB_ERROR_ACCESS|Access denied|Operation not permitted|Resource busy/i.test(message);
  }

  _toMask(relays) {
    if (typeof relays === "number") return relays & 0xff;

    if (Array.isArray(relays)) {
      let mask = 0;
      relays.forEach((value, index) => {
        if (value) {
          mask |= 1 << index;
        }
      });
      return mask;
    }

    if (typeof relays === "object" && relays !== null) {
      let mask = 0;
      Object.entries(relays).forEach(([key, value]) => {
        const relayNumber = Number.parseInt(key.replace(/\D/g, ""), 10);
        if (!Number.isNaN(relayNumber) && value) {
          mask |= 1 << (relayNumber - 1);
        }
      });
      return mask;
    }

    throw new TypeError("setState: argument must be a number, boolean[], or { K1: bool, ... }");
  }

  _assertRelayNum(relayNumber) {
    if (relayNumber < 1 || relayNumber > this.relayNumber) {
      throw new RangeError(`Relay number must be between 1 and ${this.relayNumber}`);
    }
  }
}

export function findDevices() {
  const hidDevices = HID.devices().filter(
    (device) => toUsbId(device.vendorId) === VENDOR_ID && toUsbId(device.productId) === PRODUCT_ID
  );

  if (hidDevices.length > 0) {
    return hidDevices;
  }

  return usb
    .getDeviceList()
    .filter(
      (device) =>
        device.deviceDescriptor.idVendor === VENDOR_ID &&
        device.deviceDescriptor.idProduct === PRODUCT_ID
    );
}