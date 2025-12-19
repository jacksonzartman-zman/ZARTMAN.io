declare module "occt-import-js" {
  export type OcctImportMesh = {
    attributes?: {
      position?: { array: ArrayLike<number> };
      normal?: { array: ArrayLike<number> };
    };
    index?: { array: ArrayLike<number> };
  };

  export type ReadStepResult = {
    success: boolean;
    meshes: OcctImportMesh[];
  };

  export type OcctImportModule = {
    ReadStepFile: (bytes: Uint8Array, params: any) => ReadStepResult;
  };

  export default function occtImportJs(options?: {
    locateFile?: (path: string) => string;
  }): Promise<OcctImportModule>;
}

