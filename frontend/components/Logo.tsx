export default function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-700 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[62%] w-[62%]"
        aria-hidden
      >
        {/* three arrows fanning out from one source */}
        <g transform="rotate(-33 5 12)">
          <path d="M5 12h11M12.5 8.5 16 12l-3.5 3.5" />
        </g>
        <path d="M5 12h11M12.5 8.5 16 12l-3.5 3.5" />
        <g transform="rotate(33 5 12)">
          <path d="M5 12h11M12.5 8.5 16 12l-3.5 3.5" />
        </g>
      </svg>
    </span>
  );
}
