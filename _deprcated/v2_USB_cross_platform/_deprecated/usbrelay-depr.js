"use strict";

/**
 * usbrelay.js — Node.js HID driver for the dcttech USB relay board
 *
 * Supported hardware:
 *   USB Vendor ID : 0x16c0  (Van Ooijen Technische Informatica)
 *   USB Product ID: 0x05df
 *   Sold as: USBRelay2 / USBRelay4 / USBRelay8
 *
 * Platform support:
 *   macOS / Linux : uses getFeatureReport / sendFeatureReport (native HID)
 *   Windows       : uses write() + read() (HID driver quirk)
 *
 * HID Feature Report protocol:
 *
 *   Read status:
 *     getFeatureReport(0x01, 8)
 *     → [0x01, serial[0..4], state_byte, 0x00]
 *       state_byte: bit 0 = K1, bit 7 = K8  (1 = ON)
 *
 *   Control relay:
 *     sendFeatureReport([0x00, cmd, relay_num, 0,0,0,0,0,0])
 *       cmd = 0xFF → relay ON
 *       cmd = 0xFD → relay OFF
 *       relay_num: 1-based (0x01..0x08)
 */

const HID = require("../../v1_HID_only_mac/node_modules/node-hid/nodehid");

const VENDOR_ID  = 0x16c0;
const PRODUCT_ID = 0x05df;

const CMD_ON  = 0xff;
const CMD_OFF = 0xfd;

const IS_WINDOWS = process.platform === "win32";
const IS_MAC     = process.platform === "darwin";
const IS_LINUX   = process.platform === "linux";

// ─── Platform-specific HID adapter ───────────────────────────────────────────

/**
 * HidAdapter wraps a node-hid device and provides a unified
 * readState() / sendCommand() interface across platforms.
 */
class HidAdapter {
  constructor(device) {
    this._dev = device;
  }

  /**
   * Read the current relay state from the board.
   * @returns {{ serial: string, stateMask: number }}
   */
  readState() {
    if (IS_WINDOWS) {
      // Windows HID stack does not support getFeatureReport for this device.
      // Workaround: send a dummy write then read the response.
      this._dev.write([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const data = this._dev.read();
      return {
        serial:    String.fromCharCode(...data.slice(0, 5)).replace(/\0/g, ""),
        stateMask: data[7] & 0xff,
      };
    } else {
      // macOS / Linux: standard HID Feature Report
      const data = this._dev.getFeatureReport(0x01, 8);
      return {
        serial:    String.fromCharCode(...data.slice(1, 6)).replace(/\0/g, ""),
        stateMask: data[6] & 0xff,
      };
    }
  }

  /**
   * Send a relay on/off command.
   * @param {number} cmd       CMD_ON (0xFF) or CMD_OFF (0xFD)
   * @param {number} relayNum  1-based relay number
   */
  sendCommand(cmd, relayNum) {
    if (IS_WINDOWS) {
      // Windows: plain write(), 8 bytes, no report-ID prefix needed
      this._dev.write([
        0x00,
        cmd & 0xff,
        relayNum & 0xff,
        0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
    } else {
      // macOS / Linux: HID Feature Report, 9 bytes (first byte = report ID 0x00)
      this._dev.sendFeatureReport([
        0x00,
        cmd & 0xff,
        relayNum & 0xff,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
    }
  }

  close() {
    this._dev.close();
  }
}

// ─── UsbRelay class ───────────────────────────────────────────────────────────

class UsbRelay {
  /**
   * @param {number} [relayNumber=8]  Number of relays (2, 4, or 8)
   */
  constructor(relayNumber = 8) {
    this.relayNumber = relayNumber;
    this._adapter    = null;
    this._stateMask  = 0;   // bit 0 = K1 … bit 7 = K8, 1 = ON
    this._serial     = "";
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  /**
   * Open the HID device and read current state.
   * Throws if the board is not found.
   */
  open(path = null) {
    try {
      let rawDevice;

      if (path) {
        rawDevice = new HID.HID(path);
      } else if (IS_MAC || IS_LINUX) {
        // On Mac/Linux, prefer the interface with usagePage 0xFF00
        const devices = HID.devices(VENDOR_ID, PRODUCT_ID);
        if (devices.length === 0) throw new Error("No device found");
        const chosen = devices.find(d => d.usagePage === 0xFF00) || devices[0];
        rawDevice = new HID.HID(chosen.path);
      } else {
        // Windows: open by VID/PID directly
        rawDevice = new HID.HID(VENDOR_ID, PRODUCT_ID);
      }

      this._adapter = new HidAdapter(rawDevice);
      this._syncState();
      return Promise.resolve();

    } catch (err) {
      return Promise.reject(new Error(
        `Cannot open USB relay board (${err.message}).\n` +
        `Check that the board is connected (VID 0x${VENDOR_ID.toString(16)}, PID 0x${PRODUCT_ID.toString(16)}).\n` +
        (IS_WINDOWS
          ? "Windows: make sure node-hid is installed with --driver=libusb if using Zadig."
          : "macOS/Linux: you may need to run with sudo, or add a udev rule.")
      ));
    }
  }

  /** Close the HID device. */
  close() {
    if (this._adapter) {
      this._adapter.close();
      this._adapter = null;
    }
    return Promise.resolve();
  }

  // ─── Board init ─────────────────────────────────────────────────────────────

  /** Read board info (serial, current state). */
  initBoard() {
    this._syncState();
    return Promise.resolve(this.relayNumber);
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
      const bit   = 1 << i;
      const wantOn = (newMask & bit) !== 0;
      const isOn   = (this._stateMask & bit) !== 0;
      if (wantOn !== isOn) {
        this._adapter.sendCommand(wantOn ? CMD_ON : CMD_OFF, i + 1);
        await this._sleep(20);
      }
    }
    this._stateMask = newMask;
  }

  /** Turn relay K<n> ON. @param {number} n  1-based (1–8) */
  async relayOn(n) {
    this._assertRelayNum(n);
    this._adapter.sendCommand(CMD_ON, n);
    this._stateMask |= 1 << (n - 1);
    await this._sleep(20);
  }

  /** Turn relay K<n> OFF. @param {number} n  1-based (1–8) */
  async relayOff(n) {
    this._assertRelayNum(n);
    this._adapter.sendCommand(CMD_OFF, n);
    this._stateMask &= ~(1 << (n - 1));
    await this._sleep(20);
  }

  /** All relays ON. */
  async allOn() {
    for (let i = 1; i <= this.relayNumber; i++) {
      this._adapter.sendCommand(CMD_ON, i);
      await this._sleep(20);
    }
    this._stateMask = (1 << this.relayNumber) - 1;
  }

  /** All relays OFF. */
  async allOff() {
    for (let i = 1; i <= this.relayNumber; i++) {
      this._adapter.sendCommand(CMD_OFF, i);
      await this._sleep(20);
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

  /** Current platform string for diagnostics. */
  static getPlatform() {
    if (IS_WINDOWS) return "windows";
    if (IS_MAC)     return "macos";
    if (IS_LINUX)   return "linux";
    return process.platform;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  _syncState() {
    const { serial, stateMask } = this._adapter.readState();
    this._serial    = serial;
    this._stateMask = stateMask;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
 * Returns a list of connected USB relay boards (VID 0x16c0, PID 0x05df).
 * @returns {import('../../v1_HID_only_mac/node_modules/node-hid/nodehid').Device[]}
 */
function findDevices() {
  return HID.devices(VENDOR_ID, PRODUCT_ID);
}

module.exports = { UsbRelay, findDevices, VENDOR_ID, PRODUCT_ID, IS_WINDOWS, IS_MAC, IS_LINUX };
