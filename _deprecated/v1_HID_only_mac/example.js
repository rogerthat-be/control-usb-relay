'use strict';

/**
 * example.js — Interactief CLI-voorbeeld voor het USB relayboard (HID)
 *
 * Gebruik:
 *   node example.js        # verbindt automatisch met het eerste gevonden board
 */

const { UsbRelay, findDevices, debugDevices, VENDOR_ID, PRODUCT_ID } = require('./usbrelay');
const readline = require('readline');

async function main() {
  // ── 1. HID-apparaat zoeken ────────────────────────────────────────────────
  const devices = findDevices();
  if (devices.length === 0) {
    const hidDevices = debugDevices()
      .filter((device) => device.vendorId === `0x${VENDOR_ID.toString(16)}` || /relay|dcttech/i.test(`${device.manufacturer} ${device.product}`));

    console.error(
      'Geen USB relay board gevonden (VID 0x16c0 / PID 0x05df).\n' +
      'Sluit het board aan en probeer opnieuw.\n' +
      'Op Windows moet het board als HID-device zichtbaar zijn; controleer Apparaatbeheer.'
    );

    if (hidDevices.length > 0) {
      console.error('Wel gevonden als kandidaat-HID-device:');
      hidDevices.forEach((device) => {
        console.error(`  ${device.product || '(geen productnaam)'}  VID=${device.vendorId} PID=${device.productId} path=${device.path}`);
      });
    }

    process.exit(1);
  }

  console.log(`Gevonden: ${devices[0].product || 'USB Relay'} (${devices.length} board(s))`);

  // ── 2. Verbinding ──────────────────────────────────────────────────────────
  const relay = new UsbRelay(8); // USBRelay8 heeft 8 relays

  try {
    await relay.open();
  } catch (err) {
    console.error(`Verbinding mislukt: ${err.message}`);
    process.exit(1);
  }

  const serial = relay.getSerial();
  console.log(`Verbonden! Serienummer: ${serial || '(geen)'} — ${relay.getRelayNumber()} relays`);

  // ── 3. Interactief menu ───────────────────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  printHelp(relay);
  printStatus(relay);

  while (true) {
    const input = (await ask('\nCommando > ')).trim().toLowerCase();

    if (input === 'q' || input === 'quit') {
      break;
    } else if (input === 's' || input === 'status') {
      printStatus(relay);
    } else if (input === 'on') {
      await relay.allOn();
      console.log('Alle relays AAN');
      printStatus(relay);
    } else if (input === 'off') {
      await relay.allOff();
      console.log('Alle relays UIT');
      printStatus(relay);
    } else if (input.startsWith('on ')) {
      const n = parseInt(input.slice(3), 10);
      try {
        await relay.relayOn(n);
        console.log(`K${n} AAN`);
        printStatus(relay);
      } catch (e) {
        console.error(e.message);
      }
    } else if (input.startsWith('off ')) {
      const n = parseInt(input.slice(4), 10);
      try {
        await relay.relayOff(n);
        console.log(`K${n} UIT`);
        printStatus(relay);
      } catch (e) {
        console.error(e.message);
      }
    } else if (input.startsWith('mask ')) {
      // Ruwe bitmask, bijv. "mask 0b00000101" of "mask 5"
      const val = Number(input.slice(5));
      if (isNaN(val)) {
        console.error('Ongeldige waarde');
      } else {
        await relay.setState(val);
        printStatus(relay);
      }
    } else if (input === 'demo') {
      await runDemo(relay);
    } else if (input === 'help' || input === '?') {
      printHelp(relay);
    } else {
      console.log('Onbekend commando — typ "help" voor een overzicht.');
    }
  }

  await relay.close();
  rl.close();
  console.log('\nVerbinding gesloten.');
}

function printStatus(relay) {
  const state = relay.getState();
  console.log('─── Board Status ───────────────────────────────');
  Object.entries(state).forEach(([key, on]) => {
    console.log(`  ${key}: ${on ? 'AAN ●' : 'UIT ○'}`);
  });
  console.log('────────────────────────────────────────────────');
}

function printHelp(relay) {
  console.log(`
Commando's:
  status    (of s)          Toon huidige status van alle relays
  on                        Alle relays AAN
  off                       Alle relays UIT
  on <n>                    Relay K<n> AAN  (n = 1–${relay.getRelayNumber()})
  off <n>                   Relay K<n> UIT  (n = 1–${relay.getRelayNumber()})
  mask <getal>              Stel bitmask direct in (bit 0 = K1, 1 = aan)
  demo                      Voer een knipperdemo uit
  help                      Dit overzicht
  quit      (of q)          Afsluiten
`);
}

async function runDemo(relay) {
  const n = relay.getRelayNumber();
  console.log(`Demo: relays één voor één AAN → UIT (${n} relays)`);
  for (let i = 1; i <= n; i++) {
    await relay.relayOn(i);
    console.log(`  K${i} AAN`);
    await sleep(400);
    await relay.relayOff(i);
    console.log(`  K${i} UIT`);
    await sleep(150);
  }
  console.log('Demo klaar.');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
