import { Process } from "./Process";

type ProcessConstructor = new (
  pid: string,
  parentPID: string,
  priority?: number,
) => Process;

class ProcessRegistry {
  private registry: { [key: string]: ProcessConstructor } = {};

  public register(processClass: ProcessConstructor, name: string): void {
    this.registry[name] = processClass;
  }

  public get(name: string): ProcessConstructor | undefined {
    return this.registry[name];
  }
}

export const processRegistry = new ProcessRegistry();
