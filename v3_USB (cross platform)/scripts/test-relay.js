/**
 * test-relay.js — Windows diagnostics + relay test for dcttech USBRelay board
 *
 * Usage:
 *   npm install usb
 *   node test-relay.js
 *
 * Vereisten:
 *   - Zadig: installeer libusbK driver voor het USBRelay8 apparaat
 *   - npm install usb
 *
 * Wat dit script doet:
 *   1. Zoekt het USB relay board op via node-usb
 *   2. Opent het apparaat en claimt de interface
 *   3. Leest de huidige relay status via GET_REPORT control transfer
 *   4. Test SET_REPORT control transfer (relay commando's)
 *   5. Als schrijven werkt → zet relay 1 AAN, wacht 1s, dan UIT
 */

import usb from 'usb';

const VENDOR_ID  = 0x16c0;
const PRODUCT_ID = 0x05df;

// Relay commando's
const CMD_ON  = 0xFF;  // Relay AAN
const CMD_OFF = 0xFD;  // Relay UIT
const CMD_ALL_ON  = 0xFE;  // Alle relays AAN
const CMD_ALL_OFF = 0xFC;  // Alle relays UIT

// ─── Hulpfuncties ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hex(buf) {
  return Array.from(buf).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
}

// ─── 1. Apparaat zoeken ───────────────────────────────────────────────────────

console.log('=== Stap 1: USB apparaat zoeken ===');

const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);

if (!device) {
  console.error('FOUT: Geen USB relay board gevonden (VID 0x16c0, PID 0x05df).');
  console.error('');
  console.error('Controleer:');
  console.error('  1. USB-kabel en aansluiting');
  console.error('  2. Zadig: libusbK driver geïnstalleerd voor USBRelay8?');
  console.error('     → https://zadig.akeo.ie/');
  console.error('     → Options → List All Devices → USBRelay8 → libusbK → Replace Driver');
  console.error('  3. npm install usb');
  console.error('');
  console.error('Alle gevonden USB apparaten:');
  usb.getDeviceList().forEach(d => {
    const vid = '0x' + d.deviceDescriptor.idVendor.toString(16).padStart(4, '0');
    const pid = '0x' + d.deviceDescriptor.idProduct.toString(16).padStart(4, '0');
    console.error(`  VID ${vid}  PID ${pid}`);
  });
  process.exit(1);
}

console.log('Gevonden: USBRelay8');
console.log(`  VID : 0x${device.deviceDescriptor.idVendor.toString(16).padStart(4,'0')}`);
console.log(`  PID : 0x${device.deviceDescriptor.idProduct.toString(16).padStart(4,'0')}`);
console.log(`  Bus : ${device.busNumber}  Device : ${device.deviceAddress}`);

// ─── 2. Apparaat openen ───────────────────────────────────────────────────────

console.log('\n=== Stap 2: Apparaat openen ===');

try {
  device.open();
  console.log('OK: apparaat geopend');
} catch (err) {
  console.error('FOUT bij openen:', err.message);
  process.exit(1);
}

const iface = device.interface(0);

// Op Windows met libusbK is kernel driver detach niet nodig,
// maar we proberen het netjes voor Linux/macOS compatibiliteit
try {
  if (iface.isKernelDriverActive()) {
    iface.detachKernelDriver();
    console.log('Kernel driver ontkoppeld');
  }
} catch (_) {
  // Windows: no-op, veilig te negeren
}

try {
  iface.claim();
  console.log('OK: interface geclaimd');
} catch (err) {
  console.error('FOUT bij claimen interface:', err.message);
  device.close();
  process.exit(1);
}

// ─── Control transfer hulpfuncties ────────────────────────────────────────────

/**
 * Leest de huidige relay status van het board.
 * GET_REPORT: Device→Host, Class, Interface
 * Geeft 8 bytes terug: [serial(5), ?, mask, ?]
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
 * Stuurt een relay commando naar het board.
 * SET_REPORT: Host→Device, Class, Interface
 * Payload: [CMD, RELAY_NUM, 0, 0, 0, 0, 0, 0]
 *
 * @param {number} cmd   - CMD_ON (0xFF) of CMD_OFF (0xFD)
 * @param {number} relay - Relay nummer 1–8, of 0 voor alle relays
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

// ─── Cleanup helper ───────────────────────────────────────────────────────────

function cleanup(cb) {
  iface.release(true, () => {
    device.close();
    if (cb) cb();
  });
}

// ─── Hoofd testprocedure ──────────────────────────────────────────────────────

async function runTests() {

  // ── Stap 3: Status lezen ────────────────────────────────────────────────────
  console.log('\n=== Stap 3: Relay status lezen ===');
  try {
    const data = await getStatus();
    console.log('OK  raw bytes :', hex(data));
    const serial = String.fromCharCode(...data.slice(0, 5)).replace(/\0/g, '');
    const mask   = data[6];
    console.log(`    serial     : "${serial}"`);
    console.log(`    state mask : 0x${mask.toString(16).padStart(2,'0')} (${mask.toString(2).padStart(8,'0')}b)`);
    for (let i = 0; i < 8; i++) {
      const state = (mask >> i) & 1 ? 'AAN' : 'UIT';
      console.log(`    relay ${i+1}    : ${state}`);
    }
  } catch (err) {
    console.log('Status lezen mislukt (niet kritiek):', err.message);
  }

  // ── Stap 4: Schrijftest ─────────────────────────────────────────────────────
  console.log('\n=== Stap 4: Relay commando testen ===');
  try {
    console.log('Relay 1 → AAN');
    await sendCommand(CMD_ON, 0x01);
    console.log('OK: SET_REPORT geslaagd');
    await sleep(1000);

    console.log('Relay 1 → UIT');
    await sendCommand(CMD_OFF, 0x01);
    await sleep(300);
  } catch (err) {
    console.error('FOUT bij versturen commando:', err.message);
    console.error('');
    console.error('Mogelijke oorzaken:');
    console.error('  - libusbK driver niet correct geïnstalleerd via Zadig');
    console.error('  - Probeer "Replace Driver" opnieuw in Zadig');
    cleanup();
    return;
  }

  // ── Stap 5: Alle relays test ────────────────────────────────────────────────
  console.log('\n=== Stap 5: Alle relays AAN/UIT test ===');
  console.log('Alle relays → AAN');
  await sendCommand(CMD_ALL_ON, 0x00);
  await sleep(1000);

  console.log('Alle relays → UIT');
  await sendCommand(CMD_ALL_OFF, 0x00);
  await sleep(300);

  // ── Samenvatting ────────────────────────────────────────────────────────────
  console.log('\n=== Samenvatting ===');
  console.log('Werkende methode : node-usb controlTransfer (libusbK)');
  console.log('Test geslaagd ✓');
  console.log('');
  console.log('Gebruik in je eigen code:');
  console.log('  sendCommand(CMD_ON,  0x01)  // relay 1 aan');
  console.log('  sendCommand(CMD_OFF, 0x01)  // relay 1 uit');
  console.log('  sendCommand(CMD_ON,  0x02)  // relay 2 aan');
  console.log('  sendCommand(CMD_ALL_ON,  0)  // alle relays aan');
  console.log('  sendCommand(CMD_ALL_OFF, 0)  // alle relays uit');

  cleanup();
}

runTests().catch(err => {
  console.error('Onverwachte fout:', err);
  cleanup(() => process.exit(1));
});