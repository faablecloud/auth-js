import { BaseLog, BaseLogOptions } from "./BaseLog";

export abstract class Base extends BaseLog {
  private static nextInstanceID = 0;
  private instanceID: number;

  constructor(config: BaseLogOptions = {}) {
    super(config);
    this.instanceID = Base.nextInstanceID;
    Base.nextInstanceID += 1;
  }

  extraPrint() {
    return this.instanceID.toString();
  }
}
