import type { CustomEndpointAdapter, CustomInspectorField } from "../types/contracts";
import { get, post, put } from "./core";

export const extensionClient = {
  extensionGetState: () => get<{ customInspectorFields: CustomInspectorField[]; customEndpointAdapters: CustomEndpointAdapter[] }>("/extensions"),
  extensionListInspectorFields: () => get<CustomInspectorField[]>("/extensions/inspector-fields"),
  extensionSaveInspectorFields: (fields: CustomInspectorField[]) => put<CustomInspectorField[]>("/extensions/inspector-fields", { fields }),
  extensionValidateInspectorFields: (fields: CustomInspectorField[]) => post<CustomInspectorField[]>("/extensions/inspector-fields/validate", { fields }),
  extensionListEndpointAdapters: () => get<CustomEndpointAdapter[]>("/extensions/endpoint-adapters"),
  extensionSaveEndpointAdapters: (adapters: CustomEndpointAdapter[]) => put<CustomEndpointAdapter[]>("/extensions/endpoint-adapters", { adapters }),
  extensionValidateEndpointAdapters: (adapters: CustomEndpointAdapter[]) => post<CustomEndpointAdapter[]>("/extensions/endpoint-adapters/validate", { adapters })
};
