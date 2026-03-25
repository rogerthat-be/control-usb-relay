export default function RelayCard({ index, enabled, pending, onToggle }) {
  return (
    <button
      type="button"
      className={`relay-card ${enabled ? "is-on" : "is-off"}`}
      onClick={() => onToggle(index, !enabled)}
      disabled={pending}
    >
      <span className="relay-card__label">Relay {index}</span>
      <span className="relay-card__state">{enabled ? "ON" : "OFF"}</span>
      <span className="relay-card__hint">{pending ? "Working..." : "Click to toggle"}</span>
    </button>
  );
}