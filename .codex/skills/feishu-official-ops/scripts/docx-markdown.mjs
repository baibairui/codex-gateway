export function buildDocxChildrenFromConvertPayload(payload) {
  const firstLevelBlockIds = Array.isArray(payload?.first_level_block_ids)
    ? payload.first_level_block_ids.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const blockMap = new Map();

  for (const block of blocks) {
    const blockId = typeof block?.block_id === 'string' ? block.block_id.trim() : '';
    if (!blockId) {
      continue;
    }
    blockMap.set(blockId, block);
  }

  return firstLevelBlockIds.map((blockId) => materializeBlock(blockId, blockMap, new Set()));
}

export function buildDocxCreateNodes(children) {
  return (Array.isArray(children) ? children : []).map((child) => {
    const nestedChildren = Array.isArray(child?.children) ? child.children : [];
    const { children: ignored, ...block } = child;
    void ignored;
    return {
      block,
      children: buildDocxCreateNodes(nestedChildren),
    };
  });
}

function materializeBlock(blockId, blockMap, chain) {
  if (chain.has(blockId)) {
    throw new Error(`docx convert returned cyclic block tree at ${blockId}`);
  }
  const block = blockMap.get(blockId);
  if (!block) {
    throw new Error(`docx convert returned missing block: ${blockId}`);
  }

  const nextChain = new Set(chain);
  nextChain.add(blockId);

  const result = {};
  for (const [key, value] of Object.entries(block)) {
    if (value === undefined || key === 'block_id' || key === 'parent_id' || key === 'children') {
      continue;
    }
    result[key] = value;
  }

  const childIds = Array.isArray(block.children) ? block.children : [];
  const children = childIds.map((childId) => materializeBlock(childId, blockMap, nextChain));
  if (children.length > 0) {
    result.children = children;
  }

  return result;
}
