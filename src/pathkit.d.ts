// Minimal types for Google's Skia PathOps (pathkit-wasm).
declare module 'pathkit-wasm/bin/pathkit.js' {
  interface SkPath {
    op(other: SkPath, op: unknown): SkPath | null;
    stroke(opts: { width: number; cap?: unknown; join?: unknown; miter_limit?: number }): SkPath | null;
    simplify(): SkPath | null;
    transform(...m: number[]): SkPath;
    copy(): SkPath;
    toSVGString(): string;
    getFillTypeString(): 'nonzero' | 'evenodd';
    setFillType(type: unknown): void;
    computeTightBounds(): { fLeft: number; fTop: number; fRight: number; fBottom: number };
    delete(): void;
  }
  interface PathKit {
    NewPath(): SkPath;
    FromSVGString(d: string): SkPath | null;
    MakeFromOp(a: SkPath, b: SkPath, op: unknown): SkPath | null;
    PathOp: { UNION: unknown; DIFFERENCE: unknown; INTERSECT: unknown; XOR: unknown };
    StrokeCap: { BUTT: unknown; ROUND: unknown; SQUARE: unknown };
    StrokeJoin: { MITER: unknown; ROUND: unknown; BEVEL: unknown };
    FillType: { WINDING: unknown; EVENODD: unknown };
  }
  export type { PathKit, SkPath };
  const PathKitInit: (opts?: { locateFile?: (file: string) => string }) => Promise<PathKit>;
  export default PathKitInit;
}
