// Geometry matches the masters in docs/brand/logo.
const EMBER = "#FF6A3D";

type Variant = "icon" | "symbol" | "lockup";

function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <rect width="256" height="256" rx="56" fill="#0E1016" />
      <g transform="translate(29.4 27.6) scale(0.77)">
        <path
          fill="#FFFFFF"
          fillRule="evenodd"
          d="M159 55H199A45 45 0 0 1 199 145H159A45 45 0 0 1 159 55ZM159 85H199A15 15 0 0 1 199 115H159A15 15 0 0 1 159 85Z"
        />
        <path fill="#FFFFFF" d="M22 132V136A67 67 0 0 0 156 136V131A15 15 0 0 0 126 131V136A37 37 0 0 1 52 136V132Z" />
        <circle fill={EMBER} cx="37" cy="116" r="25" />
      </g>
    </svg>
  );
}

function Symbol({ size }: { size: number }) {
  const small = size < 48;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      {small ? (
        <>
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M159 55H199A45 45 0 0 1 199 145H159A45 45 0 0 1 159 55ZM159 85H199A15 15 0 0 1 199 115H159A15 15 0 0 1 159 85Z"
          />
          <path fill="currentColor" d="M22 132V136A67 67 0 0 0 156 136V131A15 15 0 0 0 126 131V136A37 37 0 0 1 52 136V132Z" />
          <circle fill={EMBER} cx="37" cy="116" r="25" />
        </>
      ) : (
        <>
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M159 58H199A42 42 0 0 1 199 142H159A42 42 0 0 1 159 58ZM159 82H199A18 18 0 0 1 199 118H159A18 18 0 0 1 159 82Z"
          />
          <path fill="currentColor" d="M25 132V136A64 64 0 0 0 153 136V129A12 12 0 0 0 129 129V136A40 40 0 0 1 49 136V132Z" />
          <circle fill={EMBER} cx="37" cy="118" r="22" />
        </>
      )}
    </svg>
  );
}

function Lockup({ size }: { size: number }) {
  return (
    <svg height={size} width={(size * 1127) / 256} viewBox="0 0 1127 256" role="img" aria-label="Open Sila">
      <g transform="translate(-2.25 -19.4) scale(1.15)">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M159 58H199A42 42 0 0 1 199 142H159A42 42 0 0 1 159 58ZM159 82H199A18 18 0 0 1 199 118H159A18 18 0 0 1 159 82Z"
        />
        <path fill="currentColor" d="M25 132V136A64 64 0 0 0 153 136V129A12 12 0 0 0 129 129V136A40 40 0 0 1 49 136V132Z" />
        <circle fill={EMBER} cx="37" cy="118" r="22" />
      </g>
      <g transform="translate(330 81)">
        <g fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="48" cy="48" r="39" />
          <path d="M127 136V9M127 48A39 39 0 1 0 205 48A39 39 0 1 0 127 48" />
          <path d="M243 48H321A39 39 0 1 0 309.6 75.6" />
          <path d="M361 87V9M361 48A39 39 0 0 1 439 48V87" />
          <path d="M570.4 21.8A28 19.5 0 1 0 545 48A28 19.5 0 1 1 519.6 74.2" />
          <path d="M615 87V9" />
          <path d="M657 87V-48" />
          <path d="M773 9V87M773 48A39 39 0 1 0 695 48A39 39 0 1 0 773 48" />
        </g>
        <circle fill={EMBER} cx="615" cy="-30" r="12" />
      </g>
    </svg>
  );
}

export function EmptyWire() {
  return (
    <svg className="empty-wire" width="220" height="96" viewBox="0 0 560 256" aria-hidden="true">
      <circle className="empty-wire-open" cx="226" cy="118" r="16" />
      <path className="empty-wire-lead" d="M248 118H300" />
      <g transform="translate(300 0)">
        <path
          className="empty-wire-mark"
          fillRule="evenodd"
          d="M159 58H199A42 42 0 0 1 199 142H159A42 42 0 0 1 159 58ZM159 82H199A18 18 0 0 1 199 118H159A18 18 0 0 1 159 82Z"
        />
        <path className="empty-wire-mark" d="M25 132V136A64 64 0 0 0 153 136V129A12 12 0 0 0 129 129V136A40 40 0 0 1 49 136V132Z" />
        <circle fill={EMBER} cx="37" cy="118" r="22" />
      </g>
    </svg>
  );
}

export function Logo({ size = 28, variant = "icon" }: { size?: number; variant?: Variant }) {
  if (variant === "symbol") return <Symbol size={size} />;
  if (variant === "lockup") return <Lockup size={size} />;
  return <Icon size={size} />;
}
