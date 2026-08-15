export class Worker {
  run(): number {
    return this.step();
  }
  step(): number {
    return 1;
  }
}

export function createWorker(): Worker {
  function runClaimedStep(): number {
    return 1;
  }
  runClaimedStep();
  return { run: runClaimedStep };
}
