"use strict";

/**
 * usbrelay.js — Node.js USB driver for the dcttech USB relay board
 *
 * Supported hardware:
 *   USB Vendor ID : 0x16c0  (Van Ooijen Technische Informatica)
 *   USB Product ID: 0x05df
 *   Sold as: USBRelay2 / USBRelay4 / USBRelay8
 *
 * Platform support:
 *   Windows       : libusbK driver via Zadig + npm install usb
 *   macOS / Linux : libusb (built into node-usb) + npm install usb
 *
 * USB HID control transfer protocol:
 *
 *   Read status:
 *     IN  bmRequestType=0xa1, bRequest=0x01, wValue=0x0100, wIndex=0, wLength=8
 *     → [serial[0..4], 0x00, 0x00, state_byte]
 *       state_byte: bit 0 = K1, bit 7 = K8  (1 = ON)
 *
 *   Control relay:
 *     OUT bmRequestType=0x21, bRequest=0x09, wValue=0x0200, wIndex=0
 *     data = [cmd, relay_num, 0,0,0,0,0,0]
 *       cmd = 0xFF → relay ON
 *       cmd = 0xFD → relay OFF
 *       relay_num: 1-based (0x01..0x08)
 */

const usb = require("usb");

const VENDOR_ID  = 0x16c0;
const PRODUCT_ID = 0x05df;

const CMD_ON  = 0xff;
const CMD_OFF = 0xfd;

// ─── UsbRelay class ───────────────────────────────────────────────────────────

class UsbRelay {
  /**
   * @param {number} [relayNumber=8]  Number of relays (2, 4, or 8)
   */
  constructor(relayNumber = 8) {
    this.relayNumber = relayNumber;
    this._device    = null;
    this._iface     = null;
    this._stateMask = 0;   // bit 0 = K1 … bit 7 = K8, 1 = ON
    this._serial    = "";
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  /**
   * Open the USB device and read current state.
   * Throws if the board is not found.
   */
  async open() {
    const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);
    if (!device) {
      throw new Error(
        `Cannot find USB relay board (VID 0x${VENDOR_ID.toString(16)}, PID 0x${PRODUCT_ID.toString(16)}).\n` +
        `Windows: make sure libusbK is installed via Zadig.\n` +
        `macOS/Linux: check USB connection.`
      );
    }

    device.open();
    this._device = device;

    const iface = device.interface(0);

    // Detach kernel driver on Linux/Mac if needed
    try {
      if (iface.isKernelDriverActive()) {
        iface.detachKernelDriver();
      }
    } catch (_) {
      // Windows: this is a no-op, safe to ignore
    }

    iface.claim();
    this._iface = iface;

    await this._syncState();
  }

  /** Close the USB device. */
  close() {
    return new Promise((resolve) => {
      if (!this._iface) return resolve();
      this._iface.release(() => {
        try { this._device.close(); } catch (_) {}
        this._device = null;
        this._iface  = null;
        resolve();
      });
    });
  }

  // ─── Board init ─────────────────────────────────────────────────────────────

  /** Read board info (serial, current state). */
  async initBoard() {
    await this._syncState();
    return this.relayNumber;
  }

  // ─── Relay control ──────────────────────────────────────────────────────────

  /**
   * Set the state of all relays.
   *
   * @param {number|boolean[]|object} relays
   *   - number   : bitmask, bit 0 = K1 … bit 7 = K8, 1 = ON
   *   - boolean[]: [K1, K2, …] where true = ON  (index 0 = K1)
   *   - object   : { K1: true, K2: false, … }  (1-based key names)
   */
  async setState(relays) {
    const newMask = this._toMask(relays);
    for (let i = 0; i < this.relayNumber; i++) {
      const bit    = 1 << i;
      const wantOn = (newMask & bit) !== 0;
      const isOn   = (this._stateMask & bit) !== 0;
      if (wantOn !== isOn) {
        await this._sendCommand(wantOn ? CMD_ON : CMD_OFF, i + 1);
      }
    }
    this._stateMask = newMask;
  }

  /** Turn relay K<n> ON. @param {number} n  1-based (1–8) */
  async relayOn(n) {
    this._assertRelayNum(n);
    await this._sendCommand(CMD_ON, n);
    this._stateMask |= 1 << (n - 1);
  }

  /** Turn relay K<n> OFF. @param {number} n  1-based (1–8) */
  async relayOff(n) {
    this._assertRelayNum(n);
    await this._sendCommand(CMD_OFF, n);
    this._stateMask &= ~(1 << (n - 1));
  }

  /** All relays ON. */
  async allOn() {
    for (let i = 1; i <= this.relayNumber; i++) {
      await this._sendCommand(CMD_ON, i);
    }
    this._stateMask = (1 << this.relayNumber) - 1;
  }

  /** All relays OFF. */
  async allOff() {
    for (let i = 1; i <= this.relayNumber; i++) {
      await this._sendCommand(CMD_OFF, i);
    }
    this._stateMask = 0;
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  /** @returns {{ K1: boolean, K2: boolean, … }} */
  getState() {
    const state = {};
    for (let i = 0; i < this.relayNumber; i++) {
      state[`K${i + 1}`] = Boolean(this._stateMask & (1 << i));
    }
    return state;
  }

  /** Raw bitmask (bit 0 = K1, 1 = ON). */
  getStateMask() { return this._stateMask; }

  /** Number of relays. */
  getRelayNumber() { return this.relayNumber; }

  /** Serial number as reported by the board. */
  getSerial() { return this._serial; }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Read current relay state via USB HID GET_REPORT control transfer.
   */
  _syncState() {
    return new Promise((resolve) => {
      // bmRequestType 0xa1 = Device-to-Host | Class | Interface
      // bRequest      0x01 = GET_REPORT
      // wValue        0x0100 = Input report, ID 0
      // wIndex        0 = interface 0
      // wLength       8
      this._device.controlTransfer(0xa1, 0x01, 0x0100, 0, 8, (err, data) => {
        if (err) {
          // Non-fatal: some boards don't support GET_REPORT
          console.warn("Warning: could not read board state:", err.message);
          return resolve();
        }
        this._serial    = String.fromCharCode(...data.slice(0, 5)).replace(/\0/g, "");
        this._stateMask = data[7] & 0xff;
        resolve();
      });
    });
  }

  /**
   * Send a relay on/off command via USB HID SET_REPORT control transfer.
   * @param {number} cmd       CMD_ON (0xFF) or CMD_OFF (0xFD)
   * @param {number} relayNum  1-based relay number
   */
  _sendCommand(cmd, relayNum) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from([
        cmd & 0xff,
        relayNum & 0xff,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      // bmRequestType 0x21 = Host-to-Device | Class | Interface
      // bRequest      0x09 = SET_REPORT
      // wValue        0x0200 = Output report, ID 0
      // wIndex        0 = interface 0
      this._device.controlTransfer(0x21, 0x09, 0x0200, 0, buf, (err) => {
        if (err) return reject(new Error(`Relay command failed: ${err.message}`));
        resolve();
      });
    });
  }

  _toMask(relays) {
    if (typeof relays === "number") return relays & 0xff;
    if (Array.isArray(relays)) {
      let mask = 0;
      relays.forEach((v, i) => { if (v) mask |= 1 << i; });
      return mask;
    }
    if (typeof relays === "object" && relays !== null) {
      let mask = 0;
      Object.entries(relays).forEach(([key, v]) => {
        const num = parseInt(key.replace(/\D/g, ""), 10);
        if (!isNaN(num) && v) mask |= 1 << (num - 1);
      });
      return mask;
    }
    throw new TypeError(
      "setState: argument must be a number, boolean[], or { K1: bool, … }"
    );
  }

  _assertRelayNum(n) {
    if (n < 1 || n > this.relayNumber) {
      throw new RangeError(`Relay number must be between 1 and ${this.relayNumber}`);
    }
  }
}

// ─── Find devices ─────────────────────────────────────────────────────────────

/**
 * Returns a list of connected USB relay boards.
 * @returns {usb.Device[]}
 */
function findDevices() {
  return usb.getDeviceList().filter(d =>
    d.deviceDescriptor.idVendor  === VENDOR_ID &&
    d.deviceDescriptor.idProduct === PRODUCT_ID
  );
}

module.exports = { UsbRelay, findDevices, VENDOR_ID, PRODUCT_ID };
