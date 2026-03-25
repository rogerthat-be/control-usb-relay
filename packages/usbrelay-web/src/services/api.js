async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload.data ?? payload;
}

export function getHealth() {
  return request("/api/health");
}

export function getDeviceInfo() {
  return request("/api/device");
}

export function connectDevice(forceReconnect = false) {
  return request("/api/device/connect", {
    method: "POST",
    body: JSON.stringify({ forceReconnect }),
  });
}

export function disconnectDevice() {
  return request("/api/device/disconnect", { method: "POST" });
}

export function getRelayState() {
  return request("/api/relays/state");
}

export function setRelay(relayNumber, enabled) {
  return request(`/api/relays/${relayNumber}/${enabled ? "on" : "off"}`, {
    method: "POST",
  });
}

export function setAll(enabled) {
  return request(`/api/relays/all/${enabled ? "on" : "off"}`, {
    method: "POST",
  });
}