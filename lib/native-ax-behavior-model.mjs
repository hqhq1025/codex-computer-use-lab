const CHANGE_RANK = Object.freeze({
  none: 0,
  remove: 1,
  insert: 2,
  update: 3
});

export const REFETCH_IDENTITY_FIELDS = Object.freeze([
  "role",
  "subrole",
  "roleDescription",
  "title",
  "description",
  "value",
  "valueDescription",
  "placeholderValue",
  "help",
  "identifier",
  "url"
]);

export function assignRootElementIds(tree) {
  let nextId = 0;
  visitDepthFirst(tree, (node) => {
    node.elementID = nextId;
    nextId += 1;
  });
  return tree;
}

export function appendRevisionElementIds(oldTree, newTree) {
  const changes = diffRenderTrees(oldTree, newTree);
  const oldIds = [];
  visitDepthFirst(oldTree, (node) => {
    if (Number.isInteger(node.elementID)) {
      oldIds.push(node.elementID);
    }
  });
  let nextId = oldIds.length === 0 ? 0 : Math.max(...oldIds) + 1;
  visitDepthFirst(newTree, (node) => {
    if (!Number.isInteger(node.elementID)) {
      node.elementID = nextId;
      nextId += 1;
    }
  });
  return {
    changes,
    tree: newTree
  };
}

export function diffRenderTrees(oldTree, newTree) {
  const changes = [];
  diffMatchedNode(oldTree, newTree, [], changes);
  return sortChanges(changes);
}

export function sortChanges(changes) {
  return [...changes].sort((left, right) => {
    const pathOrder = compareIndexPaths(left.path, right.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    return CHANGE_RANK[left.kind] - CHANGE_RANK[right.kind];
  });
}

export function compressRemovedElementIds(ids) {
  const sorted = [...new Set(ids)].sort((left, right) => left - right);
  const ranges = [];
  for (const id of sorted) {
    const current = ranges.at(-1);
    if (current && id === current.end + 1) {
      current.end = id;
    } else {
      ranges.push({ start: id, end: id });
    }
  }
  return ranges;
}

export function formatRemovedElementIds(ids) {
  const ranges = compressRemovedElementIds(ids);
  const values = ranges.map(({ start, end }) =>
    start === end ? String(start) : `${start}-${end}`
  );
  return `Removed element IDs: ${values.join(", ")}`;
}

export function chooseDiffPresentation({
  diffLineCount,
  effectiveChangeCount,
  fullLineCount,
  ignoreDifferenceLineBudget = false,
  removedSummaryLineCount = 0
}) {
  if (effectiveChangeCount === 0) {
    return "no-change";
  }
  if (
    !ignoreDifferenceLineBudget &&
    (removedSummaryLineCount > fullLineCount ||
      diffLineCount > fullLineCount)
  ) {
    return "full";
  }
  return "diff";
}

export function equivalentForRefetch(
  left,
  right,
  { ignoreValueChange = false } = {}
) {
  return REFETCH_IDENTITY_FIELDS.every((field) => {
    if (field === "value" && ignoreValueChange) {
      return true;
    }
    return Object.is(left?.[field] ?? null, right?.[field] ?? null);
  });
}

export function resolveStaleRefetch({
  ignoreValueChange = false,
  newCandidates,
  oldCandidates,
  original
}) {
  const oldMatches = oldCandidates.filter((candidate) =>
    equivalentForRefetch(original, candidate, { ignoreValueChange: false })
  );
  if (oldMatches.length !== 1) {
    return oldMatches.length > 1 ? "ambiguous-before" : "missing-before";
  }

  const newMatches = newCandidates.filter((candidate) =>
    equivalentForRefetch(original, candidate, { ignoreValueChange })
  );
  if (newMatches.length === 0) {
    return "no-longer-valid";
  }
  if (newMatches.length > 1) {
    return "ambiguous-after";
  }
  return "success";
}

function diffMatchedNode(oldNode, newNode, path, changes) {
  if (oldNode.id !== newNode.id) {
    changes.push({ kind: "remove", path, node: oldNode });
    changes.push({ kind: "insert", path, node: newNode });
    return;
  }

  newNode.elementID = oldNode.elementID;
  changes.push({
    kind: oldNode.text === newNode.text ? "none" : "update",
    path,
    node: newNode
  });
  diffSiblingLists(
    oldNode.children ?? [],
    newNode.children ?? [],
    path,
    changes
  );
}

function diffSiblingLists(oldChildren, newChildren, parentPath, changes) {
  const oldById = groupById(oldChildren);
  const newById = groupById(newChildren);
  const matchedOld = new Set();
  const matchedNew = new Set();

  for (let newIndex = 0; newIndex < newChildren.length; newIndex += 1) {
    const newNode = newChildren[newIndex];
    const oldIndexes = oldById.get(newNode.id) ?? [];
    const oldIndex = oldIndexes.find((index) => !matchedOld.has(index));
    if (oldIndex == null) {
      continue;
    }
    matchedOld.add(oldIndex);
    matchedNew.add(newIndex);
    diffMatchedNode(
      oldChildren[oldIndex],
      newNode,
      [...parentPath, newIndex],
      changes
    );
  }

  for (let oldIndex = 0; oldIndex < oldChildren.length; oldIndex += 1) {
    if (!matchedOld.has(oldIndex)) {
      changes.push({
        kind: "remove",
        path: [...parentPath, oldIndex],
        node: oldChildren[oldIndex]
      });
    }
  }
  for (let newIndex = 0; newIndex < newChildren.length; newIndex += 1) {
    if (!matchedNew.has(newIndex)) {
      changes.push({
        kind: "insert",
        path: [...parentPath, newIndex],
        node: newChildren[newIndex]
      });
    }
  }

  void newById;
}

function groupById(nodes) {
  const grouped = new Map();
  for (let index = 0; index < nodes.length; index += 1) {
    const id = nodes[index].id;
    const indexes = grouped.get(id) ?? [];
    indexes.push(index);
    grouped.set(id, indexes);
  }
  return grouped;
}

function compareIndexPaths(left, right) {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return left.length - right.length;
}

function visitDepthFirst(node, callback) {
  callback(node);
  for (const child of node.children ?? []) {
    visitDepthFirst(child, callback);
  }
}
