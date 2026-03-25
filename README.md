# USB Relay Workspace

This workspace separates the USB relay solution into three independently usable parts:

- `@usb-relay/lib`: reusable Node.js library for USB relay hardware access
- `@usb-relay/api`: Express API that exposes the relay over HTTP
- `@usb-relay/web`: Vite + React frontend that talks to the API

The structure keeps hardware access, backend orchestration, and frontend UI isolated so each layer can evolve or be deployed independently.

## Workspace Layout

```text
packages/
  usbrelay-lib/   Reusable USB/HID relay library
  usbrelay-api/   Express HTTP API around the library
  usbrelay-web/   Vite + React client
scripts/
  dev.mjs         Starts API and web app together
```

## Requirements

- Node.js 20+
- Supported USB relay board using VID/PID `16c0:05df`
- On Windows: Zadig driver setup for the USB relay device

## Install

```bash
npm install
```

## Development

Start API and frontend together:

```bash
npm run dev
```

Run only the API:

```bash
npm run dev:api
```

Run only the frontend:

```bash
npm run dev:web
```

Scan for connected devices through the library package:

```bash
npm run scan
```

Run the hardware diagnostics script:

```bash
npm run test:hardware
```

## Default Ports

- API: `http://localhost:3000`
- Frontend: `http://localhost:5173`

The Vite dev server proxies `/api/*` requests to the Express API.

## Environment

The API package supports these environment variables:

- `PORT`: API port, default `3000`
- `RELAY_COUNT`: relay count, default `8`
- `API_CORS_ORIGIN`: allowed frontend origin, default `http://localhost:5173`

## Notes

- The hardware protocol remains in the library package only.
- The API serializes relay commands through a single service instance.
- The frontend never touches native USB dependencies directly.