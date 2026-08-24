export interface InochiParameter {
  name: string;
  dimensions: 1 | 2;
  min: [number, number];
  max: [number, number];
  defaults: [number, number];
}

export interface InochiAvatarModel {
  characterId: string;
  assetId: string;
  displayName: string;
  filename: string;
  modelUrl: string;
  updatedAt: string;
  parameters: InochiParameter[];
  emotionParameters: InochiParameter[];
}

export interface InochiAvatarStatus {
  runtime: {
    available: boolean;
    version: string;
    wasmUrl: string;
  };
  avatar: InochiAvatarModel | null;
}

export interface LiveAvatarControlCapabilities {
  parameters: InochiParameter[];
}

export interface LiveAvatarParameterValue {
  name: string;
  value: number;
  y?: number;
}

export interface LiveAvatarControlCue {
  reset?: boolean;
  parameters?: LiveAvatarParameterValue[];
}
