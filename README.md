# USB Relay - Node.js drivers (macOS / Linux / Windows)

Node.js implementations for a dcttech USB relay board (VID `0x16c0`, PID `0x05df`).

## Hardware scope

This project was developed and tested specifically with **USBRelay8** hardware.

- Vendor page: https://www.seeit.fr/
- Purchased from RS: https://benl.rs-online.com/web/p/communication-wireless-development-tools/2864068

Datasheet location in this repository:

- `Datasheet/A700000011182296.pdf`

Other relay variants may work, but USBRelay8 is the validated target for this codebase.


## Available versions

- `v1_HID_only_mac`: legacy HID-only approach
- `v2_USB_cross_platform`: older cross-platform USB version
- `v3_USB_cross_platform`: current version, ES modules + cleaned OOP structure

## Recommended: use v3

```bash
cd "v3_USB_cross_platform"
npm install
```

## v3 scripts

```bash
npm start
npm test
npm run scan
```

- `npm start`: runs the interactive CLI app
- `npm test`: runs the hardware diagnostics script with control transfers
- `npm run scan`: lists detected relay devices

## v3 structure

```text
v3_USB_cross_platform/
  package.json
  src/
    app.js                 # CLI app
    usbrelay/
      UsbRelay.js          # OOP class + device logic
      index.js             # public module entry for usbrelay
  scripts/
    test-relay.js          # hardware diagnostics/test script
```

## Module entry points

`index.js` is the public entry point for the relay module.

In `package.json`:

- `main` points to `src/app.js` (the executable app)
- `exports` points to `./src/usbrelay/index.js` (the reusable module API)

## Use in your own code (v3)

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

## Platform notes

- macOS/Linux: uses `usb` controlTransfer (libusb backend)
- Windows: use libusbK via Zadig for this board type

## Troubleshooting

1. Verify that the board is visible on the USB bus.
2. Verify VID/PID: `16c0:05df`.
3. Run `npm run scan` to check whether Node can find the board.
4. On Windows, verify the assigned driver with Zadig.