import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface DataStore {
  servers: Record<string, unknown>[];
  permissions: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  activity_log: Record<string, unknown>[];
  pipeline_log: Record<string, unknown>[];
  settings: Record<string, unknown>[];
}

let store: DataStore = {
  servers: [],
  permissions: [],
  sessions: [],
  messages: [],
  activity_log: [],
  pipeline_log: [],
  settings: [],
};

let dbPath: string = './data/app.json';

function loadStore(): void {
  if (existsSync(dbPath)) {
    try {
      const data = readFileSync(dbPath, 'utf-8');
      store = JSON.parse(data);
    } catch {
      store = {
        servers: [],
        permissions: [],
        sessions: [],
        messages: [],
        activity_log: [],
        pipeline_log: [],
        settings: [],
      };
    }
  }
}

function saveStore(): void {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(dbPath, JSON.stringify(store, null, 2));
}

export function initDatabase(): void {
  dbPath = process.env.DATABASE_URL?.replace('.db', '.json') || './data/app.json';
  loadStore();
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeysToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    result[snakeToCamel(key)] = obj[key];
  }
  return result;
}

export function getDb() {
  return {
    select: (table: keyof DataStore) => ({
      where: (conditionFn?: (getColumn: (col: string) => unknown) => unknown) => {
        let results = store[table].map(row => convertKeysToCamel(row as Record<string, unknown>));
        if (conditionFn) {
          results = results.filter(row => {
            return conditionFn((key: string) => row[key]);
          });
        }
        return {
          limit: (n: number) => ({
            all: () => results.slice(0, n),
          }),
          all: () => results,
        };
      }
    }),
    insert: (table: keyof DataStore) => ({
      values: (data: Record<string, unknown>) => {
        const snakeData: Record<string, unknown> = {};
        for (const key in data) {
          snakeData[camelToSnake(key)] = data[key];
        }
        store[table].push(snakeData);
        saveStore();
      },
      onConflictDoUpdate: ({ target, set }: { target: string; set: Record<string, unknown> }) => {
        const targetSnake = camelToSnake(target);
        const idx = store[table].findIndex((row: Record<string, unknown>) => row[targetSnake] === set[target]);
        const snakeSet: Record<string, unknown> = {};
        for (const key in set) {
          snakeSet[camelToSnake(key)] = set[key];
        }
        if (idx >= 0) {
          store[table][idx] = { ...store[table][idx], ...snakeSet };
        } else {
          store[table].push(snakeSet);
        }
        saveStore();
      }
    }),
    update: (table: keyof DataStore) => ({
      set: (data: Record<string, unknown>) => ({
        where: (conditionFn?: (getColumn: (col: string) => unknown) => unknown) => {
          const snakeData: Record<string, unknown> = {};
          for (const key in data) {
            snakeData[camelToSnake(key)] = data[key];
          }
          if (conditionFn) {
            store[table] = store[table].map(row => {
              const camelRow = convertKeysToCamel(row as Record<string, unknown>);
              if (conditionFn((key: string) => camelRow[key])) {
                return { ...row, ...snakeData };
              }
              return row;
            });
          } else if (store[table].length > 0) {
            store[table][0] = { ...store[table][0], ...snakeData };
          }
          saveStore();
        }
      })
    }),
    delete: (table: keyof DataStore) => ({
      where: (conditionFn: (getColumn: (col: string) => unknown) => unknown) => {
        store[table] = store[table].filter(row => {
          const camelRow = convertKeysToCamel(row as Record<string, unknown>);
          return !conditionFn((key: string) => camelRow[key]);
        });
        saveStore();
      }
    })
  };
}

export const schema = {
  servers: 'servers',
  permissions: 'permissions',
  sessions: 'sessions',
  messages: 'messages',
  activityLog: 'activity_log',
  pipelineLog: 'pipeline_log',
  settings: 'settings',
};
