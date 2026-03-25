const DEFAULT_RELAY_COUNT = 8;
const ALLOWED_RELAY_COUNTS = new Set([2, 4, 8]);

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const relayCount = toInt(process.env.RELAY_COUNT, DEFAULT_RELAY_COUNT);

export const env = {
  port: toInt(process.env.PORT, 3000),
  relayCount: ALLOWED_RELAY_COUNTS.has(relayCount) ? relayCount : DEFAULT_RELAY_COUNT,
  corsOrigin: process.env.API_CORS_ORIGIN || "http://localhost:5173",
};