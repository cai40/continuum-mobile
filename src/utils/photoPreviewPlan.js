/** @typedef {import('./photoCleanupPreview').PhotoPreviewItem & { score?: number, manual?: boolean }} PlanFavoriteItem */

/**
 * @typedef {Object} PhotoPreviewPlan
 * @property {import('./photoCleanupPreview').PhotoPreviewItem[]} trashItems
 * @property {Set<string>} trashIds
 * @property {PlanFavoriteItem[]} favoriteItems
 * @property {Set<string>} favoriteIds
 * @property {Record<string, number>} scores
 * @property {number} hiddenTrashCount
 */

function sortFavoriteItems(items) {
  return [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** @param {import('./photoAlbumCleanup').CleanupReport} report */
export function createPreviewPlan(report) {
  const allItems = report?.trash?.allItems || [];
  const legacyItems = [
    ...(report?.trash?.duplicates?.items || []),
    ...(report?.trash?.codingScreenshots?.items || []),
  ];
  const trashItems = allItems.length ? allItems : legacyItems;
  const allIds = report?.trash?.allIds?.length
    ? report.trash.allIds
    : trashItems.map((item) => item.id);

  const scores = { ...(report?.favorites?.scores || {}) };
  const ranked = report?.favorites?.rankedItems || report?.favorites?.items || [];
  const favoriteItems = sortFavoriteItems(
    ranked.map((item) => ({
      ...item,
      score: scores[item.id] ?? item.score ?? 0,
    })),
  );

  return {
    trashItems: [...trashItems],
    trashIds: new Set(allIds),
    favoriteItems,
    favoriteIds: new Set(favoriteItems.map((item) => item.id)),
    scores,
    hiddenTrashCount: report?.trash?.hiddenTrashCount || 0,
  };
}

/** @param {PhotoPreviewPlan} plan */
export function clonePreviewPlan(plan) {
  return {
    trashItems: [...plan.trashItems],
    trashIds: new Set(plan.trashIds),
    favoriteItems: [...plan.favoriteItems],
    favoriteIds: new Set(plan.favoriteIds),
    scores: { ...plan.scores },
    hiddenTrashCount: plan.hiddenTrashCount || 0,
  };
}

/** @param {PhotoPreviewPlan} plan @param {string} id */
export function removeFromTrashPlan(plan, id) {
  const next = clonePreviewPlan(plan);
  next.trashIds.delete(id);
  next.trashItems = next.trashItems.filter((item) => item.id !== id);
  return next;
}

/** @param {PhotoPreviewPlan} plan @param {import('./photoCleanupPreview').PhotoPreviewItem} item */
export function favoriteFromTrashPlan(plan, item) {
  if (!item?.id || plan.favoriteIds.has(item.id)) {
    return removeFromTrashPlan(plan, item.id);
  }
  const next = removeFromTrashPlan(plan, item.id);
  const score = next.scores[item.id] ?? 0;
  next.favoriteIds.add(item.id);
  next.favoriteItems = sortFavoriteItems([
    ...next.favoriteItems,
    { ...item, score, manual: true },
  ]);
  return next;
}

/** @param {PhotoPreviewPlan} plan @param {string} id */
export function removeFromFavoritesPlan(plan, id) {
  const next = clonePreviewPlan(plan);
  next.favoriteIds.delete(id);
  next.favoriteItems = next.favoriteItems.filter((item) => item.id !== id);
  return next;
}

/** @param {PhotoPreviewPlan} plan */
export function planSummary(plan) {
  return {
    trashCount: plan.trashIds.size,
    favoriteCount: plan.favoriteIds.size,
    hiddenTrashCount: plan.hiddenTrashCount || 0,
  };
}

export function formatScore(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(2);
}
