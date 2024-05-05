import { version } from "./lib/version";

export type BaseLogOptions = {
  debug?: boolean | ((message: string, ...args: any[]) => void);
};

export abstract class BaseLog {
  protected logDebugMessages: boolean;
  protected logger: (message: string, ...args: any[]) => void = console.log;

  constructor(config: BaseLogOptions = {}) {
    this.logDebugMessages = !!config.debug;
    if (typeof config.debug === "function") {
      this.logger = config.debug;
    }
  }

  protected extraPrint?(): string;

  protected _debug(...args: any[]) {
    if (this.logDebugMessages) {
      const extra = this.extraPrint ? this.extraPrint() : "";
      this.logger(
        `FaableAuth@${extra} (${version}) ${new Date().toISOString()}`,
        ...args
      );
    }

    return this;
  }
}
