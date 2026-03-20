'use strict';

/**
 * usbrelay.js — Node.js HID driver for the dcttech USB relay board
 *
 * Ondersteunde hardware:
 *   USB Vendor ID : 0x16c0  (Van Ooijen Technische Informatica)
 *   USB Product ID: 0x05df
 *   Fabrikant     : www.dcttech.com  (verkocht als USBRelay2/4/8)
 *
 * HID Feature Report protocol:
 *
 *   Status lezen:
 *     getFeatureReport(0x01, 8)
 *     → [0x01, serial[0..4], state_byte, 0x00]
 *       state_byte: bit 0 = K1, bit 7 = K8  (1 = AAN)
 *
 *   Relay aansturen:
 *     sendFeatureReport([0x00, cmd, relay_num, 0,0,0,0,0,0])
 *       cmd = 0xFF → relay AAN
 *       cmd = 0xFD → relay UIT
 *       relay_num : 1-gebaseerd (0x01..0x08)
 */

const HID = require('node-hid');

const VENDOR_ID  = 0x16c0;
const PRODUCT_ID = 0x05df;

const CMD_ON  = 0xFF;
const CMD_OFF = 0xFD;

function normalizeUsbId(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseInt(value, 16);
  }
  return NaN;
}

function inferRelayCount(device) {
  const product = String(device?.product || '');
  const match = product.match(/relay\s*(\d+)/i);
  if (!match) {
    return null;
  }

  const relayCount = Number.parseInt(match[1], 10);
  return Number.isNaN(relayCount) ? null : relayCount;
}

function matchesRelayDevice(device) {
  const vendorId = normalizeUsbId(device.vendorId);
  const productId = normalizeUsbId(device.productId);
  const manufacturer = String(device.manufacturer || '');
  const product = String(device.product || '');

  if (vendorId === VENDOR_ID && productId === PRODUCT_ID) {
    return true;
  }

  return /dcttech|usb\s*relay/i.test(`${manufacturer} ${product}`);
}

function summarizeDevice(device) {
  const vendorId = normalizeUsbId(device.vendorId);
  const productId = normalizeUsbId(device.productId);
  const usagePage = typeof device.usagePage === 'number'
    ? `0x${device.usagePage.toString(16)}`
    : String(device.usagePage || 'n/a');

  return {
    path: device.path || '(geen pad)',
    vendorId: Number.isNaN(vendorId) ? String(device.vendorId) : `0x${vendorId.toString(16)}`,
    productId: Number.isNaN(productId) ? String(device.productId) : `0x${productId.toString(16)}`,
    manufacturer: device.manufacturer || '',
    product: device.product || '',
    serialNumber: device.serialNumber || '',
    usagePage,
  };
}

class UsbRelay {
  /**
   * @param {number} [relayNumber=8]  aantal relays (2, 4 of 8)
   *   Wordt automatisch uit de HID-descriptor gelezen via initBoard().
   */
  constructor(relayNumber = 8) {
    this.relayNumber = relayNumber;
    this._device    = null;
    this._stateMask = 0; // bit 0 = K1 … bit 7 = K8, 1 = AAN
    this._serial    = '';
  }

  // ─── Verbinding ────────────────────────────────────────────────────────────

  /**
   * Open het HID-apparaat en lees de huidige staat.
   * Gooit een Error als het board niet gevonden wordt.
   */
  open() {
    try {
      const devices = findDevices();
      if (devices.length === 0) {
        throw new Error(
          'Geen passend HID-apparaat gevonden. Op Windows staat vaak een vendor-driver of WinUSB/libusb-driver op het board in plaats van de standaard HID-driver.'
        );
      }

      const selectedDevice = devices[0];
      this._device = selectedDevice.path
        ? new HID.HID(selectedDevice.path)
        : new HID.HID(VENDOR_ID, PRODUCT_ID);

      const inferredRelayCount = inferRelayCount(selectedDevice);
      if (inferredRelayCount) {
        this.relayNumber = inferredRelayCount;
      }

      this._readState();
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(
        new Error(
          `Kan USB relay board niet openen (${err.message}).\n` +
          `Controleer of het board is aangesloten (VID 0x${VENDOR_ID.toString(16)}, PID 0x${PRODUCT_ID.toString(16)}).\n` +
          'Op Windows moet het apparaat zichtbaar zijn als HID-compliant device; als er een vendor-driver, WinUSB of libusbK gekoppeld is, ziet node-hid het board niet.'
        )
      );
    }
  }

  /** Sluit het HID-apparaat. */
  close() {
    if (this._device) {
      this._device.close();
      this._device = null;
    }
    return Promise.resolve();
  }

  // ─── Initialisatie ─────────────────────────────────────────────────────────

  /**
   * Lees boardinfo (serienummer, huidige staat).
   * HID-boards hoeven niet apart geïnitialiseerd te worden.
   * @returns {Promise<number>} relay-aantal
   */
  initBoard() {
    this._readState();
    return Promise.resolve(this.relayNumber);
  }

  // ─── Relays aansturen ──────────────────────────────────────────────────────

  /**
   * Stel de staat van alle relays in.
   *
   * @param {number|boolean[]|object} relays
   *   - number  : bitmask, bit 0 = K1 … bit 7 = K8, 1 = AAN
   *   - boolean[]: [K1, K2, …] waar true/1 = AAN  (index 0 = K1)
   *   - object  : { K1: true, K2: false, … }  (1-gebaseerde sleutelnamen)
   */
  async setState(relays) {
    const newMask = this._toMask(relays);
    for (let i = 0; i < this.relayNumber; i++) {
      const bit    = 1 << i;
      const wantOn = (newMask & bit) !== 0;
      const isOn   = (this._stateMask & bit) !== 0;
      if (wantOn !== isOn) {
        this._sendCommand(wantOn ? CMD_ON : CMD_OFF, i + 1);
        await this._sleep(20);
      }
    }
    this._stateMask = newMask;
  }

  /** Zet relay K<n> AAN. @param {number} n  1-gebaseerd (1–8) */
  async relayOn(n) {
    this._assertRelayNum(n);
    this._sendCommand(CMD_ON, n);
    this._stateMask |= (1 << (n - 1));
    await this._sleep(20);
  }

  /** Zet relay K<n> UIT. @param {number} n  1-gebaseerd (1–8) */
  async relayOff(n) {
    this._assertRelayNum(n);
    this._sendCommand(CMD_OFF, n);
    this._stateMask &= ~(1 << (n - 1));
    await this._sleep(20);
  }

  /** Alle relays AAN. */
  async allOn() {
    for (let i = 1; i <= this.relayNumber; i++) {
      this._sendCommand(CMD_ON, i);
      await this._sleep(20);
    }
    this._stateMask = (1 << this.relayNumber) - 1;
  }

  /** Alle relays UIT. */
  async allOff() {
    for (let i = 1; i <= this.relayNumber; i++) {
      this._sendCommand(CMD_OFF, i);
      await this._sleep(20);
    }
    this._stateMask = 0;
  }

  // ─── Status opvragen ───────────────────────────────────────────────────────

  /** @returns {{ K1: boolean, K2: boolean, … }} */
  getState() {
    const state = {};
    for (let i = 0; i < this.relayNumber; i++) {
      state[`K${i + 1}`] = Boolean(this._stateMask & (1 << i));
    }
    return state;
  }

  /** Ruwe bitmask (bit 0 = K1, 1 = AAN). */
  getStateMask()   { return this._stateMask; }

  /** Relay-aantal. */
  getRelayNumber() { return this.relayNumber; }

  /** Serienummer zoals gerapporteerd door het board. */
  getSerial()      { return this._serial; }

  // ─── Interne hulpfuncties ─────────────────────────────────────────────────

  /** Lees Feature Report 0x01: [rptId, s0,s1,s2,s3,s4, stateByte, 0x00] */
  _readState() {
    const data = this._device.getFeatureReport(0x01, 8);
    // Bytes 1–5: ASCII serienummer
    this._serial = String.fromCharCode(...data.slice(1, 6)).replace(/\0/g, '');
    // Byte 6: bitmask van alle relays
    this._stateMask = data[6] & 0xFF;
  }

  /** Stuur een HID Feature Report om één relay aan of uit te zetten. */
  _sendCommand(cmd, relayNum) {
    // [reportID=0x00, cmd, relayNum, 0, 0, 0, 0, 0, 0]
    this._device.sendFeatureReport(
      [0x00, cmd & 0xFF, relayNum & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    );
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _toMask(relays) {
    if (typeof relays === 'number') return relays & 0xFF;
    if (Array.isArray(relays)) {
      let mask = 0;
      relays.forEach((v, i) => { if (v) mask |= (1 << i); });
      return mask;
    }
    if (typeof relays === 'object' && relays !== null) {
      let mask = 0;
      Object.entries(relays).forEach(([key, v]) => {
        const num = parseInt(key.replace(/\D/g, ''), 10);
        if (!isNaN(num) && v) mask |= (1 << (num - 1));
      });
      return mask;
    }
    throw new TypeError('setState: argument moet een number, boolean[] of { K1: bool, … } zijn');
  }

  _assertRelayNum(n) {
    if (n < 1 || n > this.relayNumber) {
      throw new RangeError(`Relay-nummer moet tussen 1 en ${this.relayNumber} liggen`);
    }
  }
}

// ─── HID-apparaat vinden ─────────────────────────────────────────────────────

/**
 * Geef een lijst van aangesloten USB relay boards (VID 0x16c0, PID 0x05df).
 * @returns {import('node-hid').Device[]}
 */
function findDevices() {
  return HID.devices().filter(matchesRelayDevice);
}

function debugDevices() {
  return HID.devices().map(summarizeDevice);
}

module.exports = { UsbRelay, findDevices, debugDevices, VENDOR_ID, PRODUCT_ID };
