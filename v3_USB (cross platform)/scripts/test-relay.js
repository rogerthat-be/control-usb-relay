/**
 * test-relay.js — Windows diagnostics + relay test for dcttech USBRelay board
 *
 * Usage:
 *   npm install usb
 *   node test-relay.js
 *
 * Requirements:
 *   - Zadig: install the libusbK driver for the USBRelay8 device
 *   - npm install usb
 *
 * What this script does:
 *   1. Finds the USB relay board via node-usb
 *   2. Opens the device and claims the interface
 *   3. Reads current relay status via GET_REPORT control transfer
 *   4. Tests SET_REPORT control transfer (relay commands)
 *   5. If writing works -> turn relay 1 ON, wait 1s, then OFF
 */

import usb from 'usb';

const VENDOR_ID  = 0x16c0;
const PRODUCT_ID = 0x05df;

// Relay commands
const CMD_ON  = 0xFF;  // Relay ON
const CMD_OFF = 0xFD;  // Relay OFF
const CMD_ALL_ON  = 0xFE;  // All relays ON
const CMD_ALL_OFF = 0xFC;  // All relays OFF

// ─── Helper functions ────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hex(buf) {
  return Array.from(buf).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
}

// ─── 1. Find device ──────────────────────────────────────────────────────────

console.log('=== Step 1: Finding USB device ===');

const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);

if (!device) {
  console.error('ERROR: No USB relay board found (VID 0x16c0, PID 0x05df).');
  console.error('');
  console.error('Check:');
  console.error('  1. USB cable and connection');
  console.error('  2. Zadig: is the libusbK driver installed for USBRelay8?');
  console.error('     → https://zadig.akeo.ie/');
  console.error('     → Options → List All Devices → USBRelay8 → libusbK → Replace Driver');
  console.error('  3. npm install usb');
  console.error('');
  console.error('All detected USB devices:');
  usb.getDeviceList().forEach(d => {
    const vid = '0x' + d.deviceDescriptor.idVendor.toString(16).padStart(4, '0');
    const pid = '0x' + d.deviceDescriptor.idProduct.toString(16).padStart(4, '0');
    console.error(`  VID ${vid}  PID ${pid}`);
  });
  process.exit(1);
}

console.log('Found: USBRelay8');
console.log(`  VID : 0x${device.deviceDescriptor.idVendor.toString(16).padStart(4,'0')}`);
console.log(`  PID : 0x${device.deviceDescriptor.idProduct.toString(16).padStart(4,'0')}`);
console.log(`  Bus : ${device.busNumber}  Device : ${device.deviceAddress}`);

// ─── 2. Open device ──────────────────────────────────────────────────────────

console.log('\n=== Step 2: Opening device ===');

try {
  device.open();
  console.log('OK: device opened');
} catch (err) {
  console.error('ERROR while opening device:', err.message);
  process.exit(1);
}

const iface = device.interface(0);

// On Windows with libusbK, kernel-driver detach is usually not needed,
// but we keep this for Linux/macOS compatibility.
try {
  if (iface.isKernelDriverActive()) {
    iface.detachKernelDriver();
    console.log('Kernel driver detached');
  }
} catch (_) {
  // Windows: no-op, safe to ignore
}

try {
  iface.claim();
  console.log('OK: interface claimed');
} catch (err) {
  console.error('ERROR while claiming interface:', err.message);
  device.close();
  process.exit(1);
}

// ─── Control transfer helpers ────────────────────────────────────────────────

/**
 * Reads current relay status from the board.
 * GET_REPORT: Device→Host, Class, Interface
 * Returns 8 bytes: [serial(5), ?, mask, ?]
 */
function getStatus() {
  return new Promise((resolve, reject) => {
    device.controlTransfer(
      0xa1,   // bmRequestType: Device-to-Host | Class | Interface
      0x01,   // bRequest: GET_REPORT
      0x0100, // wValue: report type Input (0x01), report ID 0
      0,      // wIndex: interface 0
      8,      // wLength
      (err, data) => {
        if (err) reject(err);
        else resolve(data);
      }
    );
  });
}

/**
 * Sends a relay command to the board.
 * SET_REPORT: Host→Device, Class, Interface
 * Payload: [CMD, RELAY_NUM, 0, 0, 0, 0, 0, 0]
 *
 * @param {number} cmd   - CMD_ON (0xFF) or CMD_OFF (0xFD)
 * @param {number} relay - Relay number 1–8, or 0 for all relays
 */
function sendCommand(cmd, relay) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from([cmd, relay, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    device.controlTransfer(
      0x21,   // bmRequestType: Host-to-Device | Class | Interface
      0x09,   // bRequest: SET_REPORT
      0x0200, // wValue: report type Output (0x02), report ID 0
      0,      // wIndex: interface 0
      buf,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// ─── Cleanup helper ──────────────────────────────────────────────────────────

function cleanup(cb) {
  iface.release(true, () => {
    device.close();
    if (cb) cb();
  });
}

// ─── Main test procedure ─────────────────────────────────────────────────────

async function runTests() {

  // ── Step 3: Read status ───────────────────────────────────────────────────
  console.log('\n=== Step 3: Reading relay status ===');
  try {
    const data = await getStatus();
    console.log('OK  raw bytes :', hex(data));
    const serial = String.fromCharCode(...data.slice(0, 5)).replace(/\0/g, '');
    const mask   = data[6];
    console.log(`    serial     : "${serial}"`);
    console.log(`    state mask : 0x${mask.toString(16).padStart(2,'0')} (${mask.toString(2).padStart(8,'0')}b)`);
    for (let i = 0; i < 8; i++) {
      const state = (mask >> i) & 1 ? 'ON' : 'OFF';
      console.log(`    relay ${i+1}    : ${state}`);
    }
  } catch (err) {
    console.log('Status read failed (non-critical):', err.message);
  }

  // ── Step 4: Write test ────────────────────────────────────────────────────
  console.log('\n=== Step 4: Testing relay commands ===');
  try {
    console.log('Relay 1 -> ON');
    await sendCommand(CMD_ON, 0x01);
    console.log('OK: SET_REPORT succeeded');
    await sleep(1000);

    console.log('Relay 1 -> OFF');
    await sendCommand(CMD_OFF, 0x01);
    await sleep(300);
  } catch (err) {
    console.error('ERROR while sending command:', err.message);
    console.error('');
    console.error('Possible causes:');
    console.error('  - libusbK driver is not correctly installed via Zadig');
    console.error('  - Try "Replace Driver" again in Zadig');
    cleanup();
    return;
  }

  // ── Step 5: All-relays test ───────────────────────────────────────────────
  console.log('\n=== Step 5: All-relays ON/OFF test ===');
  console.log('All relays -> ON');
  await sendCommand(CMD_ALL_ON, 0x00);
  await sleep(1000);

  console.log('All relays -> OFF');
  await sendCommand(CMD_ALL_OFF, 0x00);
  await sleep(300);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  console.log('Working method  : node-usb controlTransfer (libusbK)');
  console.log('Test passed');
  console.log('');
  console.log('Use in your own code:');
  console.log('  sendCommand(CMD_ON,  0x01)   // relay 1 on');
  console.log('  sendCommand(CMD_OFF, 0x01)   // relay 1 off');
  console.log('  sendCommand(CMD_ON,  0x02)   // relay 2 on');
  console.log('  sendCommand(CMD_ALL_ON,  0)  // all relays on');
  console.log('  sendCommand(CMD_ALL_OFF, 0)  // all relays off');

  cleanup();
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  cleanup(() => process.exit(1));
});