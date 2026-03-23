import readline from 'readline';
import { UsbRelay, findDevices } from './usbrelay/index.js';

/**
 * app.js — Interactive CLI example for the USB relay board
 *
 * Usage:
 *   node app.js        # auto-connects to the first found board
 *
 * Platform support:
 *   macOS / Linux : works out of the box with node-hid
 *   Windows       : requires node-hid (with libusb-win32 driver via Zadig)
 */


async function main() {

  // ── 1. Find HID device ─────────────────────────────────────────────────────
  const devices = findDevices();
  if (devices.length === 0) {
    console.error(
      'No USB relay board found (VID 0x16c0 / PID 0x05df).\n' +
      'Connect the board and try again.'
    );
    process.exit(1);
  }

  console.log(`Found: ${devices[0].product || 'USB Relay'} (${devices.length} board(s))`);
  if (devices.length > 1) {
    console.log('Multiple boards found — connecting to the first one.');
  }

  // ── 2. Connect ─────────────────────────────────────────────────────────────
  const relay = new UsbRelay(8); // USBRelay8 has 8 relays

  try {
    await relay.open();
  } catch (err) {
    console.error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  const serial = relay.getSerial();
  console.log(`Connected! Serial: ${serial || '(none)'} — ${relay.getRelayNumber()} relays\n`);

  // ── 3. Interactive menu ────────────────────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  printHelp(relay);
  printStatus(relay);

  while (true) {
    const input = (await ask('\nCommand > ')).trim().toLowerCase();

    if (input === 'q' || input === 'quit') {
      break;

    } else if (input === 's' || input === 'status') {
      printStatus(relay);

    } else if (input === 'on') {
      await relay.allOn();
      console.log('All relays ON');
      printStatus(relay);

    } else if (input === 'off') {
      await relay.allOff();
      console.log('All relays OFF');
      printStatus(relay);

    } else if (input.startsWith('on ')) {
      const n = parseInt(input.slice(3), 10);
      try {
        await relay.relayOn(n);
        console.log(`K${n} ON`);
        printStatus(relay);
      } catch (e) {
        console.error(e.message);
      }

    } else if (input.startsWith('off ')) {
      const n = parseInt(input.slice(4), 10);
      try {
        await relay.relayOff(n);
        console.log(`K${n} OFF`);
        printStatus(relay);
      } catch (e) {
        console.error(e.message);
      }

    } else if (input.startsWith('mask ')) {
      // Raw bitmask, e.g. "mask 0b00000101" or "mask 5"
      const val = Number(input.slice(5));
      if (isNaN(val)) {
        console.error('Invalid value');
      } else {
        await relay.setState(val);
        printStatus(relay);
      }

    } else if (input === 'demo') {
      await runDemo(relay);

    } else if (input === 'help' || input === '?') {
      printHelp(relay);

    } else {
      console.log('Unknown command — type "help" for an overview.');
    }
  }

  await relay.close();
  rl.close();
  console.log('\nConnection closed.');
}

function printStatus(relay) {
  const state = relay.getState();
  console.log('─── Board Status ───────────────────────────────');
  Object.entries(state).forEach(([key, on]) => {
    console.log(`  ${key}: ${on ? 'ON  ●' : 'OFF ○'}`);
  });
  console.log('────────────────────────────────────────────────');
}

function printHelp(relay) {
  console.log(`
Commands:
  status    (or s)          Show current state of all relays
  on                        All relays ON
  off                       All relays OFF
  on <n>                    Relay K<n> ON   (n = 1–${relay.getRelayNumber()})
  off <n>                   Relay K<n> OFF  (n = 1–${relay.getRelayNumber()})
  mask <value>              Set bitmask directly (bit 0 = K1, 1 = on)
  demo                      Run a blink demo across all relays
  help                      This overview
  quit      (or q)          Exit
`);
}

async function runDemo(relay) {
  const n = relay.getRelayNumber();
  console.log(`Demo: relays ON → OFF one by one (${n} relays)`);
  for (let i = 1; i <= n; i++) {
    await relay.relayOn(i);
    console.log(`  K${i} ON`);
    await sleep(400);
    await relay.relayOff(i);
    console.log(`  K${i} OFF`);
    await sleep(150);
  }
  console.log('Demo done.');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
