# @usb-relay/api

Express API for the USB relay workspace.

## Endpoints

- `GET /api/health`
- `GET /api/device`
- `POST /api/device/connect`
- `POST /api/device/disconnect`
- `GET /api/relays/state`
- `POST /api/relays/state`
- `POST /api/relays/:relayNumber/on`
- `POST /api/relays/:relayNumber/off`
- `POST /api/relays/all/on`
- `POST /api/relays/all/off`

The API uses a single relay service instance so commands are serialized before they hit the USB device.