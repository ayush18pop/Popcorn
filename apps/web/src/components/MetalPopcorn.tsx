import { LiquidMetal } from "@paper-design/shaders-react";

/** The popcorn mark in liquid chrome (Paper shaders). Greyscale, so it stays in the palette. */
export function MetalPopcorn({ size = 280, speed = 0.6 }: { size?: number; speed?: number }) {
  return (
    <LiquidMetal
      width={size}
      height={size}
      image="/popcorn-mask.svg"
      colorBack="#00000000"
      colorTint="#ffffff"
      repetition={3}
      softness={0.3}
      shiftRed={0}
      shiftBlue={0}
      distortion={0.08}
      contour={0.4}
      angle={70}
      speed={speed}
      scale={0.9}
      fit="contain"
    />
  );
}
