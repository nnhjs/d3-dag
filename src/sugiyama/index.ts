/**
 * A {@link SugiyamaOperator} for computing a layered layout of a dag
 *
 * @packageDocumentation
 */
import { Dag, DagNode } from "../dag";
import { js, Up } from "../utils";
import { CoordNodeSizeAccessor, CoordOperator } from "./coord";
import {
  DefaultSimplexOperator as DefaultCoord,
  simplex as coordSimplex,
} from "./coord/simplex";
import { DecrossOperator } from "./decross";
import {
  DefaultTwoLayerOperator as DefaultTwoLayer,
  twoLayer,
} from "./decross/two-layer";
import { LayeringOperator } from "./layering";
import {
  DefaultSimplexOperator as DefaultLayering,
  simplex as layerSimplex,
} from "./layering/simplex";
import {
  scaleLayers,
  sugify,
  SugiNode,
  unsugify,
  verifyCoordAssignment,
} from "./utils";

/**
 * The return from calling {@link SugiyamaOperator}
 *
 * This is the final width and height of the laid out dag.
 */
export interface SugiyamaInfo {
  /** total width after layout */
  width: number;
  /** total height after layout */
  height: number;
}

/**
 * An accessor for computing the size of a node in the layout
 *
 * If `node` is omitted, the returned size is the size of a "dummy node", a
 * piece of a long edge that can curve around other nodes. This accessor must
 * return a tuple of non-negative numbers corresponding to the node's *width*
 * and *height*. Since this is a layered layout, a node's height is effectively
 * the maximum height of all nodes in the same layer.
 *
 * If you need more control over the size of dummy nodes, see
 * {@link SugiNodeSizeAccessor}.
 *
 * This accessor will only be called once for each node.
 */
export interface NodeSizeAccessor<NodeDatum = never, LinkDatum = never> {
  (node?: DagNode<NodeDatum, LinkDatum>): readonly [number, number];
}

/**
 * An accessor for computing the size of a node in the layout
 *
 * This interface exposes a full {@link SugiNode}, which has more information
 * about dummy nodes available in case different dummy nodes should have
 * different sizes.
 *
 * For most cases {@link NodeSizeAccessor} should be enough.
 */
export interface SugiNodeSizeAccessor<NodeDatum = never, LinkDatum = never> {
  (node: SugiNode<NodeDatum, LinkDatum>): readonly [number, number];
}

/** the node datum of a node size accessor */
export type NsNodeDatum<NS extends NodeSizeAccessor> =
  NS extends NodeSizeAccessor<infer N, never> ? N : never;
/** the link datum of a node size accessor */
export type NsLinkDatum<NS extends NodeSizeAccessor> =
  NS extends NodeSizeAccessor<never, infer L> ? L : never;

/**
 * The effective {@link SugiNodeSizeAccessor} when a normal
 * {@link NodeSizeAccessor} is supplied.
 */
export interface WrappedNodeSizeAccessor<NodeSize extends NodeSizeAccessor>
  extends SugiNodeSizeAccessor<NsNodeDatum<NodeSize>, NsLinkDatum<NodeSize>> {
  /** the underling node size */
  wrapped: NodeSize;
}

/**
 * wrap a {@link NodeSizeAccessor} turning it into an {@link SugiNodeSizeAccessor}
 *
 * Mostly useful for running the steps of {@link sugiyama} independently.
 */
export function wrapNodeSizeAccessor<N, L, NS extends NodeSizeAccessor<N, L>>(
  acc: NS & NodeSizeAccessor<N, L>
): WrappedNodeSizeAccessor<NS> & SugiNodeSizeAccessor<N, L> {
  const empty = acc();
  function sugiNodeSizeAccessor(
    node: SugiNode<N, L>
  ): readonly [number, number] {
    return "node" in node.data ? acc(node.data.node) : empty;
  }
  sugiNodeSizeAccessor.wrapped = acc;
  return sugiNodeSizeAccessor;
}

/** sugiyama operators */
export interface Operators<N = never, L = never> {
  /** layering operator */
  layering: LayeringOperator<N, L>;
  /** decross operator */
  decross: DecrossOperator<N, L>;
  /** coord operator */
  coord: CoordOperator<N, L>;
  /** sugi node size operator */
  sugiNodeSize: SugiNodeSizeAccessor<N, L>;
  /** node size operator */
  nodeSize: NodeSizeAccessor<N, L> | null;
}

/** the typed dag of a set of operators */
export type OpsDag<Ops extends Operators> = Ops extends Operators<
  infer N,
  infer L
>
  ? Dag<N, L>
  : Dag<never, never>;

/**
 * The operator used to layout a {@link Dag} using the sugiyama layered method.
 *
 * The algorithm is roughly comprised of three steps:
 * 1. {@link LayeringOperator | layering} - in this step, every node is
 *    assigned a non-negative integer later such that children are guaranteed
 *    to have higher layers than their parents. (modified with {@link layering})
 * 2. {@link DecrossOperator | decrossing} - in the step, nodes in each layer
 *    are reordered to minimize the number of crossings. (modified with {@link
 *    decross})
 * 3. {@link CoordOperator | coordinate assignment} - in the step, the
 *    nodes are assigned x and y coordinates that respect their layer, layer
 *    ordering, and size. (modified with {@link coord} and {@link nodeSize})
 *
 * The algorithm is based off ideas presented in K. Sugiyama et al. [1979], but
 * described by {@link http://www.it.usyd.edu.au/~shhong/fab.pdf | S. Hong}.
 * The sugiyama layout can be configured with different algorithms for each
 * stage of the layout. For each stage there should be adecuate choices for
 * methods that balance speed and quality for your desired layout. In the
 * absence of those, any function that meets the interface for that stage is
 * valid.
 *
 * Create with {@link sugiyama}.
 *
 * @remarks
 *
 * If one wants even more control over the algorithm, each step is broken down
 * in the source code and can be achieved by calling an exported utility
 * function. If one wants to call certain pieces incrementally, or adjust how
 * things are called, it's recommended to look at the source and call each
 * component function successively.
 *
 * @example
 *
 * <img alt="Sugiyama example" src="media://sugi-simplex-opt-quad.png" width="400">
 *
 * @example
 *
 * ```typescript
 * const data = [["parent", "child"], ...];
 * const create = connect();
 * const dag = create(data);
 * const layout = sugiyama();
 * const { width, height } = layout(dag);
 * for (const node of dag) {
 *   console.log(node.x, node.y);
 * }
 * ```
 *
 * @example
 *
 * This example highlights tweaking several aspects of dag rendering
 * ```typescript
 * const data = [["parent", "child"], ...];
 * const create = connect();
 * const dag = create(data);
 * const layout = sugiyama()
 *   .nodeSize(n => n === undefined ? [0, 0] : [n.data.id.length, 2])
 *   .coord(greedy());
 * const { width, height } = layout(dag);
 * for (const node of dag) {
 *   console.log(node.x, node.y);
 * }
 * ```
 */
export interface SugiyamaOperator<Ops extends Operators = Operators> {
  /**
   * Layout the {@link Dag} using the currently configured operator. The
   * returned dag nodes will have `x`, `y`, and `value` (layer), assigned. In
   * addition, each link will have `points` assigned to the current layout.
   */
  (dag: OpsDag<Ops>): SugiyamaInfo;

  /**
   * Set the {@link LayeringOperator}. (default: {@link SimplexOperator})
   */
  layering<NewLayering extends LayeringOperator>(
    layer: NewLayering
  ): SugiyamaOperator<
    Up<
      Ops,
      {
        /** new layering */
        layering: NewLayering;
      }
    >
  >;
  /**
   * Get the current {@link LayeringOperator}.
   */
  layering(): Ops["layering"];

  /**
   * Set the {@link DecrossOperator}. (default: {@link TwoLayerOperator})
   */
  decross<NewDecross extends DecrossOperator>(
    dec: NewDecross
  ): SugiyamaOperator<
    Up<
      Ops,
      {
        /** new decross */
        decross: NewDecross;
      }
    >
  >;
  /**
   * Get the current {@link DecrossOperator}.
   */
  decross(): Ops["decross"];

  /**
   * Set the {@link CoordOperator}. (default: {@link QuadOperator})
   */
  coord<NewCoord extends CoordOperator>(
    crd: NewCoord
  ): SugiyamaOperator<
    Up<
      Ops,
      {
        /** new coord */
        coord: NewCoord;
      }
    >
  >;
  /**
   * Get the current {@link CoordOperator}.
   */
  coord(): Ops["coord"];

  /**
   * Sets the sugiyama layout's size to the specified two-element array of
   * numbers [ *width*, *height* ].  When `size` is non-null the dag will be
   * shrunk or expanded to fit in the size, keeping all distances proportional.
   * If it's null, the {@link nodeSize} parameters will be respected as
   * coordinate sizes. (default: null)
   */
  size(sz: readonly [number, number] | null): SugiyamaOperator<Ops>;
  /**
   * Get the current layout size.
   */
  size(): null | readonly [number, number];

  /**
   * Sets the {@link NodeSizeAccessor}, which assigns how much space is
   * necessary between nodes. (defaults to [1, 1] for normal nodes and [0, 0]
   * for dummy nodes [undefined values]).
   *
   * @remarks
   *
   * When overriding, make sure you handle the case where the node is
   * undefined. Failure to do so may result in unexpected layouts.
   */
  nodeSize<NewNodeSize extends NodeSizeAccessor>(
    acc: NewNodeSize
  ): SugiyamaOperator<
    Up<
      Ops,
      {
        /** new node size */
        nodeSize: NewNodeSize;
        /** new wrapped sugi node size */
        sugiNodeSize: WrappedNodeSizeAccessor<NewNodeSize>;
      }
    >
  >;
  /**
   * Get the current node size
   *
   * If a {@link SugiNodeSizeAccessor} was specified, this will be null.
   */
  nodeSize(): Ops["nodeSize"];

  /**
   * Sets this sugiyama layout's {@link SugiNodeSizeAccessor}.
   *
   * This is effectively a more powerful api above the standard
   * {@link NodeSizeAccessor}, and is only necessary if different dummy nodes
   * need different sizes.
   */
  sugiNodeSize<NewSugiNodeSize extends SugiNodeSizeAccessor>(
    sz: NewSugiNodeSize
  ): SugiyamaOperator<
    Up<
      Ops,
      {
        /** new sugi node size */
        sugiNodeSize: NewSugiNodeSize;
        /** no node size */
        nodeSize: null;
      }
    >
  >;
  /**
   * Get the current sugi node size, or a {@link WrappedNodeSizeAccessor |
   * wrapped version} if {@link nodeSize} was specified.
   */
  sugiNodeSize(): Ops["sugiNodeSize"];
}

/**
 * Verify, cache, and split the results of an {@link SugiNodeSizeAccessor} into
 * an x and y {@link CoordNodeSizeAccessor}.
 *
 * This allows you to split an {@link SugiNodeSizeAccessor} into independent x
 * and y accessors, while also caching the result to prevent potentially
 * expensive computation from being duplicated.
 *
 * The only real reason to use this would be to run the steps of {@link
 * sugiyama} independently.
 */
export function cachedNodeSize<N, L>(
  nodeSize: SugiNodeSizeAccessor<N, L>,
  check: boolean = true
): readonly [CoordNodeSizeAccessor<N, L>, CoordNodeSizeAccessor<N, L>] {
  const cache = new Map<SugiNode, readonly [number, number]>();

  function cached(node: SugiNode<N, L>): readonly [number, number] {
    let val = cache.get(node);
    if (val === undefined) {
      val = nodeSize(node);
      const [width, height] = val;
      if (check && (width < 0 || height < 0)) {
        throw new Error(
          js`all node sizes must be non-negative, but got width ${width} and height ${height} for node '${node}'`
        );
      }
      cache.set(node, val);
    }
    return val;
  }

  const cachedX = (node: SugiNode<N, L>): number => cached(node)[0];
  const cachedY = (node: SugiNode<N, L>): number => cached(node)[1];

  return [cachedX, cachedY];
}

/**
 * Given layers and node heights, assign y coordinates.
 *
 * This is only exported so that each step of {@link sugiyama} can be executed
 * independently or controlled. In the future it may make sense to make
 * vertical coordinates part of the sugiyama operators.
 */
export function coordVertical<N, L>(
  layers: readonly (readonly SugiNode<N, L>[])[],
  size: CoordNodeSizeAccessor<N, L>
): number {
  let height = 0;
  for (const layer of layers) {
    const layerHeight = Math.max(...layer.map(size));
    for (const node of layer) {
      node.y = height + layerHeight / 2;
    }
    height += layerHeight;
  }
  return height;
}

/** @internal */
function buildOperator<N, L, Ops extends Operators<N, L>>(
  options: Ops &
    Operators<N, L> & {
      size: readonly [number, number] | null;
    }
): SugiyamaOperator<Ops> {
  function sugiyama(dag: Dag<N, L>): SugiyamaInfo {
    // compute layers
    options.layering(dag);

    // create layers
    const layers = sugify(dag);

    // cache and split node sizes
    const [xSize, ySize] = cachedNodeSize(options.sugiNodeSize);

    // assign y
    let height = coordVertical(layers, ySize);
    if (height <= 0) {
      throw new Error(
        "at least one node must have positive height, but total height was zero"
      );
    }

    // minimize edge crossings
    options.decross(layers);

    // assign coordinates
    let width = options.coord(layers, xSize);

    // verify
    verifyCoordAssignment(layers, width);

    // scale x
    if (options.size !== null) {
      const [newWidth, newHeight] = options.size;
      scaleLayers(layers, newWidth / width, newHeight / height);
      width = newWidth;
      height = newHeight;
    }

    // Update original dag with values
    unsugify(layers);

    // layout info
    return { width, height };
  }

  function layering(): Ops["layering"];
  function layering<NL extends LayeringOperator>(
    layer: NL
  ): SugiyamaOperator<Up<Ops, { layering: NL }>>;
  function layering<NL extends LayeringOperator>(
    layer?: NL
  ): Ops["layering"] | SugiyamaOperator<Up<Ops, { layering: NL }>> {
    if (layer === undefined) {
      return options.layering;
    } else {
      const { layering: _, ...rest } = options;
      return buildOperator({
        ...rest,
        layering: layer,
      });
    }
  }
  sugiyama.layering = layering;

  function decross(): Ops["decross"];
  function decross<ND extends DecrossOperator>(
    dec: ND
  ): SugiyamaOperator<Up<Ops, { decross: ND }>>;
  function decross<ND extends DecrossOperator>(
    dec?: ND
  ): Ops["decross"] | SugiyamaOperator<Up<Ops, { decross: ND }>> {
    if (dec === undefined) {
      return options.decross;
    } else {
      const { decross: _, ...rest } = options;
      return buildOperator({
        ...rest,
        decross: dec,
      });
    }
  }
  sugiyama.decross = decross;

  function coord(): Ops["coord"];
  function coord<NC extends CoordOperator>(
    crd: NC
  ): SugiyamaOperator<Up<Ops, { coord: NC }>>;
  function coord<NC extends CoordOperator>(
    crd?: NC
  ): Ops["coord"] | SugiyamaOperator<Up<Ops, { coord: NC }>> {
    if (crd === undefined) {
      return options.coord;
    } else {
      const { coord: _, ...rest } = options;
      return buildOperator({
        ...rest,
        coord: crd,
      });
    }
  }
  sugiyama.coord = coord;

  function size(): null | readonly [number, number];
  function size(sz: readonly [number, number]): SugiyamaOperator<Ops>;
  function size(
    sz?: readonly [number, number] | null
  ): SugiyamaOperator<Ops> | null | readonly [number, number] {
    if (sz !== undefined) {
      return buildOperator({ ...options, size: sz });
    } else {
      return options.size;
    }
  }
  sugiyama.size = size;

  function nodeSize(): Ops["nodeSize"];
  function nodeSize<NNS extends NodeSizeAccessor>(
    sz: NNS
  ): SugiyamaOperator<
    Up<Ops, { nodeSize: NNS; sugiNodeSize: WrappedNodeSizeAccessor<NNS> }>
  >;
  function nodeSize<NNS extends NodeSizeAccessor>(
    sz?: NNS
  ):
    | SugiyamaOperator<
        Up<
          Ops,
          {
            nodeSize: NNS;
            sugiNodeSize: WrappedNodeSizeAccessor<NNS>;
          }
        >
      >
    | Ops["nodeSize"] {
    if (sz !== undefined) {
      const { nodeSize: _, sugiNodeSize: __, ...rest } = options;
      return buildOperator({
        ...rest,
        nodeSize: sz,
        sugiNodeSize: wrapNodeSizeAccessor(sz),
      });
    } else {
      return options.nodeSize;
    }
  }
  sugiyama.nodeSize = nodeSize;

  function sugiNodeSize(): Ops["sugiNodeSize"];
  function sugiNodeSize<NSNS extends SugiNodeSizeAccessor>(
    sz: NSNS
  ): SugiyamaOperator<Up<Ops, { sugiNodeSize: NSNS; nodeSize: null }>>;
  function sugiNodeSize<NSNS extends SugiNodeSizeAccessor>(
    sz?: NSNS
  ):
    | SugiyamaOperator<Up<Ops, { sugiNodeSize: NSNS; nodeSize: null }>>
    | Ops["sugiNodeSize"] {
    if (sz !== undefined) {
      const { sugiNodeSize: _, nodeSize: __, ...rest } = options;
      return buildOperator({
        ...rest,
        sugiNodeSize: sz,
        nodeSize: null,
      });
    } else {
      return options.sugiNodeSize;
    }
  }
  sugiyama.sugiNodeSize = sugiNodeSize;

  return sugiyama;
}

/** default node size */
export type DefaultNodeSizeAccessor = NodeSizeAccessor<unknown, unknown>;

/** @internal */
function defaultNodeSize(node?: DagNode): [number, number] {
  return [+(node !== undefined), 1];
}

/** default sugiyama operator */
export type DefaultSugiyamaOperator = SugiyamaOperator<{
  /** default layering */
  layering: DefaultLayering;
  /** default decross */
  decross: DefaultTwoLayer;
  /** default coord */
  coord: DefaultCoord;
  /** wrapped default node size */
  sugiNodeSize: WrappedNodeSizeAccessor<DefaultNodeSizeAccessor>;
  /** default node size */
  nodeSize: DefaultNodeSizeAccessor;
}>;

/**
 * Construct a new {@link SugiyamaOperator} with the default settings.
 *
 * @example
 * ```typescript
 * const dag = hierarchy()(...);
 * const layout = sugiyama().nodeSize(d => d === undefined ? [0, 0] : [d.width, d.height]);
 * layout(dag);
 * for (const node of dag) {
 *   console.log(node.x, node.y);
 * }
 * ```
 */
export function sugiyama(...args: never[]): DefaultSugiyamaOperator {
  if (args.length) {
    throw new Error(
      `got arguments to sugiyama(${args}), but constructor takes no arguments.`
    );
  } else {
    return buildOperator({
      layering: layerSimplex(),
      decross: twoLayer(),
      coord: coordSimplex(),
      size: null,
      nodeSize: defaultNodeSize,
      sugiNodeSize: wrapNodeSizeAccessor(defaultNodeSize),
    });
  }
}
