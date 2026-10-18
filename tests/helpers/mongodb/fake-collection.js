// Not ported: a collection of MongoDB in memory for the tests of ./mongodb,
// with what the stores call of it: filters of equality, `$lte` and `$or`;
// `$set`, `$setOnInsert`, `$unset`, `$inc` and `$max`; an upsert that meets an id held
// fails as MongoDB does (E11000); sorts; and a change stream.

const comparable = (value) => (value instanceof Date ? value.getTime() : value);

const equal = (a, b) => {
  if (a === null || a === undefined) return b === null || b === undefined;
  return comparable(a) === comparable(b);
};

const matches = (document, filter) => {
  for (const key of Object.keys(filter)) {
    const condition = filter[key];
    if (key === '$or') {
      let any = false;
      for (const branch of condition) {
        any ||= matches(document, branch);
      }
      if (!any) return false;
      continue;
    }
    const value = document[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$lte' in condition) {
        if (
          value === null ||
          value === undefined ||
          !(comparable(value) <= comparable(condition.$lte))
        ) {
          return false;
        }
        continue;
      }
      if ('$in' in condition) {
        if (!condition.$in.some((candidate) => equal(value, candidate))) return false;
        continue;
      }
    }
    if (!equal(value, condition)) return false;
  }
  return true;
};

const clone = (value) => structuredClone(value);

// MongoDB's key, by name, so the lint of dangling underscores reads it once.
const ID = '_id';

const apply = (document, update, inserting) => {
  for (const [field, value] of Object.entries(update.$set ?? {})) {
    document[field] = clone(value);
  }
  if (inserting) {
    for (const [field, value] of Object.entries(update.$setOnInsert ?? {})) {
      document[field] = clone(value);
    }
  }
  for (const field of Object.keys(update.$unset ?? {})) {
    delete document[field];
  }
  for (const [field, value] of Object.entries(update.$inc ?? {})) {
    document[field] = (document[field] ?? 0) + value;
  }
  for (const [field, value] of Object.entries(update.$max ?? {})) {
    if (document[field] === undefined || comparable(value) > comparable(document[field])) {
      document[field] = clone(value);
    }
  }
};

const sortBy = (documents, sort = {}) =>
  documents.toSorted((a, b) => {
    for (const [field, direction] of Object.entries(sort)) {
      const left = comparable(a[field]);
      const right = comparable(b[field]);
      if (left === right) continue;
      if (left === undefined || left === null) return -direction;
      if (right === undefined || right === null) return direction;
      return left < right ? -direction : direction;
    }
    return 0;
  });

const project = (document, projection) => {
  if (document === undefined) return null;
  if (projection === undefined) return clone(document);
  const projected = { [ID]: document[ID] };
  for (const field of Object.keys(projection)) {
    if (field in document) projected[field] = clone(document[field]);
  }
  return projected;
};

const duplicateKey = (id) =>
  Object.assign(new Error(`E11000 duplicate key error collection: _id ${JSON.stringify(id)}`), {
    code: 11000,
  });

const fakeCollection = (options = {}) => {
  const documents = new Map();
  const calls = [];
  const indexes = [];
  const streams = [];
  const notify = (operationType) => {
    for (const stream of streams) {
      stream.listeners.get('change')?.({ operationType });
    }
  };
  const insertFrom = (filter, update) => {
    const document = {};
    for (const [key, value] of Object.entries(filter)) {
      if (
        !key.startsWith('$') &&
        (value === null || typeof value !== 'object' || value instanceof Date)
      ) {
        document[key] = clone(value);
      }
    }
    apply(document, update, true);
    if (documents.has(document[ID])) throw duplicateKey(document[ID]);
    documents.set(document[ID], document);
    return document;
  };
  const collection = {
    documents,
    calls,
    indexes,
    streams,
    async updateOne(filter, update, opts = {}) {
      calls.push(['updateOne', filter, update, opts]);
      if (options.failOn?.updateOne) throw options.failOn.updateOne;
      for (const document of documents.values()) {
        if (matches(document, filter)) {
          apply(document, update, false);
          notify('update');
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
      }
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      insertFrom(filter, update);
      notify('insert');
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
    async updateMany(filter, update, opts = {}) {
      calls.push(['updateMany', filter, update, opts]);
      let count = 0;
      for (const document of documents.values()) {
        if (matches(document, filter)) {
          apply(document, update, false);
          count++;
        }
      }
      return { matchedCount: count, modifiedCount: count };
    },
    async findOne(filter, opts = {}) {
      calls.push(['findOne', filter, opts]);
      const found = sortBy(
        [...documents.values()].filter((document) => matches(document, filter)),
        opts.sort,
      );
      return project(found[0], opts.projection);
    },
    async findOneAndUpdate(filter, update, opts = {}) {
      calls.push(['findOneAndUpdate', filter, update, opts]);
      const found = sortBy(
        [...documents.values()].filter((document) => matches(document, filter)),
        opts.sort,
      )[0];
      if (found === undefined) return options.modifyResult ? { ok: 1, value: null } : null;
      const before = clone(found);
      apply(found, update, false);
      const value = opts.returnDocument === 'after' ? clone(found) : before;
      return options.modifyResult ? { ok: 1, value } : value;
    },
    async deleteOne(filter, opts = {}) {
      calls.push(['deleteOne', filter, opts]);
      for (const [id, document] of documents) {
        if (matches(document, filter)) {
          documents.delete(id);
          return { deletedCount: 1 };
        }
      }
      return { deletedCount: 0 };
    },
    find(filter, opts = {}) {
      calls.push(['find', filter, opts]);
      let sort;
      const cursor = {
        sort(spec) {
          sort = spec;
          return cursor;
        },
        async toArray() {
          return sortBy(
            [...documents.values()].filter((document) => matches(document, filter)),
            sort,
          ).map(clone);
        },
      };
      return cursor;
    },
    async createIndex(spec, opts = {}) {
      indexes.push([spec, opts]);
      return opts.name ?? 'index';
    },
    watch(pipeline, opts) {
      const stream = {
        pipeline,
        opts,
        listeners: new Map(),
        closed: false,
        on(event, listener) {
          stream.listeners.set(event, listener);
          return stream;
        },
        async close() {
          stream.closed = true;
          streams.splice(streams.indexOf(stream), 1);
          if (options.failOn?.close) throw options.failOn.close;
        },
      };
      streams.push(stream);
      return stream;
    },
  };
  return collection;
};

module.exports = { fakeCollection };
