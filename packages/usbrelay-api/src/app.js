import cors from "cors";
import express from "express";

import { env } from "./config/env.js";
import { createRelayRouter } from "./routes/relayRoutes.js";
import { RelayService } from "./services/RelayService.js";

export function createApp() {
  const app = express();
  const relayService = new RelayService({ relayCount: env.relayCount });

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.use("/api", createRelayRouter(relayService));

  app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "Unknown error";
    const statusCode = /Cannot find USB relay board|Relay number must be between/i.test(message) ? 400 : 500;
    res.status(statusCode).json({ ok: false, error: message });
  });

  return app;
}