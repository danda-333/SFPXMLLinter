import * as vscode from "vscode";
import { CompositionPrimitiveQuickFixPayload } from "./primitiveQuickFix";

export function createPrimitiveQuickFixPayload(
  uri: vscode.Uri,
  kind: "param" | "slot" | "unknown" | "cycle",
  name: string,
  primitiveKey: string
): CompositionPrimitiveQuickFixPayload {
  return {
    uri,
    kind,
    name,
    primitiveKey
  };
}
