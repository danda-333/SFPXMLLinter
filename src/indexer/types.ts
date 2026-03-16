import * as vscode from "vscode";
import type { ParsedDocumentFacts } from "./xmlFacts";

export type IndexedSymbolKind =
  | "control"
  | "button"
  | "section"
  | "actionShareCode"
  | "controlShareCode"
  | "buttonShareCode";

export interface IndexedSymbolProvenanceProvider {
  sourceKind: "using" | "include" | "placeholder" | "primitive";
  featureKey?: string;
  contributionName?: string;
  primitiveKey?: string;
  templateName?: string;
  confidence: "exact";
}

export interface IndexedForm {
  ident: string;
  uri: vscode.Uri;
  controls: Set<string>;
  buttons: Set<string>;
  sections: Set<string>;
  formIdentLocation: vscode.Location;
  controlDefinitions: Map<string, vscode.Location>;
  buttonDefinitions: Map<string, vscode.Location>;
  sectionDefinitions: Map<string, vscode.Location>;
}

export interface IndexedComponent {
  key: string;
  uri: vscode.Uri;
  contributions: Set<string>;
  componentLocation: vscode.Location;
  contributionDefinitions: Map<string, vscode.Location>;
  contributionSummaries: Map<string, IndexedComponentContributionSummary>;
  formControlDefinitions: Map<string, vscode.Location>;
  formButtonDefinitions: Map<string, vscode.Location>;
  formSectionDefinitions: Map<string, vscode.Location>;
  workflowActionShareCodeDefinitions: Map<string, vscode.Location>;
  workflowControlShareCodeDefinitions: Map<string, vscode.Location>;
  workflowButtonShareCodeDefinitions: Map<string, vscode.Location>;
  workflowButtonShareCodeButtonIdents: Map<string, Set<string>>;
}

export interface IndexedComponentContributionSummary {
  contributionName: string;
  root?: "form" | "workflow" | "other";
  rootExpression?: string;
  insert?: string;
  targetXPath?: string;
  allowMultipleInserts?: boolean;
  hasContent: boolean;
  formControlCount: number;
  formButtonCount: number;
  formSectionCount: number;
  workflowActionShareCodeCount: number;
  workflowControlShareCodeCount: number;
  workflowButtonShareCodeCount: number;
  formControlIdents: Set<string>;
  formButtonIdents: Set<string>;
  formSectionIdents: Set<string>;
  workflowReferencedActionShareCodeIdents: Set<string>;
  workflowActionShareCodeIdents: Set<string>;
  workflowControlShareCodeIdents: Set<string>;
  workflowButtonShareCodeIdents: Set<string>;
  requiredParamNames: Set<string>;
  primitiveUsageCountByKey: Map<string, number>;
  primitiveTemplateNamesByKey: Map<string, Set<string>>;
  primitiveProvidedParamNamesByKey: Map<string, Set<string>>;
  primitiveProvidedSlotNamesByKey: Map<string, Set<string>>;
}

export interface WorkspaceIndex {
  formsByIdent: Map<string, IndexedForm>;
  componentsByKey: Map<string, IndexedComponent>;
  componentKeysByBaseName: Map<string, Set<string>>;
  formIdentReferenceLocations: Map<string, vscode.Location[]>;
  mappingFormIdentReferenceLocations: Map<string, vscode.Location[]>;
  controlReferenceLocationsByFormIdent: Map<string, Map<string, vscode.Location[]>>;
  buttonReferenceLocationsByFormIdent: Map<string, Map<string, vscode.Location[]>>;
  sectionReferenceLocationsByFormIdent: Map<string, Map<string, vscode.Location[]>>;
  componentReferenceLocationsByKey: Map<string, vscode.Location[]>;
  componentContributionReferenceLocationsByKey: Map<string, Map<string, vscode.Location[]>>;
  componentUsageFormIdentsByKey: Map<string, Set<string>>;
  componentContributionUsageFormIdentsByKey: Map<string, Map<string, Set<string>>>;
  parsedFactsByUri: Map<string, ParsedDocumentFacts>;
  hasIgnoreDirectiveByUri: Map<string, boolean>;
  builtSymbolProvidersByUri?: Map<string, Map<string, IndexedSymbolProvenanceProvider[]>>;
  formsReady: boolean;
  componentsReady: boolean;
  fullReady: boolean;
}
