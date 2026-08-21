import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function emptyState() {
  return { records: [] };
}

export function loadState(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || !Array.isArray(value.records)) return emptyState();
    return value;
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, file);
}

export function upsertRecord(state, record) {
  const index = state.records.findIndex(
    (candidate) => candidate.messageGuid === record.messageGuid,
  );
  if (index === -1) state.records.push(record);
  else state.records[index] = record;
}

export function findRecord(state, messageGuid) {
  return state.records.find((record) => record.messageGuid === messageGuid);
}
