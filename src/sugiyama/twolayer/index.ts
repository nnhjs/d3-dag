/**
 * A two layer (order) operator is any function that complies with the
 * {@link Operator} interface.  This function must rearrange the oder of the bottom
 * layer to minimize the number of crossings.
 *
 * There are three built in decrossing operators, which are all constructed in
 * a fluent fashion:
 * - {@link "sugiyama/twolayer/opt" | Optimal}
 * - {@link "sugiyama/twolayer/median" | Median}
 * - {@link "sugiyama/twolayer/mean" | Mean}
 *
 * @module
 */
import { DagNode } from "../../dag/node";
import { DummyNode } from "../dummy";

export interface Operator<NodeType extends DagNode> {
  (
    topLayer: (NodeType | DummyNode)[],
    bottomLayer: (NodeType | DummyNode)[]
  ): void;
}
