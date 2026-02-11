import * as vscode from "vscode";

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
  sections: Set<string>;
  componentLocation: vscode.Location;
  sectionDefinitions: Map<string, vscode.Location>;
  formControlDefinitions: Map<string, vscode.Location>;
  formButtonDefinitions: Map<string, vscode.Location>;
  formSectionDefinitions: Map<string, vscode.Location>;
  workflowControlShareCodeDefinitions: Map<string, vscode.Location>;
  workflowButtonShareCodeDefinitions: Map<string, vscode.Location>;
  workflowButtonShareCodeButtonIdents: Map<string, Set<string>>;
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
  componentSectionReferenceLocationsByKey: Map<string, Map<string, vscode.Location[]>>;
  componentUsageFormIdentsByKey: Map<string, Set<string>>;
  componentSectionUsageFormIdentsByKey: Map<string, Map<string, Set<string>>>;
  formsReady: boolean;
  componentsReady: boolean;
  fullReady: boolean;
}
