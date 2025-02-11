import { center } from "../../../src/sugiyama/coord/center";
import { createLayers, nodeSize } from "../utils";

test("center() works for square like layout", () => {
  const layers = createLayers([[[0, 1]], [[0], [0]], [[]]]);
  const [[head], [left, right], [tail]] = layers;
  center()(layers, nodeSize);

  expect(head.x).toBeCloseTo(1.0, 7);
  expect(left.x).toBeCloseTo(0.5, 7);
  expect(right.x).toBeCloseTo(1.5, 7);
  expect(tail.x).toBeCloseTo(1.0, 7);
});

test("center() fails passing an arg to constructor", () => {
  expect(() => center(null as never)).toThrow("got arguments to center");
});

test("center() throws for zero width", () => {
  const layers = createLayers([[[]]]);
  expect(() => center()(layers, () => 0)).toThrow(
    "must assign nonzero width to at least one node"
  );
});
