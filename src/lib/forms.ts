export function getFormString(
  formData: FormData,
  key: string,
): string | null | undefined {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

export function serializeActionError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  return error ?? null;
}
