import React, { useId } from 'react';

export default function BrandThinkingLogo({ className = '' }: { className?: string }) {
  const uniqueId = useId().replace(/:/g, '');
  const gradId = `sharedGrad-${uniqueId}`;
  const maskId = `brandMask-${uniqueId}`;

  return (
    <svg
      width="130"
      height="30"
      viewBox="0 0 130 30"
      xmlns="http://www.w3.org/2000/svg"
      className={`select-none ${className}`}
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="0"
          y1="0"
          x2="130"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#d96b43" />
          <stop offset="0.4" stopColor="#d96b43" />
          <stop offset="0.5" stopColor="var(--logo-bg-shade, #fafaf7)" />
          <stop offset="0.6" stopColor="#d96b43" />
          <stop offset="1" stopColor="#d96b43" />
          <animate
            attributeName="x1"
            from="-130"
            to="130"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="x2"
            from="0"
            to="260"
            dur="2s"
            repeatCount="indefinite"
          />
        </linearGradient>

        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="130" height="30">
          {/* Soup Bowl Logo (Full icon with steam, spoon, and bowl body) */}
          <g
            transform="translate(0, 2) scale(0.25)"
            stroke="white"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Steam Waves */}
            <path d="M32 38 C30 31, 35 27, 31 18" strokeWidth="6" fill="none" />
            <path d="M45 38 C43 31, 48 27, 44 18" strokeWidth="6" fill="none" />

            {/* Spoon Handle */}
            <line x1="56" y1="42" x2="78" y2="20" strokeWidth="9" />

            {/* Bowl Body */}
            <path d="M22 48 C22 68, 34 80, 50 80 C66 80, 78 68, 78 48 Z" fill="white" stroke="none" />
          </g>

          {/* Scaled-down sour.ai text */}
          <text
            x="30"
            y="21"
            fill="white"
            fontSize="20"
            fontFamily="'Instrument Serif', 'Newsreader', Georgia, serif"
          >
            sour.ai
          </text>
        </mask>
      </defs>

      {/* Single rect filled with shared gradient masked across both bowl & text */}
      <rect
        x="0"
        y="0"
        width="130"
        height="30"
        fill={`url(#${gradId})`}
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
