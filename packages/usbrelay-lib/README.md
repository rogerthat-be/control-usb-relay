# @usb-relay/lib

Reusable Node.js library for USB relay hardware.

## Usage

```js
import { UsbRelay, findDevices } from "@usb-relay/lib";

const devices = findDevices();
const relay = new UsbRelay(8);

await relay.open();
await relay.relayOn(1);
await relay.close();
```

## Notes

- Native dependencies live only in this package.
- The API package consumes this library.
- The React frontend should never import this package directly.