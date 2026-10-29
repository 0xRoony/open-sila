const WIRE_LOOP =
  "M159 58H199A42 42 0 0 1 199 142H159A42 42 0 0 1 159 58ZM159 82H199A18 18 0 0 1 199 118H159A18 18 0 0 1 159 82Z";
const WIRE_BOWL = "M25 132V136A64 64 0 0 0 153 136V129A12 12 0 0 0 129 129V136A40 40 0 0 1 49 136V132Z";

export function Loader({ label, size = 56 }: { label?: string; size?: number }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
        <g className="loader-track">
          <path fillRule="evenodd" d={WIRE_LOOP} />
          <path d={WIRE_BOWL} />
        </g>
        <g className="loader-wire">
          <path fillRule="evenodd" d={WIRE_LOOP} />
          <path d={WIRE_BOWL} />
        </g>
        <circle className="loader-port-glow" cx="37" cy="118" r="22" />
        <circle className="loader-port" cx="37" cy="118" r="22" />
      </svg>
      {label && <span className="loader-label">{label}</span>}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card skeleton-card" style={{ animationDelay: `${index * 80}ms` }}>
          <div className="row">
            <span className="skeleton skeleton-icon" />
            <span className="stack skeleton-lines">
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line short" />
            </span>
          </div>
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  );
}
