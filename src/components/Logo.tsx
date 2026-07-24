import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = '', size = 32 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`select-none text-[#d96b43] ${className}`}
      id="custom-soup-logo"
    >
      {/* Dynamic minimalist bowl with steam and spoon angled right */}
      <g
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Steam Waves (Left) */}
        <path 
          d="M32 38 C30 31, 35 27, 31 18" 
          strokeWidth="6" 
          fill="none" 
        />
        <path 
          d="M45 38 C43 31, 48 27, 44 18" 
          strokeWidth="6" 
          fill="none" 
        />

        {/* Spoon Handle (Right) */}
        <line 
          x1="56" 
          y1="42" 
          x2="78" 
          y2="20" 
          strokeWidth="9" 
        />

        {/* Bowl Body (Bottom Hemisphere) */}
        <path 
          d="M22 48 C22 68, 34 80, 50 80 C66 80, 78 68, 78 48 Z" 
          fill="currentColor"
          stroke="none"
        />
      </g>
    </svg>
  );
}
