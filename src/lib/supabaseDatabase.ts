// Minimal Supabase Database typing.
//
// This intentionally allows any table/view/function name so we still get the
// typed SupabaseClient overloads (avoiding `.update()` becoming `never`) without
// requiring a full generated schema type to exist in-repo.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GenericTable = {
  Row: Record<string, any>;
  Insert: Record<string, any>;
  Update: Record<string, any>;
  Relationships: any[];
};

type GenericView = {
  Row: Record<string, any>;
};

type GenericFunction = {
  Args: Record<string, any>;
  Returns: any;
};

export type Database = {
  public: {
    Tables: Record<string, GenericTable>;
    Views: Record<string, GenericView>;
    Functions: Record<string, GenericFunction>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, any>;
  };
};

