export class SerialQueues {
  constructor() { this.tails = new Map(); }
  async run(key, task) {
    const previous = this.tails.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.tails.set(key, current.finally(() => {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }));
    return current;
  }
  size() { return this.tails.size; }
}
