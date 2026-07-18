import type { FilterQuery, Model } from 'mongoose';

// Fixes a real bug carried in from the old backend: every list endpoint used
// to fetch the ENTIRE matching result set just to count it for pagination
// (confirmed across all six modules — see 01-migration-plan.md §3). Mongo's
// countDocuments() counts without touching the underlying documents at all,
// so this is both correct and dramatically cheaper as the data grows.
export const paginate = async <T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  page: number,
  size: number,
  sort: Record<string, 1 | -1>
) => {
  const skip = (page - 1) * size;
  const [records, totalRecords] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(size).lean(),
    model.countDocuments(filter),
  ]);

  return {
    records,
    totalRecords,
    totalPages: Math.max(1, Math.ceil(totalRecords / size)),
    currentPage: page,
  };
};
