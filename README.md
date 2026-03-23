# USB Relay - Node.js drivers (macOS / Linux / Windows)

Node.js implementaties voor een USB relayboard van dcttech (VID `0x16c0`, PID `0x05df`).

## Beschikbare versies

- `v1_HID (only mac)`: oude HID-only aanpak
- `v2_USB (cross platform)`: oudere cross-platform USB-versie
- `v3_USB (cross platform)`: actuele versie, ES modules + opgeschoonde OOP-structuur

## Aanbevolen: v3 gebruiken

```bash
cd "v3_USB (cross platform)"
npm install
```

## v3 scripts

```bash
npm start
npm test
npm run scan
```

- `npm start`: start interactieve CLI app
- `npm test`: draait het diagnose/test script met control transfers
- `npm run scan`: toont gedetecteerde relay devices

## v3 structuur

```text
v3_USB (cross platform)/
  package.json
  src/
    app.js                 # CLI app
    usbrelay/
      UsbRelay.js          # OOP class + device logic
      index.js             # publieke module-entry voor usbrelay
  scripts/
    test-relay.js          # hardware diagnose/test script
```

## Structuur

`index.js` is de publieke ingang van de relay-module. 

In `package.json`:

- `main` wijst naar `src/app.js` (de uitvoerbare app)
- `exports` wijst naar `./src/usbrelay/index.js` (de herbruikbare module-API)

## Gebruik in eigen code (v3)

```js
import { UsbRelay } from './src/usbrelay/index.js';

async function main() {
  const relay = new UsbRelay(8);
  await relay.open();

  await relay.relayOn(1);
  await relay.relayOff(1);
  await relay.allOff();

  console.log(relay.getState());
  await relay.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## Opmerkingen per platform

- macOS/Linux: werkt via `usb` controlTransfer (libusb backend)
- Windows: gebruik libusbK via Zadig voor dit type board

## Troubleshooting (kort)

1. Controleer dat het board zichtbaar is op USB niveau.
2. Controleer VID/PID: `16c0:05df`.
3. Gebruik `npm run scan` om te zien of Node het board vindt.
4. Op Windows: controleer de gekoppelde driver met Zadig.
