# USB Relay — Node.js driver (macOS / Linux / Windows)

Node.js-implementatie voor een HID-gebaseerd USB relayboard van dcttech.

## Vereisten

- Node.js ≥ 16
- HID-board met VID `0x16c0` en PID `0x05df`
- macOS: werkt meestal direct via de ingebouwde HID-stack
- Windows: het board moet gekoppeld zijn aan de standaard HID-driver, niet aan WinUSB/libusb/vendor-driver

## Installatie

```bash
npm install
```

## Gebruik — CLI-voorbeeld

```bash
node example.js
```

### Commando's in het menu

| Commando     | Beschrijving                          |
|--------------|---------------------------------------|
| `status`     | Toon status van alle relays           |
| `on`         | Alle relays AAN                       |
| `off`        | Alle relays UIT                       |
| `on 2`       | Relay K2 AAN                          |
| `off 3`      | Relay K3 UIT                          |
| `mask 5`     | Bitmask direct instellen (5 = K1+K3)  |
| `demo`       | Doorloop alle relays één voor één     |
| `quit`       | Afsluiten                             |

## Gebruik — in eigen script

```javascript
const { UsbRelay } = require('./usbrelay');

async function main() {
  const relay = new UsbRelay(8);

  await relay.open();

  console.log(`${relay.getRelayNumber()} relays gedetecteerd`);

  // --- Relays aansturen ---

  // Één relay aan/uit
  await relay.relayOn(1);   // K1 aan
  await relay.relayOff(2);  // K2 uit

  // Meerdere tegelijk via array (index 0 = K1)
  await relay.setState([1, 0, 1, 0, 0, 0, 0, 0]); // K1 en K3 aan

  // Via object (1-gebaseerde sleutelnamen)
  await relay.setState({ K1: true, K3: true });

  // Via bitmask (bit 0 = K1, 1 = aan)
  await relay.setState(0b00000101); // K1 en K3 aan

  // Alles aan/uit
  await relay.allOn();
  await relay.allOff();

  // Status lezen
  console.log(relay.getState());  // { K1: false, K2: false, … }

  await relay.close();
}

main();
```

## HID-detectie testen

```bash
npm run scan
npm run scan:hid
```

`npm run scan` toont relay-boards die door de driver herkend worden.

`npm run scan:hid` toont alle HID-devices die `node-hid` ziet. Handig op Windows als het board niet gevonden wordt.

Als het board wel in Windows Device Manager of USBView staat, maar niet in `npm run scan:hid`, dan gebruikt Windows waarschijnlijk niet de standaard HID-driver voor dit apparaat.

## Windows-problemen

Als macOS werkt maar Windows niet:

1. Open Apparaatbeheer.
2. Zoek het board op onder `Human Interface Devices` of `USB-apparaten`.
3. Controleer de hardware-ID's: `VID_16C0` en `PID_05DF`.
4. Als er een custom driver, `WinUSB`, `libusbK` of vendor-driver aan hangt, wissel terug naar de standaard Windows HID-driver.
5. Test daarna opnieuw met `npm run scan:hid`.

## Protocol samenvatting

| Stap | HID feature report |
|---|---|
| Status lezen | `getFeatureReport(0x01, 8)` |
| Relay AAN | `[0x00, 0xFF, relay, 0, 0, 0, 0, 0, 0]` |
| Relay UIT | `[0x00, 0xFD, relay, 0, 0, 0, 0, 0, 0]` |

Bitmask: bit 0 = K1 … bit 7 = K8, `1` = AAN.

## Bestanden

```
USB-RELAY(NodeJS)/
  usbrelay.js      ← HID-driver + device detection
  example.js       ← interactief CLI-voorbeeld
  package.json
  README.md
```
