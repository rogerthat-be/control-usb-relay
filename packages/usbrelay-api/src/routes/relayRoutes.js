import express from "express";

function toRelayNumber(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error("Relay number must be a valid integer.");
  }
  return parsed;
}

export function createRelayRouter(relayService) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "usbrelay-api" });
  });

  router.get("/device", (req, res) => {
    res.json({
      ok: true,
      connection: { connected: Boolean(relayService.relay) },
      discovery: relayService.getDeviceSummary(),
    });
  });

  router.post("/device/connect", async (req, res, next) => {
    try {
      const snapshot = await relayService.connect(Boolean(req.body?.forceReconnect));
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/device/disconnect", async (_req, res, next) => {
    try {
      const snapshot = await relayService.disconnect();
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.get("/relays/state", async (_req, res, next) => {
    try {
      const snapshot = await relayService.getState();
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/relays/state", async (req, res, next) => {
    try {
      const payload = req.body?.mask ?? req.body?.relays;
      if (payload === undefined) {
        throw new Error("Provide either body.mask or body.relays.");
      }
      const snapshot = await relayService.setState(payload);
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/relays/:relayNumber/on", async (req, res, next) => {
    try {
      const relayNumber = toRelayNumber(req.params.relayNumber);
      const snapshot = await relayService.setRelay(relayNumber, true);
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/relays/:relayNumber/off", async (req, res, next) => {
    try {
      const relayNumber = toRelayNumber(req.params.relayNumber);
      const snapshot = await relayService.setRelay(relayNumber, false);
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/relays/all/on", async (_req, res, next) => {
    try {
      const snapshot = await relayService.setAll(true);
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/relays/all/off", async (_req, res, next) => {
    try {
      const snapshot = await relayService.setAll(false);
      res.json({ ok: true, data: snapshot });
    } catch (err) {
      next(err);
    }
  });

  return router;
}