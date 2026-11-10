import React from 'react'

interface PentoneLogoProps {
  className?: string
  size?: number
}

export const PentoneLogo: React.FC<PentoneLogoProps> = ({ className = 'w-5 h-5 sm:w-6 sm:h-6', size = 24 }) => {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform duration-200 hover:scale-105 ${className}`}
      aria-label="Pentone Logo"
    >
      <defs>
        <linearGradient id="pentoneBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#005447" />
          <stop offset="50%" stopColor="#00382E" />
          <stop offset="100%" stopColor="#171816" />
        </linearGradient>
        <linearGradient id="pentoneMint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8DF4DF" />
          <stop offset="100%" stopColor="#67E2C8" />
        </linearGradient>
        <filter id="pentoneGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#67E2C8" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Squircle Background Badge */}
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="13"
        fill="url(#pentoneBg)"
        stroke="#67E2C8"
        strokeOpacity="0.4"
        strokeWidth="1.5"
      />

      {/* Subtle Inner Accent Ring */}
      <rect
        x="4.5"
        y="4.5"
        width="39"
        height="39"
        rx="10.5"
        stroke="#F5F1E7"
        strokeOpacity="0.08"
        strokeWidth="1"
      />

      {/* Geometric Stylized 'P' Mark */}
      <path
        d="M17 13.5H25.5C29.6421 13.5 33 16.8579 33 21C33 25.1421 29.6421 28.5 25.5 28.5H22V34.5H17V13.5Z"
        fill="url(#pentoneMint)"
        filter="url(#pentoneGlow)"
      />

      {/* Inner Cutout Hole for 'P' */}
      <path
        d="M22 18H25C26.6569 18 28 19.3431 28 21C28 22.6569 26.6569 24 25 24H22V18Z"
        fill="#00382E"
      />

      {/* Neural Core Dot / Cognitive Node */}
      <circle
        cx="25"
        cy="21"
        r="2"
        fill="#E9D2FF"
      />
    </svg>
  )
}
