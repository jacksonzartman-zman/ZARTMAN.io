export type LoadResult<TData> = {
  ok: boolean;
  data: TData | null;
  error?: string | null;
};

export type MutationResult<TData = undefined> = {
  ok: boolean;
  data?: TData | null;
  error?: string | null;
};
