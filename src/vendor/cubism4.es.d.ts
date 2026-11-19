import { Container, Ticker } from "pixi.js";
export class Live2DModel extends Container {
  static from(
    url: string,
    options?: Record<string, unknown>,
  ): Promise<Live2DModel>;
  static registerTicker(ticker: typeof Ticker): void;
  anchor: { set(x: number, y?: number): void };
  autoUpdate: boolean;
  internalModel: {
    on(name: string, callback: () => void): void;
    motionManager: { lipSyncIds: string[] };
    coreModel: {
      getModel(): { parameters: { ids: string[] } };
      getParameterIndex(id: string): number;
      getParameterMinimumValue(index: number): number;
      getParameterMaximumValue(index: number): number;
      setParameterValueById(id: string, value: number, weight?: number): void;
    };
  };
  motion(group: string, index?: number, priority?: number): Promise<boolean>;
  expression(name?: string | number): Promise<boolean>;
  destroy(options?: {
    children?: boolean;
    texture?: boolean;
    baseTexture?: boolean;
  }): void;
}
