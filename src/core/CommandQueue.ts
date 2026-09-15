export class CommandQueue<T> {
  readonly #items: T[] = [];
  public get size(): number { return this.#items.length; }
  public enqueue(item: T): void { this.#items.push(item); }
  public prepend(items: readonly T[]): void { this.#items.unshift(...items); }
  public drain(): T[] { return this.#items.splice(0); }
  public removeWhere(predicate: (item: T) => boolean): void {
    for (let index = this.#items.length - 1; index >= 0; index -= 1) if (predicate(this.#items[index])) this.#items.splice(index, 1);
  }
  public clear(): void { this.#items.length = 0; }
}
