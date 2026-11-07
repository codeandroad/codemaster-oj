import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/** Shared scholarship symbol; keep the supplied gold artwork in every theme. */
export const ScholarshipIcon = forwardRef<SVGSVGElement, LucideProps>(
  function ScholarshipIcon({ size = 24, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        {...props}
        fill="none"
        stroke="#EFBF04"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v18" />
        <path d="M17 5H9.5a1 1 0 000 7h5a1 1 0 010 7H6" />
      </svg>
    );
  },
);
