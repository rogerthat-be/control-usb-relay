# USB Relay - Node.js wrapper for Seeit USBB-RELAY08

Node.js implementations for the Seeit USBB-RELAY08 Relay Control Card Module (a dcttech USB relay board)

![USB Relay Board](./_assets/board.webp)


This project was developed and tested specifically with **USBRelay8** hardware.

- Vendor page: https://www.seeit.fr/
- Purchased from RS: https://benl.rs-online.com/web/p/communication-wireless-development-tools/2864068

Datasheet location in this repository:

- `Datasheet/A700000011182296.pdf`

Other relay variants may work, but USBRelay8 is the validated target for this codebase.

## Repo structure

```text
  _deprecated/              # old/legacy files
  src/
    app.js                 # CLI app
    usbrelay/
      UsbRelay.js          # OOP class + device logic
      index.js             # public module entry for usbrelay
  scripts/
    test-relay.js          # hardware diagnostics/test script
  package.json
```

## Install

```bash
npm install
```

### MacOS setup

No need to install any drivers.
macOS: uses `node-hid` backend by default

### Windows setup

For Windows, run the Zadig driver steps before using this project.

Zadig download: <https://zadig.akeo.ie/>

Tested setup:
- `libusb-win32` in Zadig

Also likely to work (not tested)
- `libusbK` in Zadig

**Installation steps:**
1. Connect the USB relay board.
2. Open Zadig as Administrator.
3. Enable `Options -> List All Devices`.
4. Select the relay device (**USBRelay8** / VID `16c0` PID `05df`).
5. Choose `libusb-win32` as target driver
6. Click `Replace Driver` (or `Install Driver`).
7. Reconnect the board and run `npm run scan`.

## Scripts

```bash
npm start
npm test
npm run scan
```

- `npm start`: runs the interactive CLI app
- `npm test`: runs the hardware diagnostics script with control transfers
- `npm run scan`: lists detected relay devices


## How to use

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

## Troubleshooting

1. Verify that the board is visible on the USB bus.
2. Verify VID/PID: `16c0:05df`.
3. Run `npm run scan` to check whether Node can find the board.
4. On Windows, verify Zadig driver assignment (`libusb-win32` tested, `libusbK` likely).