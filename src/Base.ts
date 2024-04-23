import { version } from "./lib/version";

export type BaseOptions = {
  debug?: boolean | ((message: string, ...args: any[]) => void);
};

export abstract class Base {
  private static nextInstanceID = 0;
  private instanceID: number;

  protected logDebugMessages: boolean;
  protected logger: (message: string, ...args: any[]) => void = console.log;

  constructor(config: BaseOptions = {}) {
    this.instanceID = Base.nextInstanceID;
    Base.nextInstanceID += 1;
    this.logDebugMessages = !!config.debug;
    if (typeof config.debug === "function") {
      this.logger = config.debug;
    }
  }

  protected _debug(...args: any[]) {
    if (this.logDebugMessages) {
      this.logger(
        `GoTrueClient@${
          this.instanceID
        } (${version}) ${new Date().toISOString()}`,
        ...args
      );
    }

    return this;
  }
}
