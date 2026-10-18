// Not ported: a binary heap, the least item on top by a comparison of the
// caller's, for the memory queue, which takes its next job, its next due time
// and its next lease to run out in O(log n) rather than by looking through
// every job.

/**
 * A binary min-heap.
 *
 * @internal
 */
class Heap {
  #items = [];
  #before;

  /**
   * @param before `(a, b) => boolean`: whether `a` comes before `b`.
   */
  constructor(before) {
    this.#before = before;
  }

  get size() {
    return this.#items.length;
  }

  /** The least item, left on the heap. */
  peek() {
    return this.#items[0];
  }

  push(item) {
    const items = this.#items;
    let index = items.length;
    items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#before(items[index], items[parent])) break;
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }

  /** Takes the least item off the heap. */
  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0) return top;
    items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let least = index;
      if (left < items.length && this.#before(items[left], items[least])) least = left;
      if (right < items.length && this.#before(items[right], items[least])) least = right;
      if (least === index) break;
      [items[index], items[least]] = [items[least], items[index]];
      index = least;
    }
    return top;
  }
}

module.exports = { Heap };
