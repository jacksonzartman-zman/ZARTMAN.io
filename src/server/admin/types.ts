export type AdminLoaderResult<TData> = {
  ok: boolean;
  data: TData;
  error: string | null;
};
