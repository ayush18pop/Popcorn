/** A big pixel numeral in the chrome gradient, with a slow light sweep. Crisp at any size, no shader. */
export function MetalNumeral({ text, height = 150 }: { text: string; height?: number }) {
  return (
    <span className="numeral-sheen font-pixel block leading-none" style={{ fontSize: height }} aria-label={text}>
      {text}
    </span>
  );
}
