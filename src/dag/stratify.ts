/**
 * You can rearrange tabularesque data into a {@link Dag} using {@link stratify}, which
 * will create a default {@link StratifyOperator}.
 *
 * @module
 */

import {
  Dag,
  DagNode,
  LayoutChildLink,
  LayoutDagNode,
  LayoutDagRoot
} from "./node";
import { verifyDag, verifyId } from "./verify";

import { js } from "../utils";

/**
 * The interface for getting the node id from data. The function must return an
 * unique id for each piece of data, but the same id if called twice on the
 * same data. Ids cannot contain the null character `'\0'`.
 *
 * `i` will increment in the order nodes are processed.
 */
interface IdOperator<NodeDatum> {
  (d: NodeDatum, i: number): string;
}

/**
 * The interface for getting the parent ids from data. This must return an
 * array of the ids of every parent of this node. `i` will increment in the
 * order nodes are processed.
 */
interface ParentIdsOperator<NodeDatum> {
  (d: NodeDatum, i: number): readonly string[] | undefined;
}

/**
 * The interface for getting the parent ids and link data from the current node
 * data. This must return an array of parent ids coupled with data for the link
 * between this node and the parent id.
 */
interface ParentDataOperator<NodeDatum, LinkDatum> {
  (d: NodeDatum, i: number):
    | readonly (readonly [string, LinkDatum])[]
    | undefined;
}

/**
 * What gets returned by {@link parentData}() when {@link parentIds} is set.
 */
interface WrappedParentIdsOperator<
  NodeDatum,
  ParentIds extends ParentIdsOperator<NodeDatum>
> extends ParentDataOperator<NodeDatum, undefined> {
  (d: NodeDatum, i: number): readonly (readonly [string, undefined])[];
  wrapped: ParentIds;
}

/**
 * What gets returned by {@link parentIds}() when {@link parentData} is set.
 */
interface WrappedParentDataOperator<
  NodeDatum,
  LinkDatum,
  ParentData extends ParentDataOperator<NodeDatum, LinkDatum>
> extends ParentIdsOperator<NodeDatum> {
  (d: NodeDatum, i: number): readonly string[];
  wrapped: ParentData;
}

/**
 * The operator that constructs a {@link Dag} from stratified tabularesque data.
 */
export interface StratifyOperator<
  NodeDatum = unknown,
  LinkDatum = unknown,
  Id extends IdOperator<NodeDatum> = IdOperator<NodeDatum>,
  ParentIds extends ParentIdsOperator<NodeDatum> = ParentIdsOperator<NodeDatum>,
  ParentData extends ParentDataOperator<
    NodeDatum,
    LinkDatum
  > = ParentDataOperator<NodeDatum, LinkDatum>
> {
  /**
   * Construct a dag from the specified `data`. The data should be an array
   * of data elements that contain info about their parents' ids. For example:
   *
   * ```json
   * [
   *   {
   *     "id": "Eve"
   *   },
   *   {
   *     "id": "Cain",
   *     "parentIds": ["Eve"]
   *   },
   *   {
   *     "id": "Seth",
   *     "parentIds": ["Eve"]
   *   },
   *   {
   *     "id": "Enos",
   *     "parentIds": ["Seth"]
   *   },
   *   {
   *     "id": "Noam",
   *     "parentIds": ["Seth"]
   *   },
   *   {
   *     "id": "Abel",
   *     "parentIds": ["Eve"]
   *   },
   *   {
   *     "id": "Awan",
   *     "parentIds": ["Eve"]
   *   },
   *   {
   *     "id": "Enoch",
   *     "parentIds": ["Eve"]
   *   },
   *   {
   *     "id": "Azura",
   *     "parentIds": ["Eve"]
   *   }
   * ]
   * ```
   */
  <N extends NodeDatum>(data: readonly N[]): Dag<N, LinkDatum>;

  /**
   * Sets the id accessor to the given {@link IdOperator} and returns this
   * {@link StratifyOperator}. The default operator is:
   *
   * ```js
   * function id(d) {
   *   return d.id;
   * }
   * ```
   */
  id<NewDatum, NewId extends IdOperator<NewDatum>>(
    id: NewId & IdOperator<NewDatum>
  ): StratifyOperator<
    NodeDatum & NewDatum,
    LinkDatum,
    NewId,
    ParentIds,
    ParentData
  >;
  /**
   * Gets the current id accessor.
   */
  id(): Id;

  /**
   * Sets the parentIds accessor to the given {@link ParentIdsOperator}
   * and returns this {@link StratifyOperator}. The default operator is:
   *
   * ```js
   * function parentIds(d) {
   *   return d.parentIds;
   * }
   * ```
   */
  parentIds<NewDatum, NewParentIds extends ParentIdsOperator<NewDatum>>(
    ids: NewParentIds & ParentIdsOperator<NewDatum>
  ): StratifyOperator<
    NodeDatum & NewDatum,
    undefined,
    Id,
    NewParentIds,
    WrappedParentIdsOperator<NewDatum, NewParentIds>
  >;
  /**
   * Gets the current parent ids accessor.  If {@link parentData} was passed, the
   * returned function will wrap that to just return the ids.
   */
  parentIds(): ParentIds;

  /**
   * Sets the parentData accessor to the given {@link ParentDataOperator} and
   * returns this {@link StratifyOperator}.
   */
  parentData<
    NewDatum,
    NewLinkDatum,
    NewParentData extends ParentDataOperator<NewDatum, NewLinkDatum>
  >(
    data: NewParentData & ParentDataOperator<NewDatum, NewLinkDatum>
  ): StratifyOperator<
    NodeDatum & NewDatum,
    NewLinkDatum,
    Id,
    WrappedParentDataOperator<NewDatum, NewLinkDatum, NewParentData>,
    NewParentData
  >;
  /**
   * Gets the current parentData accessor. If {@link parentIds} was passed, this
   * will wrap that to just return the ids with `undefined` data.
   */
  parentData(): ParentData;
}

/** @internal */
function buildOperator<
  N,
  L,
  Id extends IdOperator<N>,
  ParentIds extends ParentIdsOperator<N>,
  ParentData extends ParentDataOperator<N, L>
>(
  idOp: Id,
  parentIdsOp: ParentIds,
  parentDataOp: ParentData
): StratifyOperator<N, L, Id, ParentIds, ParentData> {
  function stratify<NN extends N>(data: readonly NN[]): Dag<NN, L> {
    if (!data.length) throw new Error("can't stratify empty data");
    const mapping = new Map<
      string,
      [DagNode<NN, L>, readonly (readonly [string, L])[]]
    >();
    for (const [i, datum] of data.entries()) {
      const id = verifyId(idOp(datum, i));
      const pdata = parentDataOp(datum, i) || [];
      const node = new LayoutDagNode<NN, L>(datum);
      if (mapping.has(id)) {
        throw new Error(`found a duplicate id: ${id}`);
      } else {
        mapping.set(id, [node, pdata]);
      }
    }

    const roots: DagNode<NN, L>[] = [];
    for (const [node, pdata] of mapping.values()) {
      for (const [pid, linkData] of pdata) {
        const info = mapping.get(pid);
        if (!info) throw new Error(`missing id: ${pid}`);
        const [par] = info;
        par.dataChildren.push(new LayoutChildLink(node, linkData));
      }
      if (!pdata.length) {
        roots.push(node);
      }
    }

    verifyDag(roots);
    return roots.length > 1 ? new LayoutDagRoot(roots) : roots[0];
  }

  function id(): Id;
  function id<NN, NewId extends IdOperator<NN>>(
    idGet: NewId
  ): StratifyOperator<N & NN, L, NewId, ParentIds, ParentData>;
  function id<NN, NewId extends IdOperator<NN>>(
    idGet?: NewId
  ): Id | StratifyOperator<N & NN, L, NewId, ParentIds, ParentData> {
    if (idGet === undefined) {
      return idOp;
    } else {
      return buildOperator(idGet, parentIdsOp, parentDataOp);
    }
  }
  stratify.id = id;

  function parentData(): ParentData;
  function parentData<NN, NL, NewParentData extends ParentDataOperator<NN, NL>>(
    data: NewParentData
  ): StratifyOperator<
    N & NN,
    NL,
    Id,
    WrappedParentDataOperator<NN, NL, NewParentData>,
    NewParentData
  >;
  function parentData<NN, NL, NewParentData extends ParentDataOperator<NN, NL>>(
    data?: NewParentData
  ):
    | ParentData
    | StratifyOperator<
        N & NN,
        NL,
        Id,
        WrappedParentDataOperator<NN, NL, NewParentData>,
        NewParentData
      > {
    if (data === undefined) {
      return parentDataOp;
    } else {
      return buildOperator(idOp, wrapParentData(data), data);
    }
  }
  stratify.parentData = parentData;

  function parentIds(): ParentIds;
  function parentIds<NN, NewParentIds extends ParentIdsOperator<NN>>(
    ids: NewParentIds
  ): StratifyOperator<
    N & NN,
    undefined,
    Id,
    NewParentIds,
    WrappedParentIdsOperator<NN, NewParentIds>
  >;
  function parentIds<NN, NewParentIds extends ParentIdsOperator<NN>>(
    ids?: NewParentIds
  ):
    | ParentIds
    | StratifyOperator<
        N & NN,
        undefined,
        Id,
        NewParentIds,
        WrappedParentIdsOperator<NN, NewParentIds>
      > {
    if (ids === undefined) {
      return parentIdsOp;
    } else {
      return buildOperator(idOp, ids, wrapParentIds(ids));
    }
  }
  stratify.parentIds = parentIds;

  return stratify;
}

/** @internal */
function wrapParentIds<N, ParentIds extends ParentIdsOperator<N>>(
  parentIds: ParentIds
): WrappedParentIdsOperator<N, ParentIds> {
  function wrapped(d: N, i: number): [string, undefined][] {
    return (parentIds(d, i) || []).map((id) => [id, undefined]);
  }
  wrapped.wrapped = parentIds;
  return wrapped;
}

/** @internal */
function wrapParentData<N, L, ParentData extends ParentDataOperator<N, L>>(
  parentData: ParentData
): WrappedParentDataOperator<N, L, ParentData> {
  function wrapped(d: N, i: number): string[] {
    return (parentData(d, i) || []).map(([id]) => id);
  }
  wrapped.wrapped = parentData;
  return wrapped;
}

/** @internal */
interface HasId {
  id: string;
}

/** @internal */
function hasId(d: unknown): d is HasId {
  try {
    return typeof (d as HasId).id === "string";
  } catch {
    return false;
  }
}

/** @internal */
function defaultId(data: unknown): string {
  if (hasId(data)) {
    return data.id;
  } else {
    throw new Error(
      js`default id function expected datum to have an id field but got '${data}'`
    );
  }
}

/** @internal */
interface HasParentIds {
  parentIds: string[] | undefined;
}

/** @internal */
function hasParentIds(d: unknown): d is HasParentIds {
  try {
    const parentIds = (d as HasParentIds).parentIds;
    return (
      parentIds === undefined ||
      (parentIds instanceof Array &&
        parentIds.every((id) => typeof id === "string"))
    );
  } catch {
    return false;
  }
}

/** @internal */
function defaultParentIds(d: unknown): string[] | undefined {
  if (hasParentIds(d)) {
    return d.parentIds;
  } else {
    throw new Error(
      `default parentIds function expected datum to have a parentIds field but got: ${d}`
    );
  }
}

/**
 * Constructs a new {@link StratifyOperator} with the default settings.
 */
export function stratify(
  ...args: never[]
): StratifyOperator<
  unknown,
  undefined,
  IdOperator<unknown>,
  ParentIdsOperator<unknown>,
  WrappedParentIdsOperator<unknown, ParentIdsOperator<unknown>>
> {
  if (args.length) {
    throw Error(
      `got arguments to stratify(${args}), but constructor takes no aruguments. ` +
        "These were probably meant as data which should be called as stratify()(...)"
    );
  }
  return buildOperator(
    defaultId,
    defaultParentIds,
    wrapParentIds(defaultParentIds)
  );
}
