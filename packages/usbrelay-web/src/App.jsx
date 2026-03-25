import { useEffect, useState } from "react";

import RelayCard from "./components/RelayCard.jsx";
import {
  connectDevice,
  disconnectDevice,
  getDeviceInfo,
  getHealth,
  getRelayState,
  setAll,
  setRelay,
} from "./services/api.js";

const POLL_INTERVAL_MS = 5000;

function getRelayEntries(snapshot) {
  if (!snapshot?.state) {
    return [];
  }

  return Object.entries(snapshot.state).map(([key, value]) => ({
    index: Number.parseInt(key.replace(/\D/g, ""), 10),
    enabled: Boolean(value),
  }));
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [device, setDevice] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRelay, setPendingRelay] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  async function refresh() {
    try {
      setError("");
      const [healthData, deviceData] = await Promise.all([getHealth(), getDeviceInfo()]);
      setHealth(healthData);
      setDevice(deviceData);
      const relayState = await getRelayState();
      setSnapshot(relayState);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!autoRefresh || !snapshot?.connected) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [autoRefresh, snapshot?.connected]);

  async function handleConnect(forceReconnect = false) {
    try {
      setBusy(true);
      setError("");
      const nextSnapshot = await connectDevice(forceReconnect);
      setSnapshot(nextSnapshot);
      setDevice(await getDeviceInfo());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    try {
      setBusy(true);
      setError("");
      await disconnectDevice();
      setSnapshot(null);
      setDevice(await getDeviceInfo());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(index, enabled) {
    try {
      setPendingRelay(index);
      setError("");
      const nextSnapshot = await setRelay(index, enabled);
      setSnapshot(nextSnapshot);
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingRelay(null);
    }
  }

  async function handleSetAll(enabled) {
    try {
      setBusy(true);
      setError("");
      const nextSnapshot = await setAll(enabled);
      setSnapshot(nextSnapshot);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const relays = getRelayEntries(snapshot);
  const connected = Boolean(snapshot?.connected);
  const discoveredCount = device?.discovery?.count ?? 0;

  return (
    <div className="page-shell">
      <div className="ambient ambient--left" />
      <div className="ambient ambient--right" />
      <main className="dashboard">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Relay Board Workspace</p>
            <h1>Relay control</h1>
            <p className="hero-copy">
              This User Interface talks to the Express service. The service owns the hardware connection and
              serializes commands before they reach the USB relay library.
            </p>
          </div>
          <div className="hero-stats">
            <div className="stat-box">
              <span>API</span>
              <strong>{health?.ok ? "Online" : "Unknown"}</strong>
            </div>
            <div className="stat-box">
              <span>Device</span>
              <strong>{connected ? "Connected" : "Disconnected"}</strong>
            </div>
            <div className="stat-box">
              <span>Discovered</span>
              <strong>{discoveredCount}</strong>
            </div>
          </div>
        </section>

        <section className="panel-grid">
          <article className="panel panel--status">
            <div className="panel__header">
              <h2>Connection</h2>
              <div className="header-controls">
                <label className="toggle-row" htmlFor="auto-refresh">
                  <input
                    id="auto-refresh"
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.target.checked)}
                  />
                  Auto refresh ({POLL_INTERVAL_MS / 1000}s)
                </label>
                <button type="button" className="ghost-button" onClick={refresh} disabled={busy}>
                  Refresh
                </button>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Serial</dt>
                <dd>{snapshot?.serial || "Not connected"}</dd>
              </div>
              <div>
                <dt>Relay count</dt>
                <dd>{snapshot?.relayCount || "-"}</dd>
              </div>
              <div>
                <dt>State mask</dt>
                <dd>{snapshot?.stateMask ?? "-"}</dd>
              </div>
            </dl>

            <div className="button-row">
              <button type="button" className="solid-button" onClick={() => handleConnect(false)} disabled={busy}>
                Connect
              </button>
              <button type="button" className="ghost-button" onClick={() => handleConnect(true)} disabled={busy}>
                Reconnect
              </button>
              <button type="button" className="ghost-button" onClick={handleDisconnect} disabled={busy || !connected}>
                Disconnect
              </button>
            </div>

            {error ? <p className="error-banner">{error}</p> : null}
          </article>

          <article className="panel panel--actions">
            <div className="panel__header">
              <h2>Bulk actions</h2>
            </div>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={() => handleSetAll(true)} disabled={busy || !connected}>
                All on
              </button>
              <button type="button" className="ghost-button" onClick={() => handleSetAll(false)} disabled={busy || !connected}>
                All off
              </button>
            </div>
            <p className="support-copy">
              Every action flows through the API queue, so overlapping clicks do not send concurrent
              USB writes to the device.
            </p>
          </article>
        </section>

        <section className="relay-section">
          <div className="panel__header">
            <h2>Relay board</h2>
            <span className="subtle-copy">Toggle individual outputs</span>
          </div>
          <div className="relay-grid">
            {relays.map((relay) => (
              <RelayCard
                key={relay.index}
                index={relay.index}
                enabled={relay.enabled}
                pending={pendingRelay === relay.index}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}