import React from 'react';

interface PixelBowlIconProps {
  size?: number;
  className?: string;
}

// 12x8 pixel-art grid of a soup bowl with steam, drawn as hard-edged blocks
// so it reads as deliberately "pixelated" rather than a smoothed vector icon.
const GRID: number[][] = [
  [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
  [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
];

export const PixelBowlIcon: React.FC<PixelBowlIconProps> = ({ size = 48, className = '' }) => {
  const cell = 4;
  const cols = GRID[0].length;
  const rows = GRID.length;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      shapeRendering="crispEdges"
      style={{ imageRendering: 'pixelated' }}
      className={`select-none text-[#d96b43] ${className}`}
    >
      {GRID.map((row, y) =>
        row.map((val, x) => {
          if (!val) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell}
              height={cell}
              fill="currentColor"
              opacity={val === 1 ? 0.55 : 1}
            />
          );
        })
      )}
    </svg>
  );
};

export default PixelBowlIcon;
